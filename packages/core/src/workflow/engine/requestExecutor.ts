import type { MissionDescriptor, MissionStageId, MissionTaskState } from '../../types.js';
import type { MissionDefaultAgentMode } from '../../lib/daemonConfig.js';
import { DEFAULT_AGENT_RUNNER_ID } from '../../agent/runtimes/AgentRuntimeIds.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import {
	MISSION_STAGE_TEMPLATE_DEFINITIONS,
	renderMissionProductTemplate
} from '../templates/mission/index.js';
import { renderMissionArtifactTitle } from '../templates/mission/common.js';
import { getMissionArtifactDefinition } from '../manifest.js';
import {
	type MissionWorkflowConfigurationSnapshot,
	type MissionWorkflowEvent,
	type MissionWorkflowRequest,
	type MissionWorkflowRuntimeState,
	type MissionTaskRuntimeState,
	type MissionAgentSessionRuntimeState,
	type MissionRuntimeRecord
} from './types.js';
import {
	generateMissionWorkflowTasks,
	type MissionWorkflowTaskGenerationResult
} from './generator.js';
import type { AgentRunner } from '../../agent/AgentRunner.js';
import type { AgentSession } from '../../agent/AgentSession.js';
import type {
	AgentCommand,
	AgentLaunchConfig,
	AgentPrompt,
	AgentSessionEvent,
	AgentSessionId,
	AgentSessionReference,
	AgentSessionSnapshot
} from '../../agent/AgentRuntimeTypes.js';

type RuntimeSessionHandle = {
	session: AgentSession;
	subscription: { dispose(): void };
};

type RuntimeEventListener = (event: AgentSessionEvent) => void;

export interface MissionWorkflowRequestExecutorOptions {
	adapter: FilesystemAdapter;
	runners: Map<string, AgentRunner>;
	instructionsPath?: string;
	skillsPath?: string;
	defaultModel?: string;
	defaultMode?: MissionDefaultAgentMode;
	workingDirectoryResolver?: (task: MissionTaskRuntimeState, descriptor: MissionDescriptor) => string;
}

export class MissionWorkflowRequestExecutor {
	private readonly runtimeSessions = new Map<AgentSessionId, RuntimeSessionHandle>();
	private readonly runtimeEvents: MissionWorkflowEvent[] = [];
	private readonly sessionTaskIds = new Map<AgentSessionId, string>();
	private readonly runtimeListeners = new Set<RuntimeEventListener>();
	private readonly defaultModel: string | undefined;
	private readonly defaultMode: MissionDefaultAgentMode | undefined;
	private readonly workingDirectoryResolver: (task: MissionTaskRuntimeState, descriptor: MissionDescriptor) => string;

	public constructor(private readonly options: MissionWorkflowRequestExecutorOptions) {
		this.defaultModel = options.defaultModel;
		this.defaultMode = options.defaultMode;
		this.workingDirectoryResolver =
			options.workingDirectoryResolver ?? ((_task, descriptor) => descriptor.missionDir);
	}

	public readonly onDidRuntimeEvent = (listener: RuntimeEventListener): { dispose(): void } => {
		this.runtimeListeners.add(listener);
		return {
			dispose: () => {
				this.runtimeListeners.delete(listener);
			}
		};
	};

	public dispose(): void {
		for (const handle of this.runtimeSessions.values()) {
			handle.subscription.dispose();
		}
		this.runtimeSessions.clear();
		this.runtimeListeners.clear();
		this.runtimeEvents.length = 0;
	}

	public normalizePersistedSessionIdentity(
		session: MissionAgentSessionRuntimeState
	): MissionAgentSessionRuntimeState {
		if (session.transportId || session.runnerId !== 'copilot-cli') {
			return session;
		}
		return {
			...session,
			transportId: 'terminal'
		};
	}

