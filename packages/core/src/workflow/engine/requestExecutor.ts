import type { MissionDescriptor, MissionTaskState } from '../../entities/Mission/MissionSchema.js';
import type { MissionStageId } from '../manifest.js';
import {
	type MissionDefaultAgentModeType,
	type MissionReasoningEffortType
} from '../../entities/Mission/MissionSchema.js';
import { AgentIdSchema } from '../../entities/Agent/AgentSchema.js';
import type { AgentRegistry } from '../../entities/Agent/AgentRegistry.js';
import { AgentExecutor } from '../../daemon/runtime/agent/AgentExecutor.js';
import type { AgentExecutionTerminalHandleType } from '../../entities/AgentExecution/AgentExecutionSchema.js';
import { appendTaskContextArtifactReferences } from '../../entities/Task/taskLaunchPrompt.js';
import type { MissionDossierFilesystem } from '../../entities/Mission/MissionDossierFilesystem.js';
import {
	MISSION_STAGE_TEMPLATE_DEFINITIONS,
	renderMissionProductTemplate
} from '../mission/templates/index.js';
import { renderMissionArtifactTitle } from '../mission/templates/common.js';
import { getMissionArtifactDefinition } from '../mission/manifest.js';
import { Repository } from '../../entities/Repository/Repository.js';
import {
	type MissionWorkflowConfigurationSnapshot,
	type MissionGeneratedTaskPayload,
	type MissionWorkflowEvent,
	type MissionWorkflowRequest,
	type MissionWorkflowRuntimeState,
	type MissionTaskRuntimeState,
	type AgentExecutionRuntimeState,
	type MissionStateData
} from './types.js';
import {
	generateMissionWorkflowTasks,
	normalizeGeneratedTaskDependencies,
	type MissionWorkflowTaskGenerationResult
} from './generator.js';
import type { AgentExecution } from '../../entities/AgentExecution/AgentExecution.js';
import type {
	AgentCommand,
	AgentLaunchConfig,
	AgentPrompt,
	AgentExecutionEvent,
	AgentExecutionId,
	AgentExecutionReference,
	AgentExecutionSnapshot
} from '../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import type { AgentExecutionSignalDecision } from '../../daemon/runtime/agent/signals/AgentExecutionSignal.js';

type RuntimeSessionHandle = {
	execution: AgentExecution;
	subscription: { dispose(): void };
};

type RuntimeEventListener = (event: AgentExecutionEvent) => void;

export interface MissionWorkflowRequestExecutorOptions {
	adapter: MissionDossierFilesystem;
	agentRegistry: AgentRegistry;
	instructionsPath?: string;
	skillsPath?: string;
	defaultModel?: string;
	defaultReasoningEffort?: MissionReasoningEffortType;
	defaultMode?: MissionDefaultAgentModeType;
	workingDirectoryResolver?: (task: MissionTaskRuntimeState, descriptor: MissionDescriptor) => string;
}

export class MissionWorkflowRequestExecutor {
	private readonly runtimeSessions = new Map<AgentExecutionId, RuntimeSessionHandle>();
	private readonly runtimeEvents: MissionWorkflowEvent[] = [];
	private readonly sessionTaskIds = new Map<AgentExecutionId, string>();
	private readonly runtimeListeners = new Set<RuntimeEventListener>();
	private readonly defaultModel: string | undefined;
	private readonly defaultReasoningEffort: string | undefined;
	private readonly defaultMode: MissionDefaultAgentModeType | undefined;
	private readonly workingDirectoryResolver: (task: MissionTaskRuntimeState, descriptor: MissionDescriptor) => string;
	private readonly agentExecutor: AgentExecutor;

