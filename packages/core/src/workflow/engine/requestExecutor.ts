import type { MissionDescriptor, MissionStageId } from '../../types.js';
import type { MissionDefaultAgentMode } from '../../lib/daemonConfig.js';
import { DEFAULT_AGENT_RUNNER_ID, normalizeLegacyAgentRunnerId } from '../../lib/agentRuntimes.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import {
	MISSION_STAGE_TEMPLATE_DEFINITIONS,
	renderMissionProductTemplate
} from '../../templates/mission/index.js';
import { renderMissionArtifactTitle } from '../../templates/mission/common.js';
import { getMissionArtifactDefinition } from '../manifest.js';
import {
	type MissionWorkflowConfigurationSnapshot,
	type MissionWorkflowEvent,
	type MissionWorkflowRequest,
	type MissionWorkflowRuntimeState,
	type MissionTaskRuntimeState
} from './types.js';
import {
	generateMissionWorkflowTasks,
	type MissionWorkflowTaskGenerationResult
} from './generator.js';
import type { MissionAgentSessionRuntimeState, MissionRuntimeRecord } from './types.js';
import type { AgentRunner } from '../../runtime/AgentRunner.js';
import { AgentSessionOrchestrator } from '../../runtime/AgentSessionOrchestrator.js';
import { AgentSessionEventEmitter } from '../../runtime/AgentSessionEventEmitter.js';
import type { PersistedAgentSessionStore } from '../../runtime/PersistedAgentSessionStore.js';
import type {
	AgentCommand,
	AgentCommandKind,
	AgentPrompt,
	AgentSessionEvent,
	AgentSessionReference,
	AgentSessionId,
	AgentPromptSource,
	AgentSessionSnapshot,
	AgentSessionStartRequest
} from '../../runtime/AgentRuntimeTypes.js';

export interface MissionWorkflowRequestExecutorOptions {
	adapter: FilesystemAdapter;
	runners: Map<string, AgentRunner>;
	sessionStore?: PersistedAgentSessionStore;
	instructionsPath?: string;
	skillsPath?: string;
	defaultModel?: string;
	defaultMode?: MissionDefaultAgentMode;
	workingDirectoryResolver?: (task: MissionTaskRuntimeState, descriptor: MissionDescriptor) => string;
}

export class MissionWorkflowRequestExecutor {
	private readonly adapter: FilesystemAdapter;
	private readonly runners: Map<string, AgentRunner>;
	private readonly orchestrator: AgentSessionOrchestrator;
	private readonly sessionStore: PersistedAgentSessionStore | undefined;
	private readonly defaultModel: string | undefined;
	private readonly defaultMode: MissionDefaultAgentMode | undefined;
	private readonly workingDirectoryResolver: (task: MissionTaskRuntimeState, descriptor: MissionDescriptor) => string;
	private readonly runtimeEvents: MissionWorkflowEvent[] = [];
	private readonly sessionTaskIds = new Map<AgentSessionId, string>();
	private readonly runtimeEventEmitter = new AgentSessionEventEmitter<AgentSessionEvent>();
	private readonly orchestratorSubscription: { dispose(): void };

	public readonly onDidRuntimeEvent = this.runtimeEventEmitter.event;

	public constructor(options: MissionWorkflowRequestExecutorOptions) {
		this.adapter = options.adapter;
		this.runners = options.runners;
		this.sessionStore = options.sessionStore;
		this.orchestrator = new AgentSessionOrchestrator({
			runners: this.runners.values(),
			...(this.sessionStore ? { store: this.sessionStore } : {})
		});
		this.orchestratorSubscription = this.orchestrator.onDidEvent((event) => {
			this.runtimeEventEmitter.fire(event);
			const translated = this.translateRuntimeEvent(event);
			if (translated) {
				this.runtimeEvents.push(translated);
			}
		});
		this.defaultModel = options.defaultModel;
		this.defaultMode = options.defaultMode;
		this.workingDirectoryResolver =
			options.workingDirectoryResolver ??
			((_task, descriptor) => descriptor.missionDir);
	}