	public async executeRequests(input: {
		missionId: string;
		descriptor: MissionDescriptor;
		configuration: MissionWorkflowConfigurationSnapshot;
		runtime: MissionWorkflowRuntimeState;
		requests: MissionWorkflowRequest[];
	}): Promise<MissionWorkflowEvent[]> {
		const events: MissionWorkflowEvent[] = [];

		for (const request of input.requests) {
			switch (request.type) {
				case 'tasks.request-generation': {
					const stageId = String(request.payload['stageId'] ?? '');
					await this.materializeStageArtifacts(input.descriptor, stageId as MissionStageId);
					const generation = await generateMissionWorkflowTasks({
						descriptor: input.descriptor,
						configuration: input.configuration,
						stageId
					});
					await this.materializeGeneratedTasks(input.descriptor, generation);
					events.push(this.createTasksGeneratedEvent(request.requestId, generation));
					break;
				}
				case 'session.launch': {
					const taskId = String(request.payload['taskId'] ?? '');
					const task = input.runtime.tasks.find((candidate) => candidate.taskId === taskId);
					if (!task) {
						events.push({
							eventId: `${request.requestId}:launch-failed`,
							type: 'session.launch-failed',
							occurredAt: new Date().toISOString(),
							source: 'daemon',
							causedByRequestId: request.requestId,
							taskId,
							reason: `Workflow request '${request.requestId}' references unknown task '${taskId}'.`
						});
						break;
					}

					const requestedRunnerId =
						typeof request.payload['runnerId'] === 'string' ? request.payload['runnerId'].trim() : undefined;
					const configuredRunnerId = typeof task.agentRunner === 'string' ? task.agentRunner.trim() : undefined;
					const runnerId =
						(requestedRunnerId && this.options.runners.has(requestedRunnerId) ? requestedRunnerId : undefined)
						?? (configuredRunnerId && this.options.runners.has(configuredRunnerId) ? configuredRunnerId : undefined)
						?? (this.options.runners.size === 1 ? this.options.runners.keys().next().value : undefined)
						?? (this.options.runners.has(DEFAULT_AGENT_RUNNER_ID) ? DEFAULT_AGENT_RUNNER_ID : undefined);
					if (!runnerId) {
						events.push({
							eventId: `${request.requestId}:launch-failed`,
							type: 'session.launch-failed',
							occurredAt: new Date().toISOString(),
							source: 'daemon',
							causedByRequestId: request.requestId,
							taskId,
							reason: `Task '${task.taskId}' does not specify a registered agent runner.`
						});
						break;
					}

					try {
						const promptText = await this.resolveLaunchPromptText(
							request.payload,
							task,
							input.descriptor
						);
						const launchConfig: AgentLaunchConfig = {
							missionId: input.missionId,
							workingDirectory:
								typeof request.payload['workingDirectory'] === 'string' && request.payload['workingDirectory'].trim()
									? request.payload['workingDirectory'].trim()
									: this.workingDirectoryResolver(task, input.descriptor),
							task: {
								taskId: task.taskId,
								stageId: task.stageId,
								title: task.title,
								description: task.title || task.instruction,
								instruction: task.instruction
							},
							specification: {
								summary:
									typeof request.payload['specificationSummary'] === 'string'
										? request.payload['specificationSummary']
										: task.title || task.instruction,
								documents: []
							},
							requestedRunnerId: runnerId,
							resume: { mode: 'new' },
							initialPrompt: {
								source: 'engine',
								text: promptText,
								...(task.title ? { title: task.title } : {}),
								metadata: {
									stageId: task.stageId,
									...(this.defaultModel ? { defaultModel: this.defaultModel } : {}),
									...(this.defaultMode ? { defaultMode: this.defaultMode } : {})
								}
							},
							...(typeof request.payload['terminalSessionName'] === 'string' && request.payload['terminalSessionName'].trim()
								? { metadata: { terminalSessionName: request.payload['terminalSessionName'].trim() } }
								: {})
						};
						const snapshot = await this.startSession(launchConfig);
						events.push(this.createSessionStartedEvent(request.requestId, snapshot, task.taskId));
					} catch (error) {
						events.push({
							eventId: `${request.requestId}:launch-failed`,
							type: 'session.launch-failed',
							occurredAt: new Date().toISOString(),
							source: 'daemon',
							causedByRequestId: request.requestId,
							taskId,
							reason: error instanceof Error ? error.message : String(error)
						});
					}
					break;
				}
				case 'session.prompt': {
					const sessionId = String(request.payload['sessionId'] ?? '').trim();
					const text = String(request.payload['text'] ?? '').trim();
					if (!sessionId || !text) {
						break;
					}
					const sourceValue = typeof request.payload['source'] === 'string' ? request.payload['source'] : 'engine';
					const source = sourceValue === 'operator' || sourceValue === 'system' ? sourceValue : 'engine';
					const title = typeof request.payload['title'] === 'string' && request.payload['title'].trim()
						? request.payload['title'].trim()
						: undefined;
					await this.promptRuntimeSession(sessionId, {
						source,
						text,
						...(title ? { title } : {})
					});
					break;
				}
				case 'session.command': {
					const sessionId = String(request.payload['sessionId'] ?? '').trim();
					const typeValue = typeof request.payload['kind'] === 'string' ? request.payload['kind'].trim() : '';
					const command = toAgentCommand(typeValue);
					if (!sessionId || !command) {
						break;
					}
					await this.commandRuntimeSession(sessionId, command);
					break;
				}
				case 'session.cancel': {
					const sessionId = String(request.payload['sessionId'] ?? '').trim();
					if (!sessionId) {
						break;
					}
					await this.cancelRuntimeSession(sessionId, 'cancelled by workflow engine');
					break;
				}
				case 'session.terminate': {
					const sessionId = String(request.payload['sessionId'] ?? '').trim();
					if (!sessionId) {
						break;
					}
					await this.terminateRuntimeSession(sessionId, 'terminated by workflow engine');
					break;
				}
				case 'mission.pause':
				case 'mission.mark-completed':
					break;
			}

			events.push(...this.drainRuntimeEvents());
		}

		return events;
	}