	public constructor(private readonly options: MissionWorkflowRequestExecutorOptions) {
		this.defaultModel = options.defaultModel;
		this.defaultReasoningEffort = options.defaultReasoningEffort;
		this.defaultMode = options.defaultMode;
		this.agentExecutor = new AgentExecutor({ agentRegistry: options.agentRegistry });
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

	public consumeRuntimeLifecycleEvents(): MissionWorkflowEvent[] {
		return this.drainRuntimeEvents();
	}

	public dispose(): void {
		for (const handle of this.runtimeSessions.values()) {
			handle.subscription.dispose();
		}
		this.runtimeSessions.clear();
		this.agentExecutor.dispose();
		this.runtimeListeners.clear();
		this.runtimeEvents.length = 0;
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
					const stageId = String(request.payload['stageId'] ?? '') as MissionStageId;
					const generationRule = input.configuration.workflow.taskGeneration.find(
						(candidate) => candidate.stageId === stageId
					);
					if (!generationRule) {
						throw new Error(`Workflow configuration does not define task generation for stage '${stageId}'.`);
					}
					await this.materializeStageArtifacts(input.descriptor, stageId as MissionStageId);
					const generatedFromWorkflow = await generateMissionWorkflowTasks({
						descriptor: input.descriptor,
						configuration: input.configuration,
						stageId
					});
					const generatedFromTaskArtifacts = generationRule.artifactTasks
						? await this.readGeneratedTasksFromStageArtifacts(
							input.descriptor,
							stageId
						)
						: [];
					const generation: MissionWorkflowTaskGenerationResult = {
						...generatedFromWorkflow,
						tasks: mergeGeneratedTasks(
							generatedFromWorkflow.tasks,
							generatedFromTaskArtifacts
						)
					};
					await this.materializeGeneratedTasks(input.descriptor, generation);
					events.push(this.createTasksGeneratedEvent(request.requestId, generation));
					break;
				}
				case 'execution.launch': {
					const taskId = String(request.payload['taskId'] ?? '');
					const task = input.runtime.tasks.find((candidate) => candidate.taskId === taskId);
					if (!task) {
						events.push({
							eventId: `${request.requestId}:launch-failed`,
							type: 'execution.launch-failed',
							occurredAt: new Date().toISOString(),
							source: 'daemon',
							causedByRequestId: request.requestId,
							taskId,
							reason: `Workflow request '${request.requestId}' references unknown task '${taskId}'.`
						});
						break;
					}

					const requestedAdapterId =
						typeof request.payload['agentId'] === 'string' ? request.payload['agentId'].trim() : undefined;
					const configuredAdapterId = typeof task.agentAdapter === 'string' ? task.agentAdapter.trim() : undefined;
					let agentId: string | undefined;
					try {
						agentId = this.options.agentRegistry.resolveStartAgentId(requestedAdapterId ?? configuredAdapterId);
					} catch (error) {
						events.push({
							eventId: `${request.requestId}:launch-failed`,
							type: 'execution.launch-failed',
							occurredAt: new Date().toISOString(),
							source: 'daemon',
							causedByRequestId: request.requestId,
							taskId,
							reason: error instanceof Error ? error.message : String(error)
						});
						break;
					}
					if (!agentId) {
						events.push({
							eventId: `${request.requestId}:launch-failed`,
							type: 'execution.launch-failed',
							occurredAt: new Date().toISOString(),
							source: 'daemon',
							causedByRequestId: request.requestId,
							taskId,
							reason: `Task '${task.taskId}' does not specify a registered agent adapter.`
						});
						break;
					}

					try {
						const promptText = await this.resolveLaunchPromptText(
							request.payload,
							task,
							input.descriptor
						);
						const metadata = {
							...(typeof request.payload['terminalName'] === 'string' && request.payload['terminalName'].trim()
								? { terminalName: request.payload['terminalName'].trim() }
								: {}),
							...(typeof request.payload['model'] === 'string' && request.payload['model'].trim()
								? { model: request.payload['model'].trim() }
								: typeof task.model === 'string' && task.model.trim()
									? { model: task.model.trim() }
									: this.defaultModel
										? { model: this.defaultModel }
										: {}),
							...(typeof request.payload['reasoningEffort'] === 'string' && request.payload['reasoningEffort'].trim()
								? { reasoningEffort: request.payload['reasoningEffort'].trim() }
								: typeof task.reasoningEffort === 'string' && task.reasoningEffort.trim()
									? { reasoningEffort: task.reasoningEffort.trim() }
									: this.defaultReasoningEffort
										? { reasoningEffort: this.defaultReasoningEffort }
										: {})
						};
						const launchConfig: AgentLaunchConfig = {
							scope: {
								kind: 'task',
								missionId: input.missionId,
								taskId: task.taskId,
								stageId: task.stageId,
								repositoryRootPath: Repository.getRepositoryRootFromMissionDir(input.descriptor.missionDir)
							},
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
							requestedAdapterId: agentId,
							resume: { mode: 'new' },
							initialPrompt: {
								source: 'engine',
								text: promptText,
								...(task.title ? { title: task.title } : {}),
								metadata: {
									stageId: task.stageId,
									...(this.defaultModel ? { defaultModel: this.defaultModel } : {}),
									...(this.defaultReasoningEffort
										? { defaultReasoningEffort: this.defaultReasoningEffort }
										: {}),
									...(this.defaultMode ? { defaultMode: this.defaultMode } : {})
								}
							},
							...(Object.keys(metadata).length > 0 ? { metadata } : {})
						};
						const snapshot = await this.startExecution(launchConfig);
						events.push(this.createSessionStartedEvent(request.requestId, snapshot, task.taskId));
					} catch (error) {
						events.push({
							eventId: `${request.requestId}:launch-failed`,
							type: 'execution.launch-failed',
							occurredAt: new Date().toISOString(),
							source: 'daemon',
							causedByRequestId: request.requestId,
							taskId,
							reason: error instanceof Error ? error.message : String(error)
						});
					}
					break;
				}
				case 'execution.prompt': {
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
				case 'execution.command': {
					const sessionId = String(request.payload['sessionId'] ?? '').trim();
					const typeValue = typeof request.payload['kind'] === 'string' ? request.payload['kind'].trim() : '';
					const command = toAgentCommand(typeValue);
					if (!sessionId || !command) {
						break;
					}
					await this.commandRuntimeSession(sessionId, command);
					break;
				}
				case 'execution.cancel': {
					const sessionId = String(request.payload['sessionId'] ?? '').trim();
					if (!sessionId) {
						break;
					}
					await this.cancelRuntimeSession(sessionId, 'cancelled by workflow engine');
					break;
				}
				case 'execution.terminate': {
					const sessionId = String(request.payload['sessionId'] ?? '').trim();
					if (!sessionId) {
						break;
					}
					await this.terminateRuntimeSession(sessionId, 'terminated by workflow engine');
					break;
				}
			}

			events.push(...this.drainRuntimeEvents());
		}