	public dispose(): void {
		this.orchestratorSubscription.dispose();
		this.orchestrator.dispose();
		this.runtimeEventEmitter.dispose();
		this.runtimeEvents.length = 0;
	}

	public normalizePersistedSessionIdentity(
		session: MissionAgentSessionRuntimeState
	): MissionAgentSessionRuntimeState {
		if (session.transportId) {
			return session;
		}
		if (session.runnerId !== 'copilot-cli') {
			return session;
		}

		const terminalRuntime = [...this.runners.values()].find((runner) => runner.transportId === 'terminal');
		if (!terminalRuntime) {
			return session;
		}

		return {
			...session,
			runnerId: terminalRuntime.id,
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
					const task = input.runtime.tasks.find(candidate => candidate.taskId === taskId);
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

					const runnerId =
						normalizeLegacyAgentRunnerId(task.agentRunner) ??
						(typeof request.payload['runnerId'] === 'string' ? request.payload['runnerId'] : undefined);
					if (!runnerId) {
						events.push({
							eventId: `${request.requestId}:launch-failed`,
							type: 'session.launch-failed',
							occurredAt: new Date().toISOString(),
							source: 'daemon',
							causedByRequestId: request.requestId,
							taskId,
							reason: `Task '${task.taskId}' does not specify an agent runner.`
						});
						break;
					}

					try {
						const transportId = this.runners.get(runnerId)?.transportId;
						const session = await this.orchestrator.startSession(runnerId, {
							missionId: input.missionId,
							taskId: task.taskId,
							workingDirectory: this.workingDirectoryResolver(task, input.descriptor),
							...(transportId
								? { transportId }
								: {}),
							initialPrompt: {
								source: 'engine',
								text: task.instruction,
								...(task.title ? { title: task.title } : {}),
								metadata: {
									stageId: task.stageId,
									...(this.defaultModel ? { defaultModel: this.defaultModel } : {}),
									...(this.defaultMode ? { defaultMode: this.defaultMode } : {})
								}
							}
						});
						const snapshot = session.getSnapshot();
						events.push({
							eventId: `${request.requestId}:session-started`,
							type: 'session.started',
							occurredAt: snapshot.updatedAt,
							source: 'daemon',
							causedByRequestId: request.requestId,
							sessionId: snapshot.sessionId,
							taskId: task.taskId,
							runnerId: snapshot.runnerId,
							...(snapshot.transportId ? { transportId: snapshot.transportId } : {}),
							...(snapshot.terminalSessionName ? { terminalSessionName: snapshot.terminalSessionName } : {}),
							...(snapshot.terminalPaneId ? { terminalPaneId: snapshot.terminalPaneId } : {})
						});
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
					const sessionId = String(request.payload['sessionId'] ?? '');
					const text = String(request.payload['text'] ?? '').trim();
					if (!sessionId || text.length === 0) {
						break;
					}

					const sourceValue = typeof request.payload['source'] === 'string'
						? request.payload['source']
						: 'engine';
					const source: AgentPromptSource =
						sourceValue === 'operator' || sourceValue === 'system' ? sourceValue : 'engine';
					const title =
						typeof request.payload['title'] === 'string' && request.payload['title'].trim().length > 0
							? request.payload['title'].trim()
							: undefined;

					await this.orchestrator.submitPrompt(sessionId, {
						source,
						text,
						...(title ? { title } : {})
					});
					break;
				}
				case 'session.command': {
					const sessionId = String(request.payload['sessionId'] ?? '');
					const kindValue = String(request.payload['kind'] ?? '').trim();
					if (!sessionId || !isAgentCommandKind(kindValue)) {
						break;
					}

					await this.orchestrator.submitCommand(sessionId, {
						kind: kindValue
					});
					break;
				}
				case 'session.cancel': {
					const sessionId = String(request.payload['sessionId'] ?? '');
					if (!sessionId) {
						break;
					}
					await this.orchestrator.cancelSession(
						sessionId,
						'cancelled by workflow engine'
					);
					break;
				}
				case 'session.terminate': {
					const sessionId = String(request.payload['sessionId'] ?? '');
					if (!sessionId) {
						break;
					}
					await this.orchestrator.terminateSession(
						sessionId,
						'terminated by workflow engine'
					);
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
		const events: MissionWorkflowEvent[] = [];
		const missionId = document?.missionId;
		if (this.sessionStore) {
			const references = await this.sessionStore.list();
			for (const reference of references) {
				await this.orchestrator.attachSession(reference);
			}
			events.push(...this.drainRuntimeEvents());
		}

		for (const runner of this.runners.values()) {
			const sessions = runner.listSessions ? await runner.listSessions() : [];
			for (const session of sessions) {
				if (missionId && session.missionId !== missionId) {
					continue;
				}
				if (document && hasMatchingTerminalLifecycle(document, session)) {
					continue;
				}
				if (session.phase === 'completed') {
					events.push({
						eventId: `reconcile:${session.sessionId}:completed:${session.updatedAt}`,
						type: 'session.completed',
						occurredAt: session.updatedAt,
						source: 'daemon',
						sessionId: session.sessionId,
						taskId: session.taskId
					});
				} else if (session.phase === 'failed') {
					events.push({
						eventId: `reconcile:${session.sessionId}:failed:${session.updatedAt}`,
						type: 'session.failed',
						occurredAt: session.updatedAt,
						source: 'daemon',
						sessionId: session.sessionId,
						taskId: session.taskId
					});
				} else if (session.phase === 'cancelled') {
					events.push({
						eventId: `reconcile:${session.sessionId}:cancelled:${session.updatedAt}`,
						type: 'session.cancelled',
						occurredAt: session.updatedAt,
						source: 'daemon',
						sessionId: session.sessionId,
						taskId: session.taskId
					});
				} else if (session.phase === 'terminated') {
					events.push({
						eventId: `reconcile:${session.sessionId}:terminated:${session.updatedAt}`,
						type: 'session.terminated',
						occurredAt: session.updatedAt,
						source: 'daemon',
						sessionId: session.sessionId,
						taskId: session.taskId
					});
				}
			}
		}

		events.push(...this.drainRuntimeEvents());
		return events;
	}

	public async startSession(input: {
		runnerId: string;
		request: AgentSessionStartRequest;
	}): Promise<AgentSessionSnapshot> {
		const session = await this.orchestrator.startSession(input.runnerId, input.request);
		const snapshot = session.getSnapshot();
		this.rememberSessionTaskId(snapshot.sessionId, snapshot.taskId);
		return snapshot;
	}

	public listRuntimeSessions(): AgentSessionSnapshot[] {
		return this.orchestrator.listSessions();
	}

	public async attachSession(reference: AgentSessionReference): Promise<AgentSessionSnapshot> {
		const session = await this.orchestrator.attachSession(reference);
		const snapshot = session.getSnapshot();
		this.rememberSessionTaskId(snapshot.sessionId, snapshot.taskId);
		return snapshot;
	}

	public getRuntimeSession(sessionId: AgentSessionId): AgentSessionSnapshot | undefined {
		return this.orchestrator.listSessions().find((session) => session.sessionId === sessionId);
	}

	public async cancelRuntimeSession(
		sessionId: AgentSessionId,
		reason?: string,
		fallbackTaskId?: string
	): Promise<MissionWorkflowEvent[]> {
		this.rememberSessionTaskId(sessionId, fallbackTaskId);
		await this.orchestrator.cancelSession(sessionId, reason);
		return this.drainRuntimeEvents();
	}

	public async promptRuntimeSession(sessionId: AgentSessionId, prompt: AgentPrompt): Promise<MissionWorkflowEvent[]> {
		await this.orchestrator.submitPrompt(sessionId, prompt);
		return this.drainRuntimeEvents();
	}

	public async commandRuntimeSession(sessionId: AgentSessionId, command: AgentCommand): Promise<MissionWorkflowEvent[]> {
		await this.orchestrator.submitCommand(sessionId, command);
		return this.drainRuntimeEvents();
	}

	public async terminateRuntimeSession(
		sessionId: AgentSessionId,
		reason?: string,
		fallbackTaskId?: string
	): Promise<MissionWorkflowEvent[]> {
		this.rememberSessionTaskId(sessionId, fallbackTaskId);
		await this.orchestrator.terminateSession(sessionId, reason);
		return this.drainRuntimeEvents();
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
			case 'session.state-changed':
				return this.createSessionLifecycleEventFromPhase(event.snapshot);
			default:
				return undefined;
		}
	}

	private createSessionLifecycleEventFromPhase(snapshot: AgentSessionSnapshot): MissionWorkflowEvent | undefined {
		if (snapshot.phase === 'completed') {
			return this.createSessionLifecycleEvent('session.completed', snapshot);
		}
		if (snapshot.phase === 'failed') {
			return this.createSessionLifecycleEvent('session.failed', snapshot);
		}
		if (snapshot.phase === 'cancelled') {
			return this.createSessionLifecycleEvent('session.cancelled', snapshot);
		}
		if (snapshot.phase === 'terminated') {
			return this.createSessionLifecycleEvent('session.terminated', snapshot);
		}
		return undefined;
	}

	private createSessionLifecycleEvent(
		type: 'session.completed' | 'session.failed' | 'session.cancelled' | 'session.terminated',
		snapshot: AgentSessionSnapshot
	): MissionWorkflowEvent | undefined {
		const taskId = this.resolveSessionTaskId(snapshot);
		if (!taskId) {
			return undefined;
		}
		if (isTerminalPhase(snapshot.phase)) {
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
		if (!normalizedTaskId) {
			return;
		}
		this.sessionTaskIds.set(sessionId, normalizedTaskId);
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

	private async materializeStageArtifacts(
		descriptor: MissionDescriptor,
		stageId: MissionStageId
	): Promise<void> {
		const definition = MISSION_STAGE_TEMPLATE_DEFINITIONS[stageId];
		if (!definition) {
			return;
		}

		for (const template of definition.artifacts) {
			const artifact = getMissionArtifactDefinition(template.key);
			await this.adapter.writeArtifactRecord(descriptor.missionDir, template.key, {
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
			await this.adapter.writeTaskRecord(descriptor.missionDir, generation.stageId as MissionStageId, `${task.taskId.split('/').pop() ?? task.taskId}.md`, {
				subject: task.title,
				instruction: task.instruction,
				...(task.dependsOn.length > 0 ? { dependsOn: task.dependsOn } : {}),
				agent: normalizeLegacyAgentRunnerId(task.agentRunner) ?? DEFAULT_AGENT_RUNNER_ID
			});
		}
	}
}

function isAgentCommandKind(value: string): value is AgentCommandKind {
	return value === 'interrupt'
		|| value === 'continue'
		|| value === 'checkpoint'
		|| value === 'finish';
}

function hasMatchingTerminalLifecycle(
	document: MissionRuntimeRecord,
	snapshot: AgentSessionSnapshot
): boolean {
	const runtimeSession = document.runtime.sessions.find(
		(session) => session.sessionId === snapshot.sessionId
	);
	if (!runtimeSession) {
		return false;
	}

	switch (snapshot.phase) {
		case 'completed':
			return runtimeSession.lifecycle === 'completed';
		case 'failed':
			return runtimeSession.lifecycle === 'failed';
		case 'cancelled':
			return runtimeSession.lifecycle === 'cancelled';
		case 'terminated':
			return runtimeSession.lifecycle === 'terminated';
		default:
			return false;
	}
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

function isTerminalPhase(phase: AgentSessionSnapshot['phase']): boolean {
	return phase === 'completed'
		|| phase === 'failed'
		|| phase === 'cancelled'
		|| phase === 'terminated';
}