	public async reconcileSessions(document?: MissionRuntimeRecord): Promise<MissionWorkflowEvent[]> {
		if (document) {
			for (const persistedSession of document.runtime.sessions) {
				this.sessionTaskIds.set(persistedSession.sessionId, persistedSession.taskId);
				if (isTerminalStatus(persistedSession.lifecycle)) {
					continue;
				}
				if (this.runtimeSessions.has(persistedSession.sessionId)) {
					continue;
				}
				const snapshot = await this.attachSession(this.toSessionReference(persistedSession)).catch(() => undefined);
				if (!snapshot) {
					const translated = this.createAttachFailureLifecycleEvent(persistedSession);
					if (translated) {
						this.runtimeEvents.push(translated);
					}
					continue;
				}
				if (!hasMatchingTerminalLifecycle(document, snapshot)) {
					const translated = this.translateTerminalSnapshot(snapshot);
					if (translated) {
						this.runtimeEvents.push(translated);
					}
				}
			}
		}
		return this.drainRuntimeEvents();
	}

	public async startSession(config: AgentLaunchConfig): Promise<AgentSessionSnapshot> {
		const runner = this.resolveRunner(config.requestedRunnerId);
		const session = await runner.startSession(config);
		return this.registerSession(session);
	}

	public listRuntimeSessions(): AgentSessionSnapshot[] {
		const snapshots: AgentSessionSnapshot[] = [];
		for (const [sessionId, handle] of this.runtimeSessions) {
			const snapshot = this.readRuntimeSessionSnapshot(sessionId, handle);
			if (snapshot) {
				snapshots.push(snapshot);
			}
		}
		return snapshots;
	}

	public async attachSession(reference: AgentSessionReference): Promise<AgentSessionSnapshot> {
		const existing = this.runtimeSessions.get(reference.sessionId);
		if (existing) {
			return existing.session.getSnapshot();
		}
		const runner = this.requireRunner(reference.runnerId);
		const session = await runner.reconcileSession(reference);
		return this.registerSession(session);
	}

	public getRuntimeSession(sessionId: AgentSessionId): AgentSessionSnapshot | undefined {
		const handle = this.runtimeSessions.get(sessionId);
		return handle ? this.readRuntimeSessionSnapshot(sessionId, handle) : undefined;
	}

	public async cancelRuntimeSession(
		sessionId: AgentSessionId,
		reason?: string,
		fallbackTaskId?: string
	): Promise<MissionWorkflowEvent[]> {
		this.rememberSessionTaskId(sessionId, fallbackTaskId);
		const snapshot = await this.requireRuntimeSession(sessionId).cancel(reason);
		const events = this.drainRuntimeEvents();
		if (events.length > 0) {
			return events;
		}
		const translated = this.createSessionLifecycleEvent('session.cancelled', snapshot);
		return translated ? [translated] : [];
	}