		return events;
	}

	public async reconcileExecutions(document?: MissionStateData): Promise<MissionWorkflowEvent[]> {
		if (document) {
			for (const persistedSession of document.runtime.sessions) {
				this.sessionTaskIds.set(persistedSession.sessionId, persistedSession.taskId);
				if (isTerminalStatus(persistedSession.lifecycle)) {
					continue;
				}
				if (this.runtimeSessions.has(persistedSession.sessionId)) {
					continue;
				}
				const snapshot = await this.reconcileExecution(this.toSessionReference(persistedSession)).catch(() => undefined);
				if (!snapshot) {
					const translated = this.createAttachFailureLifecycleEvent(persistedSession);
					if (translated) {
						this.runtimeEvents.push(translated);
					}
					continue;
				}
				if (!hasMatchingTerminalLifecycle(document, snapshot)) {
					const translated = this.translateTerminalSnapshot(snapshot);
					if (translated.length > 0) {
						this.runtimeEvents.push(...translated);
					}
				}
			}
		}
		return this.drainRuntimeEvents();
	}

	public async startExecution(config: AgentLaunchConfig): Promise<AgentExecutionSnapshot> {
		const execution = await this.agentExecutor.startExecution(config);
		return this.registerExecution(execution);
	}

	public listRuntimeSessions(): AgentExecutionSnapshot[] {
		const snapshots: AgentExecutionSnapshot[] = [];
		for (const [sessionId, handle] of this.runtimeSessions) {
			const snapshot = this.readRuntimeSessionSnapshot(sessionId, handle);
			if (snapshot) {
				snapshots.push(snapshot);
			}
		}
		return snapshots;
	}

	public async reconcileExecution(reference: AgentExecutionReference): Promise<AgentExecutionSnapshot> {
		const existing = this.runtimeSessions.get(reference.sessionId);
		if (existing) {
			return existing.execution.getSnapshot();
		}
		const execution = await this.agentExecutor.reconcileExecution(reference);
		return this.registerExecution(execution);
	}

	public getRuntimeSession(sessionId: AgentExecutionId): AgentExecutionSnapshot | undefined {
		const handle = this.runtimeSessions.get(sessionId);
		return handle ? this.readRuntimeSessionSnapshot(sessionId, handle) : undefined;
	}

	public applyRuntimeSessionSignalDecision(
		sessionId: AgentExecutionId,
		decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
	): AgentExecutionSnapshot | undefined {
		const handle = this.runtimeSessions.get(sessionId);
		if (!handle) {
			return undefined;
		}
		const signalAwareSession = handle.execution as AgentExecution & {
			applySignalDecision?: (
				nextDecision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
			) => AgentExecutionSnapshot | void;
		};
		if (!signalAwareSession.applySignalDecision) {
			return undefined;
		}
		const applied = signalAwareSession.applySignalDecision(decision);
		return applied ?? signalAwareSession.getSnapshot();
	}

	public async cancelRuntimeSession(
		sessionId: AgentExecutionId,
		reason?: string,
		fallbackTaskId?: string
	): Promise<MissionWorkflowEvent[]> {
		this.rememberSessionTaskId(sessionId, fallbackTaskId);
		this.requireRuntimeSession(sessionId);
		const snapshot = await this.agentExecutor.cancelExecution(sessionId, reason);
		const events = this.drainRuntimeEvents();
		if (events.length > 0) {
			return events;
		}
		return this.createExecutionLifecycleEvents('execution.cancelled', snapshot);
	}

	public async promptRuntimeSession(sessionId: AgentExecutionId, prompt: AgentPrompt): Promise<MissionWorkflowEvent[]> {
		this.requireRuntimeSession(sessionId);
		await this.agentExecutor.submitPrompt(sessionId, prompt);
		return this.drainRuntimeEvents();
	}

	public async completeRuntimeSession(
		sessionId: AgentExecutionId,
		fallbackTaskId?: string
	): Promise<MissionWorkflowEvent[]> {
		this.rememberSessionTaskId(sessionId, fallbackTaskId);
		this.requireRuntimeSession(sessionId);
		const snapshot = await this.agentExecutor.completeExecution(sessionId);
		const events = this.drainRuntimeEvents();
		if (events.length > 0) {
			return events;
		}
		return this.createExecutionLifecycleEvents('execution.completed', snapshot);
	}

	public async commandRuntimeSession(sessionId: AgentExecutionId, command: AgentCommand): Promise<MissionWorkflowEvent[]> {
		this.requireRuntimeSession(sessionId);
		await this.agentExecutor.submitCommand(sessionId, command);
		return this.drainRuntimeEvents();
	}

	public async terminateRuntimeSession(
		sessionId: AgentExecutionId,
		reason?: string,
		fallbackTaskId?: string
	): Promise<MissionWorkflowEvent[]> {
		this.rememberSessionTaskId(sessionId, fallbackTaskId);
		const runtimeSession = this.runtimeSessions.get(sessionId);
		if (!runtimeSession) {
			return [];
		}
		const snapshot = await this.agentExecutor.terminateExecution(sessionId, reason);
		const events = this.drainRuntimeEvents();
		if (events.length > 0) {
			return events;
		}
		return this.createExecutionLifecycleEvents('execution.terminated', snapshot);
	}

	private registerExecution(execution: AgentExecution): AgentExecutionSnapshot {
		const snapshot = execution.getSnapshot();
		this.rememberSessionTaskId(snapshot.sessionId, snapshot.taskId);
		const existing = this.runtimeSessions.get(snapshot.sessionId);
		if (existing) {
			existing.subscription.dispose();
		}
		const subscription = execution.onDidEvent((event) => {
			this.rememberSessionTaskId(event.snapshot.sessionId, event.snapshot.taskId);
			const translated = this.translateRuntimeEvent(event);
			if (translated.length > 0) {
				this.runtimeEvents.push(...translated);
			}
			this.fireRuntimeEvent(event);
		});
		this.runtimeSessions.set(snapshot.sessionId, { execution, subscription });
		return snapshot;
	}

	private requireRuntimeSession(sessionId: AgentExecutionId): AgentExecution {
		const handle = this.runtimeSessions.get(sessionId);
		if (!handle) {
			throw new Error(`Agent execution '${sessionId}' is not attached.`);
		}
		return handle.execution;
	}

	private readRuntimeSessionSnapshot(
		sessionId: AgentExecutionId,
		handle: RuntimeSessionHandle
	): AgentExecutionSnapshot | undefined {
		try {
			return handle.execution.getSnapshot();
		} catch {
			handle.subscription.dispose();
			this.runtimeSessions.delete(sessionId);
			return undefined;
		}
	}

	private fireRuntimeEvent(event: AgentExecutionEvent): void {
		for (const listener of this.runtimeListeners) {
			listener(event);
		}
	}

	private drainRuntimeEvents(): MissionWorkflowEvent[] {
		const drained = [...this.runtimeEvents];
		this.runtimeEvents.length = 0;
		return drained;
	}

	private translateRuntimeEvent(event: AgentExecutionEvent): MissionWorkflowEvent[] {
		switch (event.type) {
			case 'execution.completed':
				return this.createExecutionLifecycleEvents('execution.completed', event.snapshot);
			case 'execution.failed':
				return this.createExecutionLifecycleEvents('execution.failed', event.snapshot);
			case 'execution.cancelled':
				return this.createExecutionLifecycleEvents('execution.cancelled', event.snapshot);
			case 'execution.terminated':
				return this.createExecutionLifecycleEvents('execution.terminated', event.snapshot);
			default:
				return [];
		}
	}

	private translateTerminalSnapshot(snapshot: AgentExecutionSnapshot): MissionWorkflowEvent[] {
		switch (snapshot.status) {
			case 'completed':
				return this.createExecutionLifecycleEvents('execution.completed', snapshot);
			case 'failed':
				return this.createExecutionLifecycleEvents('execution.failed', snapshot);
			case 'cancelled':
				return this.createExecutionLifecycleEvents('execution.cancelled', snapshot);
			case 'terminated':
				return this.createExecutionLifecycleEvents('execution.terminated', snapshot);
			default:
				return [];
		}
	}

	private createExecutionLifecycleEvents(
		type: 'execution.completed' | 'execution.failed' | 'execution.cancelled' | 'execution.terminated',
		snapshot: AgentExecutionSnapshot
	): MissionWorkflowEvent[] {
		const taskId = this.resolveSessionTaskId(snapshot);
		if (!taskId) {
			return [];
		}
		if (isTerminalStatus(snapshot.status)) {
			this.sessionTaskIds.delete(snapshot.sessionId);
		}
		const sessionEvent: MissionWorkflowEvent = {
			eventId: `runtime:${snapshot.sessionId}:${type}:${snapshot.updatedAt}`,
			type,
			occurredAt: snapshot.updatedAt,
			source: 'daemon',
			sessionId: snapshot.sessionId,
			taskId
		};
		if (type !== 'execution.completed') {
			return [sessionEvent];
		}
		return [
			sessionEvent,
			{
				eventId: `runtime:${snapshot.sessionId}:task.completed:${snapshot.updatedAt}`,
				type: 'task.completed',
				occurredAt: snapshot.updatedAt,
				source: 'daemon',
				taskId
			}
		];
	}

	private createSessionStartedEvent(
		requestId: string,
		snapshot: AgentExecutionSnapshot,
		taskId: string
	): MissionWorkflowEvent {
		const sessionLogPath = typeof this.options.adapter.getMissionSessionLogRelativePath === 'function'
			? this.options.adapter.getMissionSessionLogRelativePath(snapshot.sessionId)
			: undefined;
		return {
			eventId: `${requestId}:session-started`,
			type: 'execution.started',
			occurredAt: snapshot.updatedAt,
			source: 'daemon',
			causedByRequestId: requestId,
			sessionId: snapshot.sessionId,
			taskId,
			agentId: snapshot.agentId,
			...(sessionLogPath ? { sessionLogPath } : {}),
			...toTransportEventFields(snapshot)
		};
	}

	private resolveSessionTaskId(snapshot: AgentExecutionSnapshot): string | undefined {
		const directTaskId = normalizeTaskId(snapshot.taskId);
		if (directTaskId) {
			this.sessionTaskIds.set(snapshot.sessionId, directTaskId);
			return directTaskId;
		}
		return this.sessionTaskIds.get(snapshot.sessionId);
	}

	private rememberSessionTaskId(sessionId: AgentExecutionId, taskId: string | undefined): void {
		const normalizedTaskId = normalizeTaskId(taskId);
		if (normalizedTaskId) {
			this.sessionTaskIds.set(sessionId, normalizedTaskId);
		}
	}

	private toSessionReference(execution: AgentExecutionRuntimeState): AgentExecutionReference {
		return {
			agentId: execution.agentId,
			sessionId: execution.sessionId,
			...(execution.transportId === 'terminal' || execution.terminalHandle
				? {
					transport: {
						kind: 'terminal',
						terminalName: execution.terminalHandle?.terminalName ?? execution.sessionId,
						...(execution.terminalHandle?.terminalPaneId ? { terminalPaneId: execution.terminalHandle.terminalPaneId } : {})
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
			return appendPendingLaunchContext(explicitPrompt, task);
		}

		const missionWorkspaceDir = typeof this.options.adapter.getMissionWorkspacePath === 'function'
			? this.options.adapter.getMissionWorkspacePath(descriptor.missionDir)
			: descriptor.missionDir;
		const artifactBaseName = task.taskId.split('/').at(-1)?.trim() || task.taskId.trim();
		const artifactName = artifactBaseName.toLowerCase().endsWith('.md')
			? artifactBaseName
			: `${artifactBaseName}.md`;

		try {
			const taskState = await this.options.adapter.readTaskState(
				descriptor.missionDir,
				task.stageId as MissionStageId,
				artifactName
			);
			if (taskState) {
				return appendPendingLaunchContext(
					buildTaskArtifactLaunchPrompt(
						taskState,
						missionWorkspaceDir
					),
					task
				);
			}
		} catch {
			// Fall back to runtime task instruction when task artifact resolution fails.
		}

		return appendPendingLaunchContext(buildRuntimeTaskLaunchPrompt(task, missionWorkspaceDir, artifactName), task);
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
					missionId: descriptor.missionId,
					repositoryRootPath: Repository.getRepositoryRootFromMissionDir(descriptor.missionDir),
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
					...(task.taskKind ? { taskKind: task.taskKind } : {}),
					...(task.pairedTaskId ? { pairedTaskId: task.pairedTaskId } : {}),
					...(task.dependsOn.length > 0 ? { dependsOn: task.dependsOn } : {}),
					...(task.context && task.context.length > 0 ? { context: task.context } : {}),
					agent: task.agentAdapter ?? 'copilot-cli'
				}
			);
		}
	}

	private async readGeneratedTasksFromStageArtifacts(
		descriptor: MissionDescriptor,
		stageId: MissionStageId
	): Promise<MissionGeneratedTaskPayload[]> {
		const taskStates = await this.options.adapter.listTaskStates(descriptor.missionDir, stageId).catch(() => []);
		return taskStates.map((taskState) => ({
			...(normalizeGeneratedTaskAgentAdapter(taskState.agent) ?? {}),
			taskId: taskState.taskId,
			title: taskState.subject,
			instruction: taskState.instruction,
			...(taskState.taskKind ? { taskKind: taskState.taskKind } : {}),
			...(taskState.pairedTaskId ? { pairedTaskId: taskState.pairedTaskId } : {}),
			dependsOn: [...taskState.dependsOn],
			context: (taskState.context ?? []).map((contextArtifact) => ({ ...contextArtifact }))
		}));
	}

	private createAttachFailureLifecycleEvent(
		session: AgentExecutionRuntimeState
	): MissionWorkflowEvent | undefined {
		void session;
		// Reattach failures are not authoritative lifecycle facts.
		// If we cannot observe a runtime session, keep workflow state unchanged
		// until a concrete terminal snapshot/event is received.
		return undefined;
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

function normalizeGeneratedTaskAgentAdapter(
	agent: MissionTaskState['agent']
): Pick<MissionGeneratedTaskPayload, 'agentAdapter'> | undefined {
	const parsedAdapter = AgentIdSchema.safeParse(agent);
	return parsedAdapter.success ? { agentAdapter: parsedAdapter.data } : undefined;
}

function toTransportEventFields(snapshot: AgentExecutionSnapshot): { transportId: string; terminalHandle: AgentExecutionTerminalHandleType } | Record<string, never> {
	if (snapshot.transport?.kind !== 'terminal') {
		return {};
	}
	return {
		transportId: 'terminal',
		terminalHandle: {
			terminalName: snapshot.transport.terminalName,
			terminalPaneId: snapshot.transport.terminalPaneId ?? snapshot.transport.terminalName
		}
	};
}

function hasMatchingTerminalLifecycle(document: MissionStateData, snapshot: AgentExecutionSnapshot): boolean {
	const runtimeSession = document.runtime.sessions.find((execution) => execution.sessionId === snapshot.sessionId);
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
		`Perform the task exactly as specified in <${task.fileName}>.`,
		`Here are your instructions: @${task.filePath}`,
		'That task file is authoritative.'
	];
	appendTaskContextArtifactReferences(lines, task.context);

	if (instruction.length > 0) {
		lines.push('', 'Task summary:', instruction);
	}

	return lines.join('\n');
}

