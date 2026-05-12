import type { MissionDescriptor } from '../../entities/Mission/MissionSchema.js';
import type { TaskDossierRecordType } from '../../entities/Task/TaskSchema.js';
import type { MissionStageId } from '../manifest.js';
import {
	type AgentExecutionLaunchModeType,
	type AgentExecutionReasoningEffortType
} from '../../entities/AgentExecution/AgentExecutionSchema.js';
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
import { DEFAULT_REPOSITORY_AGENT_ADAPTER_ID } from '../../entities/Repository/RepositorySchema.js';
import {
	type WorkflowConfigurationSnapshot,
	type WorkflowGeneratedTaskPayload,
	type WorkflowEvent,
	type WorkflowRequest,
	type WorkflowRuntimeState,
	type WorkflowTaskRuntimeState,
	type AgentExecutionRuntimeState,
	type WorkflowStateData
} from './types.js';
import {
	generateWorkflowTasks,
	normalizeGeneratedTaskDependencies,
	type WorkflowTaskGenerationResult
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
import {
	isTerminalFinalStatus,
	type AgentExecutionSignalDecision
} from '../../entities/AgentExecution/AgentExecutionProtocolTypes.js';

type RuntimeAgentExecutionHandle = {
	execution: AgentExecution;
	subscription: { dispose(): void };
};

type RuntimeEventListener = (event: AgentExecutionEvent) => void;

export interface WorkflowRequestExecutorOptions {
	adapter: MissionDossierFilesystem;
	agentRegistry: AgentRegistry;
	instructionsPath?: string;
	skillsPath?: string;
	defaultModel?: string;
	defaultReasoningEffort?: AgentExecutionReasoningEffortType;
	defaultMode?: AgentExecutionLaunchModeType;
	workingDirectoryResolver?: (task: WorkflowTaskRuntimeState, descriptor: MissionDescriptor) => string;
	logger?: {
		debug(message: string, metadata?: Record<string, unknown>): void;
	};
}

export class WorkflowRequestExecutor {
	private readonly runtimeAgentExecutions = new Map<AgentExecutionId, RuntimeAgentExecutionHandle>();
	private readonly runtimeEvents: WorkflowEvent[] = [];
	private readonly agentExecutionTaskIds = new Map<AgentExecutionId, string>();
	private readonly runtimeListeners = new Set<RuntimeEventListener>();
	private readonly defaultModel: string | undefined;
	private readonly defaultReasoningEffort: string | undefined;
	private readonly defaultMode: AgentExecutionLaunchModeType | undefined;
	private readonly workingDirectoryResolver: (task: WorkflowTaskRuntimeState, descriptor: MissionDescriptor) => string;
	private readonly agentExecutor: AgentExecutor;

	public constructor(private readonly options: WorkflowRequestExecutorOptions) {
		this.defaultModel = options.defaultModel;
		this.defaultReasoningEffort = options.defaultReasoningEffort;
		this.defaultMode = options.defaultMode;
		this.agentExecutor = new AgentExecutor({
			agentRegistry: options.agentRegistry,
			...(options.logger ? { logger: options.logger } : {})
		});
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

	public consumeRuntimeLifecycleEvents(): WorkflowEvent[] {
		return this.drainRuntimeEvents();
	}

	public dispose(): void {
		for (const handle of this.runtimeAgentExecutions.values()) {
			handle.subscription.dispose();
		}
		this.runtimeAgentExecutions.clear();
		this.agentExecutor.dispose();
		this.runtimeListeners.clear();
		this.runtimeEvents.length = 0;
	}

	public async executeRequests(input: {
		missionId: string;
		descriptor: MissionDescriptor;
		configuration: WorkflowConfigurationSnapshot;
		runtime: WorkflowRuntimeState;
		requests: WorkflowRequest[];
	}): Promise<WorkflowEvent[]> {
		const events: WorkflowEvent[] = [];

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
					const generatedFromWorkflow = await generateWorkflowTasks({
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
					const generation: WorkflowTaskGenerationResult = {
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
						events.push(this.createAgentExecutionStartedEvent(request.requestId, snapshot, task.taskId));
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
					const agentExecutionId = String(request.payload['agentExecutionId'] ?? '').trim();
					const text = String(request.payload['text'] ?? '').trim();
					if (!agentExecutionId || !text) {
						break;
					}
					const sourceValue = typeof request.payload['source'] === 'string' ? request.payload['source'] : 'engine';
					const source = sourceValue === 'operator' || sourceValue === 'system' ? sourceValue : 'engine';
					const title = typeof request.payload['title'] === 'string' && request.payload['title'].trim()
						? request.payload['title'].trim()
						: undefined;
					await this.promptRuntimeAgentExecution(agentExecutionId, {
						source,
						text,
						...(title ? { title } : {})
					});
					break;
				}
				case 'execution.command': {
					const agentExecutionId = String(request.payload['agentExecutionId'] ?? '').trim();
					const typeValue = typeof request.payload['kind'] === 'string' ? request.payload['kind'].trim() : '';
					const command = toAgentCommand(typeValue);
					if (!agentExecutionId || !command) {
						break;
					}
					await this.commandRuntimeAgentExecution(agentExecutionId, command);
					break;
				}
				case 'execution.cancel': {
					const agentExecutionId = String(request.payload['agentExecutionId'] ?? '').trim();
					if (!agentExecutionId) {
						break;
					}
					await this.cancelRuntimeAgentExecution(agentExecutionId, 'cancelled by workflow engine');
					break;
				}
				case 'execution.terminate': {
					const agentExecutionId = String(request.payload['agentExecutionId'] ?? '').trim();
					if (!agentExecutionId) {
						break;
					}
					await this.terminateRuntimeAgentExecution(agentExecutionId, 'terminated by workflow engine');
					break;
				}
			}

			events.push(...this.drainRuntimeEvents());
		}

		return events;
	}

	public async reconcileExecutions(document?: WorkflowStateData): Promise<WorkflowEvent[]> {
		if (document) {
			for (const persistedAgentExecution of document.runtime.agentExecutions) {
				this.agentExecutionTaskIds.set(persistedAgentExecution.agentExecutionId, persistedAgentExecution.taskId);
				if (isTerminalFinalStatus(persistedAgentExecution.lifecycle)) {
					continue;
				}
				if (this.runtimeAgentExecutions.has(persistedAgentExecution.agentExecutionId)) {
					continue;
				}
				const snapshot = await this.reconcileExecution(this.toAgentExecutionReference(persistedAgentExecution)).catch(() => undefined);
				if (!snapshot) {
					const translated = this.createAttachFailureLifecycleEvent(persistedAgentExecution);
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

	public listRuntimeAgentExecutions(): AgentExecutionSnapshot[] {
		const snapshots: AgentExecutionSnapshot[] = [];
		for (const [agentExecutionId, handle] of this.runtimeAgentExecutions) {
			const snapshot = this.readRuntimeAgentExecutionSnapshot(agentExecutionId, handle);
			if (snapshot) {
				snapshots.push(snapshot);
			}
		}
		return snapshots;
	}

	public async reconcileExecution(reference: AgentExecutionReference): Promise<AgentExecutionSnapshot> {
		const existing = this.runtimeAgentExecutions.get(reference.agentExecutionId);
		if (existing) {
			return existing.execution.getSnapshot();
		}
		const execution = await this.agentExecutor.reconcileExecution(reference);
		return this.registerExecution(execution);
	}

	public getRuntimeAgentExecution(agentExecutionId: AgentExecutionId): AgentExecutionSnapshot | undefined {
		const handle = this.runtimeAgentExecutions.get(agentExecutionId);
		return handle ? this.readRuntimeAgentExecutionSnapshot(agentExecutionId, handle) : undefined;
	}

	public applyRuntimeAgentExecutionSignalDecision(
		agentExecutionId: AgentExecutionId,
		decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
	): AgentExecutionSnapshot | undefined {
		const handle = this.runtimeAgentExecutions.get(agentExecutionId);
		if (!handle) {
			return undefined;
		}
		const signalAwareAgentExecution = handle.execution as AgentExecution & {
			applySignalDecision?: (
				nextDecision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
			) => AgentExecutionSnapshot | void;
		};
		if (!signalAwareAgentExecution.applySignalDecision) {
			return undefined;
		}
		const applied = signalAwareAgentExecution.applySignalDecision(decision);
		return applied ?? signalAwareAgentExecution.getSnapshot();
	}

	public async cancelRuntimeAgentExecution(
		agentExecutionId: AgentExecutionId,
		reason?: string,
		fallbackTaskId?: string
	): Promise<WorkflowEvent[]> {
		this.rememberAgentExecutionTaskId(agentExecutionId, fallbackTaskId);
		this.requireRuntimeAgentExecution(agentExecutionId);
		const snapshot = await this.agentExecutor.cancelExecution(agentExecutionId, reason);
		const events = this.drainRuntimeEvents();
		if (events.length > 0) {
			return events;
		}
		return this.createExecutionLifecycleEvents('execution.cancelled', snapshot);
	}

	public async promptRuntimeAgentExecution(agentExecutionId: AgentExecutionId, prompt: AgentPrompt): Promise<WorkflowEvent[]> {
		this.requireRuntimeAgentExecution(agentExecutionId);
		await this.agentExecutor.submitPrompt(agentExecutionId, prompt);
		return this.drainRuntimeEvents();
	}

	public async completeRuntimeAgentExecution(
		agentExecutionId: AgentExecutionId,
		fallbackTaskId?: string
	): Promise<WorkflowEvent[]> {
		this.rememberAgentExecutionTaskId(agentExecutionId, fallbackTaskId);
		this.requireRuntimeAgentExecution(agentExecutionId);
		const snapshot = await this.agentExecutor.completeExecution(agentExecutionId);
		const events = this.drainRuntimeEvents();
		if (events.length > 0) {
			return events;
		}
		return this.createExecutionLifecycleEvents('execution.completed', snapshot);
	}

	public async commandRuntimeAgentExecution(agentExecutionId: AgentExecutionId, command: AgentCommand): Promise<WorkflowEvent[]> {
		this.requireRuntimeAgentExecution(agentExecutionId);
		await this.agentExecutor.submitCommand(agentExecutionId, command);
		return this.drainRuntimeEvents();
	}

	public async terminateRuntimeAgentExecution(
		agentExecutionId: AgentExecutionId,
		reason?: string,
		fallbackTaskId?: string
	): Promise<WorkflowEvent[]> {
		this.rememberAgentExecutionTaskId(agentExecutionId, fallbackTaskId);
		const runtimeAgentExecution = this.runtimeAgentExecutions.get(agentExecutionId);
		if (!runtimeAgentExecution) {
			return [];
		}
		const snapshot = await this.agentExecutor.terminateExecution(agentExecutionId, reason);
		const events = this.drainRuntimeEvents();
		if (events.length > 0) {
			return events;
		}
		return this.createExecutionLifecycleEvents('execution.terminated', snapshot);
	}

	private registerExecution(execution: AgentExecution): AgentExecutionSnapshot {
		const snapshot = execution.getSnapshot();
		this.rememberAgentExecutionTaskId(snapshot.agentExecutionId, snapshot.taskId);
		const existing = this.runtimeAgentExecutions.get(snapshot.agentExecutionId);
		if (existing) {
			existing.subscription.dispose();
		}
		const subscription = execution.onDidEvent((event) => {
			this.rememberAgentExecutionTaskId(event.snapshot.agentExecutionId, event.snapshot.taskId);
			const translated = this.translateRuntimeEvent(event);
			if (translated.length > 0) {
				this.runtimeEvents.push(...translated);
			}
			this.fireRuntimeEvent(event);
		});
		this.runtimeAgentExecutions.set(snapshot.agentExecutionId, { execution, subscription });
		return snapshot;
	}

	private requireRuntimeAgentExecution(agentExecutionId: AgentExecutionId): AgentExecution {
		const handle = this.runtimeAgentExecutions.get(agentExecutionId);
		if (!handle) {
			throw new Error(`Agent execution '${agentExecutionId}' is not attached.`);
		}
		return handle.execution;
	}

	private readRuntimeAgentExecutionSnapshot(
		agentExecutionId: AgentExecutionId,
		handle: RuntimeAgentExecutionHandle
	): AgentExecutionSnapshot | undefined {
		try {
			return handle.execution.getSnapshot();
		} catch {
			handle.subscription.dispose();
			this.runtimeAgentExecutions.delete(agentExecutionId);
			return undefined;
		}
	}

	private fireRuntimeEvent(event: AgentExecutionEvent): void {
		for (const listener of this.runtimeListeners) {
			listener(event);
		}
	}

	private drainRuntimeEvents(): WorkflowEvent[] {
		const drained = [...this.runtimeEvents];
		this.runtimeEvents.length = 0;
		return drained;
	}

	private translateRuntimeEvent(event: AgentExecutionEvent): WorkflowEvent[] {
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

	private translateTerminalSnapshot(snapshot: AgentExecutionSnapshot): WorkflowEvent[] {
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
	): WorkflowEvent[] {
		const taskId = this.resolveAgentExecutionTaskId(snapshot);
		if (!taskId) {
			return [];
		}
		if (isTerminalFinalStatus(snapshot.status)) {
			this.agentExecutionTaskIds.delete(snapshot.agentExecutionId);
		}
		const agentExecutionEvent: WorkflowEvent = {
			eventId: `runtime:${snapshot.agentExecutionId}:${type}:${snapshot.updatedAt}`,
			type,
			occurredAt: snapshot.updatedAt,
			source: 'daemon',
			agentExecutionId: snapshot.agentExecutionId,
			taskId
		};
		if (type !== 'execution.completed') {
			return [agentExecutionEvent];
		}
		return [
			agentExecutionEvent,
			{
				eventId: `runtime:${snapshot.agentExecutionId}:task.completed:${snapshot.updatedAt}`,
				type: 'task.completed',
				occurredAt: snapshot.updatedAt,
				source: 'daemon',
				taskId
			}
		];
	}

	private createAgentExecutionStartedEvent(
		requestId: string,
		snapshot: AgentExecutionSnapshot,
		taskId: string
	): WorkflowEvent {
		const agentExecutionId = snapshot.agentExecutionId;
		const agentJournalPath = typeof this.options.adapter.getAgentExecutionJournalRelativePath === 'function'
			? this.options.adapter.getAgentExecutionJournalRelativePath(agentExecutionId)
			: undefined;
		const terminalRecordingPath = typeof this.options.adapter.getMissionTerminalRecordingRelativePath === 'function'
			? this.options.adapter.getMissionTerminalRecordingRelativePath(snapshot.agentExecutionId)
			: undefined;
		return {
			eventId: `${requestId}:execution-started`,
			type: 'execution.started',
			occurredAt: snapshot.updatedAt,
			source: 'daemon',
			causedByRequestId: requestId,
			agentExecutionId: snapshot.agentExecutionId,
			taskId,
			agentId: snapshot.agentId,
			...(agentJournalPath ? { agentJournalPath } : {}),
			...(terminalRecordingPath ? { terminalRecordingPath } : {}),
			...toTransportEventFields(snapshot)
		};
	}

	private resolveAgentExecutionTaskId(snapshot: AgentExecutionSnapshot): string | undefined {
		const directTaskId = normalizeTaskId(snapshot.taskId);
		if (directTaskId) {
			this.agentExecutionTaskIds.set(snapshot.agentExecutionId, directTaskId);
			return directTaskId;
		}
		return this.agentExecutionTaskIds.get(snapshot.agentExecutionId);
	}

	private rememberAgentExecutionTaskId(agentExecutionId: AgentExecutionId, taskId: string | undefined): void {
		const normalizedTaskId = normalizeTaskId(taskId);
		if (normalizedTaskId) {
			this.agentExecutionTaskIds.set(agentExecutionId, normalizedTaskId);
		}
	}

	private toAgentExecutionReference(execution: AgentExecutionRuntimeState): AgentExecutionReference {
		return {
			agentId: execution.agentId,
			agentExecutionId: execution.agentExecutionId,
			...(execution.transportId === 'terminal' || execution.terminalHandle
				? {
					transport: {
						kind: 'terminal',
						terminalName: execution.terminalHandle?.terminalName ?? execution.agentExecutionId,
						...(execution.terminalHandle?.terminalPaneId ? { terminalPaneId: execution.terminalHandle.terminalPaneId } : {})
					}
				}
				: {})
		};
	}

	private createTasksGeneratedEvent(
		requestId: string,
		generation: WorkflowTaskGenerationResult
	): WorkflowEvent {
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
		task: WorkflowTaskRuntimeState,
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
		generation: WorkflowTaskGenerationResult
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
					agent: task.agentAdapter ?? DEFAULT_REPOSITORY_AGENT_ADAPTER_ID
				}
			);
		}
	}

	private async readGeneratedTasksFromStageArtifacts(
		descriptor: MissionDescriptor,
		stageId: MissionStageId
	): Promise<WorkflowGeneratedTaskPayload[]> {
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
		AgentExecution: AgentExecutionRuntimeState
	): WorkflowEvent | undefined {
		void AgentExecution;
		// Reattach failures are not authoritative lifecycle facts.
		// If we cannot observe a runtime AgentExecution, keep workflow state unchanged
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
	agent: TaskDossierRecordType['agent']
): Pick<WorkflowGeneratedTaskPayload, 'agentAdapter'> | undefined {
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

function hasMatchingTerminalLifecycle(document: WorkflowStateData, snapshot: AgentExecutionSnapshot): boolean {
	const runtimeAgentExecution = document.runtime.agentExecutions.find((execution) => execution.agentExecutionId === snapshot.agentExecutionId);
	if (!runtimeAgentExecution) {
		return false;
	}
	return runtimeAgentExecution.lifecycle === snapshot.status;
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

function buildTaskArtifactLaunchPrompt(task: TaskDossierRecordType, missionWorkspaceDir: string): string {
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
	task: WorkflowTaskRuntimeState,
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

function appendPendingLaunchContext(basePrompt: string, task: WorkflowTaskRuntimeState): string {
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

function mergeGeneratedTasks(
	workflowTasks: WorkflowGeneratedTaskPayload[],
	artifactTasks: WorkflowGeneratedTaskPayload[]
): WorkflowGeneratedTaskPayload[] {
	if (artifactTasks.length === 0) {
		return workflowTasks;
	}

	const mergedByTaskId = new Map<string, WorkflowGeneratedTaskPayload>();
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
			.filter((task): task is WorkflowGeneratedTaskPayload => Boolean(task))
	);
}