	public async promptRuntimeSession(sessionId: AgentSessionId, prompt: AgentPrompt): Promise<MissionWorkflowEvent[]> {
		await this.requireRuntimeSession(sessionId).submitPrompt(prompt);
		return this.drainRuntimeEvents();
	}

	public async commandRuntimeSession(sessionId: AgentSessionId, command: AgentCommand): Promise<MissionWorkflowEvent[]> {
		await this.requireRuntimeSession(sessionId).submitCommand(command);
		return this.drainRuntimeEvents();
	}

	public async terminateRuntimeSession(
		sessionId: AgentSessionId,
		reason?: string,
		fallbackTaskId?: string
	): Promise<MissionWorkflowEvent[]> {
		this.rememberSessionTaskId(sessionId, fallbackTaskId);
		const snapshot = await this.requireRuntimeSession(sessionId).terminate(reason);
		const events = this.drainRuntimeEvents();
		if (events.length > 0) {
			return events;
		}
		const translated = this.createSessionLifecycleEvent('session.terminated', snapshot);
		return translated ? [translated] : [];
	}

	private registerSession(session: AgentSession): AgentSessionSnapshot {
		const snapshot = session.getSnapshot();
		this.rememberSessionTaskId(snapshot.sessionId, snapshot.taskId);
		const existing = this.runtimeSessions.get(snapshot.sessionId);
		if (existing) {
			existing.subscription.dispose();
		}
		const subscription = session.onDidEvent((event) => {
			this.rememberSessionTaskId(event.snapshot.sessionId, event.snapshot.taskId);
			this.fireRuntimeEvent(event);
			const translated = this.translateRuntimeEvent(event);
			if (translated) {
				this.runtimeEvents.push(translated);
			}
		});
		this.runtimeSessions.set(snapshot.sessionId, { session, subscription });
		return snapshot;
	}

	private resolveRunner(requestedRunnerId?: string): AgentRunner {
		if (requestedRunnerId?.trim()) {
			return this.requireRunner(requestedRunnerId.trim());
		}
		const defaultRunner = this.options.runners.get(DEFAULT_AGENT_RUNNER_ID);
		if (defaultRunner) {
			return defaultRunner;
		}
		const firstRunner = this.options.runners.values().next().value;
		if (!firstRunner) {
			throw new Error('No agent runners are registered.');
		}
		return firstRunner;
	}

	private requireRunner(runnerId: string): AgentRunner {
		const runner = this.options.runners.get(runnerId);
		if (!runner) {
			throw new Error(`Agent runner '${runnerId}' is not registered.`);
		}
		return runner;
	}

	private requireRuntimeSession(sessionId: AgentSessionId): AgentSession {
		const handle = this.runtimeSessions.get(sessionId);
		if (!handle) {
			throw new Error(`Agent session '${sessionId}' is not attached.`);
		}
		return handle.session;
	}

	private readRuntimeSessionSnapshot(
		sessionId: AgentSessionId,
		handle: RuntimeSessionHandle
	): AgentSessionSnapshot | undefined {
		try {
			return handle.session.getSnapshot();
		} catch {
			handle.subscription.dispose();
			this.runtimeSessions.delete(sessionId);
			return undefined;
		}
	}

	private fireRuntimeEvent(event: AgentSessionEvent): void {
		for (const listener of this.runtimeListeners) {
			listener(event);
		}
	}

	private drainRuntimeEvents(): MissionWorkflowEvent[] {
		const drained = [...this.runtimeEvents];
		this.runtimeEvents.length = 0;
		return drained;
	}

	private translateRuntimeEvent(event: AgentSessionEvent): MissionWorkflowEvent | undefined {
		switch (event.type) {
			case 'session.completed':
				return this.createSessionLifecycleEvent('session.completed', event.snapshot);
			case 'session.failed':
				return this.createSessionLifecycleEvent('session.failed', event.snapshot);
			case 'session.cancelled':
				return this.createSessionLifecycleEvent('session.cancelled', event.snapshot);
			case 'session.terminated':
				return this.createSessionLifecycleEvent('session.terminated', event.snapshot);
			default:
				return undefined;
		}
	}