function buildRuntimeTaskLaunchPrompt(
	task: MissionTaskRuntimeState,
	missionWorkspaceDir: string,
	artifactName: string
): string {
	const lines = [
		`You are working on task '${task.title}'.`,
		`Stay strictly within this mission workspace: ${missionWorkspaceDir}`,
		'Do not read, modify, or create files outside that folder boundary.',
		`Perform the task exactly as specified in <${artifactName}>.`,
		`Open @${artifactName} and use it as the authoritative task instruction file.`
	];
	appendTaskContextArtifactReferences(lines, task.context);

	const instruction = task.instruction.trim();
	if (instruction.length > 0) {
		lines.push('', 'Task summary:', instruction);
	}

	return lines.join('\n');
}

function appendPendingLaunchContext(basePrompt: string, task: MissionTaskRuntimeState): string {
	const context = task.pendingLaunchContext;
	if (!context) {
		return basePrompt;
	}

	const lines = [
		basePrompt,
		'',
		'Rework context:',
		`Actor: ${context.actor}`,
		`Reason code: ${context.reasonCode}`,
		'Summary:',
		context.summary
	];

	if (context.sourceTaskId) {
		lines.push('', `Source task: ${context.sourceTaskId}`);
	}

	if (context.artifactRefs.length > 0) {
		lines.push('', 'Reference artifacts:');
		for (const artifactRef of context.artifactRefs) {
			lines.push(artifactRef.title ? `- ${artifactRef.title}: @${artifactRef.path}` : `- @${artifactRef.path}`);
		}
	}

	lines.push('', 'Treat the task instruction file as authoritative. Use this rework context as corrective guidance.');
	return lines.join('\n');
}

