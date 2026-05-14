import type {
	WorkflowTaskArtifactReference
} from '../../workflow/engine/types.js';
import * as path from 'node:path';
import { createEntityId, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import type { AgentAdapter } from '../../daemon/runtime/agent-execution/adapter/AgentAdapter.js';
import type { AgentExecutionType } from '../AgentExecution/protocol/AgentExecutionProtocolTypes.js';
import type { AgentExecutionLaunchRequestType } from '../AgentExecution/AgentExecutionSchema.js';
import type { AgentRegistry } from '../Agent/AgentRegistry.js';
import { AgentExecution } from '../AgentExecution/AgentExecution.js';
import { DEFAULT_REPOSITORY_AGENT_ADAPTER_ID } from '../Repository/RepositorySchema.js';
import { buildTaskLaunchPrompt } from './taskLaunchPrompt.js';
import {
	evaluateMissionTaskStatusIntent,
	MISSION_STAGE_FOLDERS,
	type MissionStageId,
	type MissionTaskStatusIntent
} from '../../workflow/mission/manifest.js';
import type { WorkflowStateData } from '../../workflow/engine/index.js';
import {
	TaskDataSchema,
	TaskCommandAcknowledgementSchema,
	TaskCommandInputSchema,
	TaskConfigureInputSchema,
	TaskStartInputSchema,
	TaskCancelInputSchema,
	TaskReworkInputSchema,
	TaskConfigureCommandOptionsSchema,
	TaskStartCommandOptionsSchema,
	TaskReworkCommandInputSchema,
	TaskLocatorSchema,
	TaskCommandIds,
	taskEntityName,
	type TaskDataType,
	type TaskDossierRecordType
} from './TaskSchema.js';
import type { MissionType } from '../Mission/MissionSchema.js';

export type TaskLaunchPolicy = {
	autostart: boolean;
};

export type TaskOwner = {
	missionId: string;
	isMissionDelivered(): boolean;
	refreshTaskState(taskId: string): Promise<TaskDossierRecordType>;
	configureTask(taskId: string, input: TaskConfigureOptions): Promise<void>;
	queueTask(taskId: string, options?: { agentId?: string; prompt?: string; workingDirectory?: string; model?: string; reasoningEffort?: string; terminalName?: string }): Promise<void>;
	cancelTask(taskId: string, reason?: string): Promise<void>;
	completeTask(taskId: string): Promise<void>;
	reopenTask(taskId: string): Promise<void>;
	reworkTask(taskId: string, input: {
		actor: 'human' | 'system' | 'workflow';
		reasonCode: string;
		summary: string;
		sourceTaskId?: string;
		sourceAgentExecutionId?: string;
		artifactRefs?: WorkflowTaskArtifactReference[];
	}): Promise<void>;
	updateTaskLaunchPolicy(taskId: string, launchPolicy: TaskLaunchPolicy): Promise<void>;
	requireAgentAdapter(agentId: string): AgentAdapter;
	startTaskAgentExecution(
		task: TaskDossierRecordType,
		adapter: AgentAdapter,
		request: AgentExecutionLaunchRequestType
	): Promise<AgentExecutionType>;
	recordStartedTaskAgentExecution(snapshot: AgentExecutionType): Promise<AgentExecution>;
	recordTaskAgentExecutionLaunchFailure(taskId: string, error: unknown): Promise<void>;
};

export type TaskConfigureOptions = {
	agentAdapter?: string;
	model?: string | null;
	reasoningEffort?: string | null;
	autostart?: boolean;
	context?: NonNullable<TaskDossierRecordType['context']>;
};

export type TaskVerificationReworkRequest = {
	taskId: string;
	input: {
		actor: 'workflow';
		reasonCode: 'verification.failed';
		summary: string;
		sourceTaskId: string;
		artifactRefs: Array<{ path: string; title?: string }>;
	};
};

export class Task extends Entity<TaskDataType, string> {
	public static override readonly entityName = taskEntityName;

	public static createEntityId(missionId: string, taskId: string): string {
		return createEntityId('task', `${missionId}/${taskId}`);
	}

	public static toDataFromState(task: TaskDossierRecordType, missionId: string): TaskDataType {
		return TaskDataSchema.parse({
			id: Task.createEntityId(missionId, task.taskId),
			taskId: task.taskId,
			stageId: task.stage,
			sequence: task.sequence,
			title: task.subject,
			instruction: task.instruction,
			...(task.model ? { model: task.model } : {}),
			...(task.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {}),
			...(task.taskKind ? { taskKind: task.taskKind } : {}),
			...(task.pairedTaskId ? { pairedTaskId: task.pairedTaskId } : {}),
			lifecycle: task.status,
			dependsOn: [...task.dependsOn],
			context: [...(task.context ?? [])],
			waitingOnTaskIds: [...task.waitingOn],
			agentAdapter: task.agent,
			...(typeof task.autostart === 'boolean' ? { autostart: task.autostart } : {}),
			retries: task.retries,
			...(task.fileName ? { fileName: task.fileName } : {}),
			...(task.filePath ? { filePath: task.filePath } : {}),
			...(task.relativePath ? { relativePath: task.relativePath } : {})
		});
	}

	public static async read(payload: unknown, context: EntityExecutionContext) {
		const input = TaskLocatorSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return Task.requireData(await mission.buildMission(), input.taskId);
		} finally {
			mission.dispose();
		}
	}

	public static requireData(data: MissionType, taskId: string) {
		const task = data.tasks.find((candidate) => candidate.taskId === taskId);
		if (!task) {
			throw new Error(`Task '${taskId}' could not be resolved in Mission '${data.missionId}'.`);
		}
		return TaskDataSchema.parse(task);
	}

	public static async resolve(payload: unknown, context: EntityExecutionContext): Promise<Task> {
		const input = TaskLocatorSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return new Task(Task.requireData(await mission.buildMission(), input.taskId));
		} finally {
			mission.dispose();
		}
	}

	public static isReady(task: TaskDossierRecordType): boolean {
		return task.status === 'ready' && task.waitingOn.length === 0;
	}
	public static isActive(task: TaskDossierRecordType): boolean {
		return task.status === 'queued' || task.status === 'running';
	}

	public static resolveStartAgentId(
		task: TaskDossierRecordType,
		agentRegistry: AgentRegistry
	): string | undefined {
		const taskAdapterId = typeof task.agent === 'string' && task.agent.trim() ? task.agent.trim() : undefined;
		if (taskAdapterId) {
			const configuredAgent = agentRegistry.resolveAgent(taskAdapterId);
			if (configuredAgent) {
				return configuredAgent.agentId;
			}
		}
		return agentRegistry.resolveStartAgentId();
	}

	public static fromWorkflowState(input: {
		task: WorkflowStateData['runtime']['tasks'][number];
		index: number;
		missionDir: string;
		fileTask?: TaskDossierRecordType;
	}): TaskDossierRecordType {
		const { task, index, missionDir, fileTask } = input;
		const fileName = fileTask?.fileName ?? `${task.taskId.split('/').pop() ?? task.taskId}.md`;
		const relativePath = fileTask?.relativePath ?? [
			MISSION_STAGE_FOLDERS[task.stageId as MissionStageId],
			'tasks',
			fileName
		].join('/');
		const filePath = fileTask?.filePath ?? path.join(missionDir, ...relativePath.split('/'));
		const taskKind = task.taskKind ?? fileTask?.taskKind;
		const pairedTaskId = task.pairedTaskId ?? fileTask?.pairedTaskId;
		return {
			taskId: task.taskId,
			stage: task.stageId as MissionStageId,
			sequence: fileTask?.sequence ?? index + 1,
			subject: Task.resolveWorkflowSubject(task, fileTask, fileName),
			instruction: task.instruction,
			body: task.instruction,
			...(task.model ? { model: task.model } : {}),
			...(task.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {}),
			...(taskKind ? { taskKind } : {}),
			...(pairedTaskId ? { pairedTaskId } : {}),
			dependsOn: [...task.dependsOn],
			context: (task.context ?? []).map((contextArtifact) => ({ ...contextArtifact })),
			waitingOn: [...task.waitingOnTaskIds],
			status: task.lifecycle,
			agent: task.agentAdapter ?? fileTask?.agent ?? DEFAULT_REPOSITORY_AGENT_ADAPTER_ID,
			autostart: task.runtime.autostart,
			retries: task.retries,
			fileName,
			filePath,
			relativePath
		};
	}

	public static buildVerificationReworkRequest(input: {
		sourceTaskId: string;
		sourceWorkflowTask: { taskId: string; stageId: string; title: string; taskKind?: 'implementation' | 'verification' | undefined; pairedTaskId?: string | undefined };
		workflowTasks: Array<{ taskId: string; stageId: string; title: string; taskKind?: 'implementation' | 'verification' | undefined; pairedTaskId?: string | undefined }>;
		sourceTask: TaskDossierRecordType;
		verificationArtifact?: { relativePath?: string; fileName?: string } | undefined;
	}): TaskVerificationReworkRequest {
		const targetTask = Task.resolveVerificationReworkTarget(input.workflowTasks, input.sourceWorkflowTask);
		if (!targetTask) {
			throw new Error(`Task '${input.sourceTaskId}' is not a paired verification task with a resolvable implementation target.`);
		}

		const artifactRefs: Array<{ path: string; title?: string }> = [
			{ path: input.sourceTask.relativePath, title: input.sourceTask.subject }
		];
		if (input.verificationArtifact?.relativePath) {
			artifactRefs.push({
				path: input.verificationArtifact.relativePath,
				...(input.verificationArtifact.fileName ? { title: input.verificationArtifact.fileName } : {})
			});
		}

		return {
			taskId: targetTask.taskId,
			input: {
				actor: 'workflow',
				reasonCode: 'verification.failed',
				summary: `Verification task '${input.sourceTask.subject}' requested corrective rework for '${targetTask.title}'. Review the referenced verification evidence before restarting the implementation task.`,
				sourceTaskId: input.sourceTaskId,
				artifactRefs: dedupeArtifactRefs(artifactRefs)
			}
		};
	}

	private readonly owner: TaskOwner | undefined;
	private state: TaskDossierRecordType | undefined;

	public constructor(data: TaskDataType);
	public constructor(owner: TaskOwner, state: TaskDossierRecordType);
	public constructor(ownerOrData: TaskOwner | TaskDataType, state?: TaskDossierRecordType) {
		if (state) {
			const owner = ownerOrData as TaskOwner;
			super(Task.toDataFromState(state, owner.missionId));
			this.owner = owner;
			this.state = state;
			return;
		}

		super(TaskDataSchema.parse(ownerOrData));
		this.owner = undefined;
		this.state = undefined;
	}

	public get id(): string {
		return this.data.id;
	}

	public get taskId(): string {
		return this.state?.taskId ?? this.toData().taskId;
	}

	public toState(): TaskDossierRecordType {
		return structuredClone(this.requireState());
	}

	public async startOwned(options: { agentId?: string; prompt?: string; workingDirectory?: string; model?: string; reasoningEffort?: string; terminalName?: string } = {}): Promise<TaskDossierRecordType> {
		await this.refresh();
		this.assertCanTransition('start');
		const state = this.requireState();
		if (state.status === 'ready') {
			await this.requireOwner().queueTask(state.taskId, options);
		}
		await this.refresh();
		return this.toState();
	}

	public async configureOwned(options: TaskConfigureOptions): Promise<TaskDossierRecordType> {
		await this.refresh();
		await this.requireOwner().configureTask(this.requireState().taskId, options);
		await this.refresh();
		return this.toState();
	}

	public async startFromMissionControl(input: {
		missionWorkspacePath: string;
		agentRegistry: AgentRegistry;
		agentId?: string;
		model?: string;
		reasoningEffort?: string;
		terminalName?: string;
	}): Promise<TaskDossierRecordType> {
		await this.refresh();
		const taskState = this.toState();
		const requestedAdapterId = input.agentId?.trim();
		const agentId = requestedAdapterId
			? input.agentRegistry.requireAgent(requestedAdapterId).agentId
			: Task.resolveStartAgentId(taskState, input.agentRegistry);
		const model = input.model?.trim() || taskState.model?.trim();
		const reasoningEffort = input.reasoningEffort?.trim() || taskState.reasoningEffort?.trim();
		return this.startOwned({
			...(agentId ? { agentId } : {}),
			prompt: buildTaskLaunchPrompt(taskState, input.missionWorkspacePath),
			workingDirectory: input.missionWorkspacePath,
			...(model ? { model } : {}),
			...(reasoningEffort ? { reasoningEffort } : {}),
			...(input.terminalName?.trim() ? { terminalName: input.terminalName.trim() } : {})
		});
	}

	public async completeOwned(): Promise<TaskDossierRecordType> {
		await this.refresh();
		this.assertCanTransition('done');
		await this.requireOwner().completeTask(this.requireState().taskId);
		await this.refresh();
		return this.toState();
	}

	public async cancelOwned(reason?: string): Promise<TaskDossierRecordType> {
		await this.refresh();
		await this.requireOwner().cancelTask(this.requireState().taskId, reason);
		await this.refresh();
		return this.toState();
	}

	public async reopenOwned(): Promise<TaskDossierRecordType> {
		await this.refresh();
		this.assertCanTransition('reopen');
		await this.requireOwner().reopenTask(this.requireState().taskId);
		await this.refresh();
		return this.toState();
	}

	public async reworkOwned(input: {
		actor: 'human' | 'system' | 'workflow';
		reasonCode: string;
		summary: string;
		sourceTaskId?: string;
		sourceAgentExecutionId?: string;
		artifactRefs?: WorkflowTaskArtifactReference[];
	}): Promise<TaskDossierRecordType> {
		await this.refresh();
		this.assertCanTransition('reopen');
		await this.requireOwner().reworkTask(this.requireState().taskId, input);
		await this.refresh();
		return this.toState();
	}

	public async setAutostartOwned(autostart: boolean): Promise<TaskDossierRecordType> {
		await this.requireOwner().updateTaskLaunchPolicy(this.requireState().taskId, {
			autostart
		});
		await this.refresh();
		return this.toState();
	}

	public async launchAgentExecution(
		request: AgentExecutionLaunchRequestType
	): Promise<AgentExecution> {
		await this.prepareForAgentExecutionLaunch();
		const owner = this.requireOwner();
		const state = this.requireState();
		const adapter = owner.requireAgentAdapter(request.agentId);
		const availability = await adapter.isAvailable();
		if (!availability.available) {
			throw new Error(availability.reason ?? `${adapter.displayName} is unavailable.`);
		}

		try {
			const launchRequest = request.prompt.trim().length > 0
				? request
				: {
					...request,
					prompt: buildTaskLaunchPrompt(state, request.workingDirectory)
				};
			const snapshot = await owner.startTaskAgentExecution(state, adapter, launchRequest);
			return owner.recordStartedTaskAgentExecution(snapshot);
		} catch (error) {
			try {
				await owner.recordTaskAgentExecutionLaunchFailure(state.taskId, error);
			} catch {
				// Preserve the original launch failure when the failure-record side effect cannot be applied.
			}
			throw error;
		}
	}

	public async canConfigure() {
		return this.available();
	}

	public async canStart() {
		return this.evaluateTransitionAvailability('start');
	}

	public async canCancel() {
		const lifecycle = this.state?.status ?? this.data.lifecycle;
		return lifecycle === 'queued' || lifecycle === 'running'
			? this.available()
			: this.unavailable('Task is not queued or running.');
	}

	public async canComplete() {
		return this.evaluateTransitionAvailability('done');
	}

	public async canReopen() {
		return this.evaluateTransitionAvailability('reopen');
	}

	public async canRework() {
		return this.evaluateTransitionAvailability('reopen');
	}

	public async canReworkFromVerification() {
		const state = this.state;
		const data = this.data;
		if ((state?.taskKind ?? data.taskKind) !== 'verification' || !(state?.pairedTaskId ?? data.pairedTaskId)) {
			return this.unavailable('Task is not a paired verification task.');
		}
		return this.evaluateTransitionAvailability('reopen');
	}

	public async canEnableAutostart() {
		return (this.state?.autostart ?? this.data.autostart ?? false)
			? this.unavailable('Autostart is already enabled.')
			: this.available();
	}

	public async canDisableAutostart() {
		return (this.state?.autostart ?? this.data.autostart ?? false)
			? this.available()
			: this.unavailable('Autostart is already disabled.');
	}

	public async configure(payload: unknown, context: EntityExecutionContext) {
		const input = TaskConfigureInputSchema.parse(payload);
		const mission = await Task.loadRequiredMission(input, context);
		try {
			await mission.configureTask(input.taskId, Task.readConfigureCommandOptions(input));
			return Task.buildCommandAcknowledgement(input, 'configure', TaskCommandIds.configure);
		} finally {
			mission.dispose();
		}
	}

	public async start(payload: unknown, context: EntityExecutionContext) {
		const input = TaskStartInputSchema.parse(payload);
		const mission = await Task.loadRequiredMission(input, context);
		try {
			await mission.startTask(input.taskId, Task.readStartCommandOptions(input));
			return Task.buildCommandAcknowledgement(input, 'start', TaskCommandIds.start);
		} finally {
			mission.dispose();
		}
	}

	public async cancel(payload: unknown, context: EntityExecutionContext) {
		const input = TaskCancelInputSchema.parse(payload);
		const mission = await Task.loadRequiredMission(input, context);
		try {
			await mission.cancelTask(input.taskId, input.reason ?? 'operator cancelled task');
			return Task.buildCommandAcknowledgement(input, 'cancel', TaskCommandIds.cancel);
		} finally {
			mission.dispose();
		}
	}

	public async complete(payload: unknown, context: EntityExecutionContext) {
		const input = TaskLocatorSchema.parse(payload);
		const mission = await Task.loadRequiredMission(input, context);
		try {
			await mission.completeTask(input.taskId);
			return Task.buildCommandAcknowledgement(input, 'complete', TaskCommandIds.complete);
		} finally {
			mission.dispose();
		}
	}

	public async reopen(payload: unknown, context: EntityExecutionContext) {
		const input = TaskLocatorSchema.parse(payload);
		const mission = await Task.loadRequiredMission(input, context);
		try {
			await mission.reopenTask(input.taskId);
			return Task.buildCommandAcknowledgement(input, 'reopen', TaskCommandIds.reopen);
		} finally {
			mission.dispose();
		}
	}

	public async rework(payload: unknown, context: EntityExecutionContext) {
		const input = TaskReworkInputSchema.parse(payload);
		const mission = await Task.loadRequiredMission(input, context);
		try {
			await mission.reworkTask(input.taskId, {
				actor: 'human',
				reasonCode: 'manual.instruction',
				summary: input.input,
				artifactRefs: []
			});
			return Task.buildCommandAcknowledgement(input, 'rework', TaskCommandIds.rework);
		} finally {
			mission.dispose();
		}
	}

	public async reworkFromVerification(payload: unknown, context: EntityExecutionContext) {
		const input = TaskLocatorSchema.parse(payload);
		const mission = await Task.loadRequiredMission(input, context);
		try {
			await mission.reworkTaskFromVerification(input.taskId);
			return Task.buildCommandAcknowledgement(input, 'reworkFromVerification', TaskCommandIds.reworkFromVerification);
		} finally {
			mission.dispose();
		}
	}

	public async enableAutostart(payload: unknown, context: EntityExecutionContext) {
		const input = TaskLocatorSchema.parse(payload);
		const mission = await Task.loadRequiredMission(input, context);
		try {
			await mission.setTaskAutostart(input.taskId, true);
			return Task.buildCommandAcknowledgement(input, 'enableAutostart', TaskCommandIds.enableAutostart);
		} finally {
			mission.dispose();
		}
	}

	public async disableAutostart(payload: unknown, context: EntityExecutionContext) {
		const input = TaskLocatorSchema.parse(payload);
		const mission = await Task.loadRequiredMission(input, context);
		try {
			await mission.setTaskAutostart(input.taskId, false);
			return Task.buildCommandAcknowledgement(input, 'disableAutostart', TaskCommandIds.disableAutostart);
		} finally {
			mission.dispose();
		}
	}

	public async command(payload: unknown, context: EntityExecutionContext) {
		const input = TaskCommandInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			Task.requireData(await mission.buildMission(), input.taskId);
			switch (input.commandId) {
				case TaskCommandIds.configure:
					await mission.configureTask(input.taskId, Task.readConfigureCommandOptions(input.input));
					break;
				case TaskCommandIds.start:
					await mission.startTask(input.taskId, Task.readStartCommandOptions(input.input));
					break;
				case TaskCommandIds.cancel:
					await mission.cancelTask(input.taskId, 'operator cancelled task');
					break;
				case TaskCommandIds.complete:
					await mission.completeTask(input.taskId);
					break;
				case TaskCommandIds.reopen:
					await mission.reopenTask(input.taskId);
					break;
				case TaskCommandIds.rework:
					await mission.reworkTask(input.taskId, {
						actor: 'human',
						reasonCode: 'manual.instruction',
						summary: TaskReworkCommandInputSchema.parse(input.input),
						artifactRefs: []
					});
					break;
				case TaskCommandIds.reworkFromVerification:
					await mission.reworkTaskFromVerification(input.taskId);
					break;
				case TaskCommandIds.enableAutostart:
					await mission.setTaskAutostart(input.taskId, true);
					break;
				case TaskCommandIds.disableAutostart:
					await mission.setTaskAutostart(input.taskId, false);
					break;
				default:
					throw new Error(`Task command '${input.commandId}' is not implemented in the daemon.`);
			}
			return TaskCommandAcknowledgementSchema.parse({
				ok: true,
				entity: 'Task',
				method: 'command',
				id: input.taskId,
				missionId: input.missionId,
				taskId: input.taskId,
				commandId: input.commandId
			});
		} finally {
			mission.dispose();
		}
	}

	private static readStartCommandOptions(input: unknown): { agentAdapter?: string; model?: string; reasoningEffort?: string; terminalName?: string } {
		const record = Task.isRecord(input) ? input : {};
		const options = TaskStartCommandOptionsSchema.optional().parse({
			...(typeof record['agentAdapter'] === 'string' ? { agentAdapter: record['agentAdapter'] } : {}),
			...(typeof record['model'] === 'string' ? { model: record['model'] } : {}),
			...(typeof record['reasoningEffort'] === 'string' ? { reasoningEffort: record['reasoningEffort'] } : {}),
			...(typeof record['terminalName'] === 'string' ? { terminalName: record['terminalName'] } : {})
		});
		return {
			...(options?.agentAdapter ? { agentAdapter: options.agentAdapter } : {}),
			...(options?.model ? { model: options.model } : {}),
			...(options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
			...(options?.terminalName ? { terminalName: options.terminalName } : {})
		};
	}

	private static readConfigureCommandOptions(input: unknown): TaskConfigureOptions {
		const record = Task.isRecord(input) ? input : {};
		const options = TaskConfigureCommandOptionsSchema.parse({
			...(typeof record['agentAdapter'] === 'string' ? { agentAdapter: record['agentAdapter'] } : {}),
			...(Object.prototype.hasOwnProperty.call(record, 'model') ? { model: record['model'] } : {}),
			...(Object.prototype.hasOwnProperty.call(record, 'reasoningEffort') ? { reasoningEffort: record['reasoningEffort'] } : {}),
			...(typeof record['autostart'] === 'boolean' ? { autostart: record['autostart'] } : {}),
			...(Array.isArray(record['context']) ? { context: record['context'] } : {})
		});
		return {
			...(options.agentAdapter ? { agentAdapter: options.agentAdapter } : {}),
			...(Object.prototype.hasOwnProperty.call(options, 'model') ? { model: options.model ?? null } : {}),
			...(Object.prototype.hasOwnProperty.call(options, 'reasoningEffort') ? { reasoningEffort: options.reasoningEffort ?? null } : {}),
			...(typeof options.autostart === 'boolean' ? { autostart: options.autostart } : {}),
			...(options.context ? { context: options.context.map((contextArtifact) => ({ ...contextArtifact })) } : {})
		};
	}

	private static isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	private static async loadRequiredMission(input: { missionId: string; repositoryRootPath?: string }, context: EntityExecutionContext) {
		const service = await loadMissionRegistry(context);
		return service.loadRequiredMission(input, context);
	}

	private static buildCommandAcknowledgement(
		input: { missionId: string; taskId: string },
		method: Exclude<import('./TaskSchema.js').TaskCommandMethodType, never>,
		commandId: import('./TaskSchema.js').TaskCommandIdType
	) {
		return TaskCommandAcknowledgementSchema.parse({
			ok: true,
			entity: 'Task',
			method,
			id: input.taskId,
			missionId: input.missionId,
			taskId: input.taskId,
			commandId
		});
	}

	private evaluateTransitionAvailability(intent: MissionTaskStatusIntent) {
		const state = this.state;
		const currentStatus = state?.status ?? this.data.lifecycle;
		const waitingOn = state?.waitingOn ?? this.data.waitingOnTaskIds;
		const delivered = this.owner?.isMissionDelivered() ?? false;
		const evaluation = evaluateMissionTaskStatusIntent(intent, {
			currentStatus,
			waitingOn,
			delivered
		});
		return evaluation.enabled
			? this.available()
			: this.unavailable(evaluation.reason ?? `Task cannot transition via '${intent}'.`);
	}

	private assertCanTransition(intent: MissionTaskStatusIntent): void {
		const state = this.requireState();
		const owner = this.requireOwner();
		const evaluation = evaluateMissionTaskStatusIntent(intent, {
			currentStatus: state.status,
			waitingOn: state.waitingOn,
			delivered: owner.isMissionDelivered()
		});
		if (!evaluation.enabled) {
			throw new Error(
				evaluation.reason
					? `Task '${state.taskId}' cannot transition: ${evaluation.reason}`
					: `Task '${state.taskId}' cannot transition via '${intent}'.`
			);
		}
	}

	private async prepareForAgentExecutionLaunch(): Promise<void> {
		await this.refresh();
		const state = this.requireState();
		if (state.status === 'queued' || state.status === 'running') {
			return;
		}

		this.assertCanTransition('start');
	}

	private async refresh(): Promise<void> {
		const state = this.requireState();
		this.state = await this.requireOwner().refreshTaskState(state.taskId);
		this.updateFromData(Task.toDataFromState(this.state, this.requireOwner().missionId));
	}

	private requireOwner(): TaskOwner {
		if (!this.owner) {
			throw new Error(`Task '${this.taskId}' is not attached to a Mission owner.`);
		}
		return this.owner;
	}

	private requireState(): TaskDossierRecordType {
		if (!this.state) {
			throw new Error(`Task '${this.taskId}' is not attached to Mission runtime state.`);
		}
		return this.state;
	}

	private static resolveWorkflowSubject(
		task: WorkflowStateData['runtime']['tasks'][number],
		fileTask: TaskDossierRecordType | undefined,
		fileName: string
	): string {
		const runtimeTitle = task.title.trim();
		if (runtimeTitle.length > 0) {
			return runtimeTitle;
		}

		const fileSubject = fileTask?.subject.trim();
		if (fileSubject && fileSubject.length > 0) {
			return fileSubject;
		}

		const taskStem = task.taskId.split('/').at(-1) ?? fileName;
		const normalizedStem = stripTaskStemPrefix(stripMarkdownExtension(taskStem));
		if (normalizedStem.length > 0) {
			return normalizedStem
				.split(/[-_]+/u)
				.filter(Boolean)
				.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
				.join(' ');
		}

		return task.taskId;
	}

	private static resolveVerificationReworkTarget(
		tasks: Array<{ taskId: string; stageId: string; title: string; taskKind?: 'implementation' | 'verification' | undefined; pairedTaskId?: string | undefined }>,
		task: { taskId: string; stageId: string; title: string; taskKind?: 'implementation' | 'verification' | undefined; pairedTaskId?: string | undefined }
	) {
		if (task.taskKind !== 'verification' || !task.pairedTaskId) {
			return undefined;
		}

		return tasks.find((candidate) => candidate.taskId === task.pairedTaskId && candidate.taskKind === 'implementation');
	}
}

async function loadMissionRegistry(context: EntityExecutionContext) {
	const { requireMissionRegistry } = await import('../../daemon/MissionRegistry.js');
	return requireMissionRegistry(context);
}

function stripMarkdownExtension(fileName: string): string {
	return fileName.replace(/\.md$/iu, '');
}

function stripTaskStemPrefix(stem: string): string {
	return stem.replace(/^\d+[-_]/u, '');
}

function dedupeArtifactRefs(artifactRefs: Array<{ path: string; title?: string }>) {
	const seen = new Set<string>();
	const deduplicated: Array<{ path: string; title?: string }> = [];
	for (const artifactRef of artifactRefs) {
		if (seen.has(artifactRef.path)) {
			continue;
		}
		seen.add(artifactRef.path);
		deduplicated.push(artifactRef);
	}
	return deduplicated;
}