	private translateTerminalSnapshot(snapshot: AgentSessionSnapshot): MissionWorkflowEvent | undefined {
		switch (snapshot.status) {
			case 'completed':
				return this.createSessionLifecycleEvent('session.completed', snapshot);
			case 'failed':
				return this.createSessionLifecycleEvent('session.failed', snapshot);
			case 'cancelled':
				return this.createSessionLifecycleEvent('session.cancelled', snapshot);
			case 'terminated':
				return this.createSessionLifecycleEvent('session.terminated', snapshot);
			default:
				return undefined;
		}
	}

	private createSessionLifecycleEvent(
		type: 'session.completed' | 'session.failed' | 'session.cancelled' | 'session.terminated',
		snapshot: AgentSessionSnapshot
	): MissionWorkflowEvent | undefined {
		const taskId = this.resolveSessionTaskId(snapshot);
		if (!taskId) {
			return undefined;
		}
		if (isTerminalStatus(snapshot.status)) {
			this.sessionTaskIds.delete(snapshot.sessionId);
		}
		return {
			eventId: `runtime:${snapshot.sessionId}:${type}:${snapshot.updatedAt}`,
			type,
			occurredAt: snapshot.updatedAt,
			source: 'daemon',
			sessionId: snapshot.sessionId,
			taskId
		};
	}

	private createSessionStartedEvent(
		requestId: string,
		snapshot: AgentSessionSnapshot,
		taskId: string
	): MissionWorkflowEvent {
		return {
			eventId: `${requestId}:session-started`,
			type: 'session.started',
			occurredAt: snapshot.updatedAt,
			source: 'daemon',
			causedByRequestId: requestId,
			sessionId: snapshot.sessionId,
			taskId,
			runnerId: snapshot.runnerId,
			...toTransportEventFields(snapshot)
		};
	}

	private resolveSessionTaskId(snapshot: AgentSessionSnapshot): string | undefined {
		const directTaskId = normalizeTaskId(snapshot.taskId);
		if (directTaskId) {
			this.sessionTaskIds.set(snapshot.sessionId, directTaskId);
			return directTaskId;
		}
		return this.sessionTaskIds.get(snapshot.sessionId);
	}

	private rememberSessionTaskId(sessionId: AgentSessionId, taskId: string | undefined): void {
		const normalizedTaskId = normalizeTaskId(taskId);
		if (normalizedTaskId) {
			this.sessionTaskIds.set(sessionId, normalizedTaskId);
		}
	}

	private toSessionReference(session: MissionAgentSessionRuntimeState): AgentSessionReference {
		return {
			runnerId: session.runnerId,
			sessionId: session.sessionId,
			...(session.transportId === 'terminal' || session.terminalSessionName || session.terminalPaneId
				? {
					transport: {
						kind: 'terminal',
						terminalSessionName: session.terminalSessionName ?? session.sessionId,
						...(session.terminalPaneId ? { paneId: session.terminalPaneId } : {})
					}
				}
				: {})
		};
	}

	private createTasksGeneratedEvent(
		requestId: string,
		generation: MissionWorkflowTaskGenerationResult
	): MissionWorkflowEvent {
		return {
			eventId: `${requestId}:tasks-generated`,
			type: 'tasks.generated',
			occurredAt: new Date().toISOString(),
			source: 'daemon',
			causedByRequestId: requestId,
			stageId: generation.stageId,
			tasks: generation.tasks
		};
	}

	private async resolveLaunchPromptText(
		payload: Record<string, unknown>,
		task: MissionTaskRuntimeState,
		descriptor: MissionDescriptor
	): Promise<string> {
		const explicitPrompt = typeof payload['prompt'] === 'string' ? payload['prompt'].trim() : '';
		if (explicitPrompt.length > 0) {
			return explicitPrompt;
		}

		try {
			const fileSegment = task.taskId.split('/').at(-1)?.trim() || task.taskId.trim();
			const taskState = await this.options.adapter.readTaskState(
				descriptor.missionDir,
				task.stageId as MissionStageId,
				`${fileSegment}.md`
			);
			if (taskState) {
				return buildTaskArtifactLaunchPrompt(
					taskState,
					this.options.adapter.getMissionWorkspacePath(descriptor.missionDir)
				);
			}
		} catch {
			// Fall back to runtime task instruction when task artifact resolution fails.
		}

		return task.instruction;
	}