function isTerminalStatus(status: AgentExecutionSnapshot['status']): boolean {
	return status === 'completed'
		|| status === 'failed'
		|| status === 'cancelled'
		|| status === 'terminated';
}

function mergeGeneratedTasks(
	workflowTasks: MissionGeneratedTaskPayload[],
	artifactTasks: MissionGeneratedTaskPayload[]
): MissionGeneratedTaskPayload[] {
	if (artifactTasks.length === 0) {
		return workflowTasks;
	}

	const mergedByTaskId = new Map<string, MissionGeneratedTaskPayload>();
	for (const task of workflowTasks) {
		mergedByTaskId.set(task.taskId, task);
	}
	for (const task of artifactTasks) {
		mergedByTaskId.set(task.taskId, task);
	}

	const artifactTaskIds = new Set(artifactTasks.map((task) => task.taskId));
	const orderedTaskIds = [
		...artifactTasks.map((task) => task.taskId),
		...workflowTasks.map((task) => task.taskId).filter((taskId) => !artifactTaskIds.has(taskId))
	];

	return normalizeGeneratedTaskDependencies(
		orderedTaskIds
			.map((taskId) => mergedByTaskId.get(taskId))
			.filter((task): task is MissionGeneratedTaskPayload => Boolean(task))
	);
}