	private async materializeStageArtifacts(descriptor: MissionDescriptor, stageId: MissionStageId): Promise<void> {
		const definition = MISSION_STAGE_TEMPLATE_DEFINITIONS[stageId];
		if (!definition) {
			return;
		}

		for (const template of definition.artifacts) {
			const artifact = getMissionArtifactDefinition(template.key);
			await this.options.adapter.writeArtifactRecord(descriptor.missionDir, template.key, {
				attributes: {
					title: renderMissionArtifactTitle(template.key, descriptor.brief),
					artifact: template.key,
					createdAt: descriptor.createdAt,
					updatedAt: new Date().toISOString(),
					...(artifact.stageId ? { stage: artifact.stageId } : {})
				},
				body: await renderMissionProductTemplate(template, {
					brief: descriptor.brief,
					branchRef: descriptor.branchRef
				})
			});
		}
	}

	private async materializeGeneratedTasks(
		descriptor: MissionDescriptor,
		generation: MissionWorkflowTaskGenerationResult
	): Promise<void> {
		for (const task of generation.tasks) {
			await this.options.adapter.writeTaskRecord(
				descriptor.missionDir,
				generation.stageId as MissionStageId,
				`${task.taskId.split('/').pop() ?? task.taskId}.md`,
				{
					subject: task.title,
					instruction: task.instruction,
					...(task.dependsOn.length > 0 ? { dependsOn: task.dependsOn } : {}),
					agent: task.agentRunner ?? DEFAULT_AGENT_RUNNER_ID
				}
			);
		}
	}

	private createAttachFailureLifecycleEvent(
		session: MissionAgentSessionRuntimeState
	): MissionWorkflowEvent | undefined {
		if (isTerminalStatus(session.lifecycle)) {
			return undefined;
		}
		this.sessionTaskIds.set(session.sessionId, session.taskId);
		return {
			eventId: `reconcile:${session.sessionId}:terminated:${new Date().toISOString()}`,
			type: 'session.terminated',
			occurredAt: new Date().toISOString(),
			source: 'daemon',
			sessionId: session.sessionId,
			taskId: session.taskId
		};
	}
}

function toAgentCommand(value: string): AgentCommand | undefined {
	switch (value) {
		case 'interrupt':
			return { type: 'interrupt' };
		case 'resume':
			return { type: 'resume' };
		case 'checkpoint':
			return { type: 'checkpoint' };
		case 'nudge':
			return { type: 'nudge' };
		default:
			return undefined;
	}
}

function toTransportEventFields(snapshot: AgentSessionSnapshot): {
	transportId?: string;
	terminalSessionName?: string;
	terminalPaneId?: string;
} {
	if (snapshot.transport?.kind !== 'terminal') {
		return {};
	}
	return {
		transportId: 'terminal',
		terminalSessionName: snapshot.transport.terminalSessionName,
		...(snapshot.transport.paneId ? { terminalPaneId: snapshot.transport.paneId } : {})
	};
}

function hasMatchingTerminalLifecycle(document: MissionRuntimeRecord, snapshot: AgentSessionSnapshot): boolean {
	const runtimeSession = document.runtime.sessions.find((session) => session.sessionId === snapshot.sessionId);
	if (!runtimeSession) {
		return false;
	}
	return runtimeSession.lifecycle === snapshot.status;
}

function normalizeTaskId(taskId: string | undefined): string | undefined {
	if (typeof taskId !== 'string') {
		return undefined;
	}
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId || normalizedTaskId === 'unknown') {
		return undefined;
	}
	return normalizedTaskId;
}

function buildTaskArtifactLaunchPrompt(task: MissionTaskState, missionWorkspaceDir: string): string {
	const instruction = task.instruction.trim();
	const lines = [
		`You are working on task '${task.sequence} ${task.subject}'.`,
		`Stay strictly within this mission workspace: ${missionWorkspaceDir}`,
		'Do not read, modify, or create files outside that folder boundary.',
		`Here are your instructions: @${task.filePath}`,
		'That task file is authoritative.'
	];

	if (instruction.length > 0) {
		lines.push('', 'Task summary:', instruction);
	}

	return lines.join('\n');
}

function isTerminalStatus(status: AgentSessionSnapshot['status']): boolean {
	return status === 'completed'
		|| status === 'failed'
		|| status === 'cancelled'
		|| status === 'terminated';
}