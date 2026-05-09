import type {
	MissionTaskArtifactReference
} from '../../workflow/engine/types.js';
import * as path from 'node:path';
import { createEntityId, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import type { AgentAdapter } from '../../daemon/runtime/agent/AgentAdapter.js';
import type { AgentExecutionSnapshot } from '../AgentExecution/AgentExecutionProtocolTypes.js';
import type { AgentExecutionLaunchRequest } from '../AgentExecution/AgentExecutionSchema.js';
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
import type { MissionTaskState } from '../Mission/MissionSchema.js';
import type { MissionStateData } from '../../workflow/engine/index.js';
import {
	TaskDataSchema,
	TaskCommandAcknowledgementSchema,
	TaskCommandInputSchema,
	TaskConfigureCommandOptionsSchema,
	TaskStartCommandOptionsSchema,
	TaskReworkCommandInputSchema,
	TaskLocatorSchema,
	TaskCommandIds,
	taskEntityName,
	type TaskDataType
} from './TaskSchema.js';
import type { MissionSnapshotType } from '../Mission/MissionSchema.js';

export type TaskLaunchPolicy = {
	autostart: boolean;
};

export type TaskOwner = {
	missionId: string;
	isMissionDelivered(): boolean;
	refreshTaskState(taskId: string): Promise<MissionTaskState>;
	configureTask(taskId: string, input: TaskConfigureOptions): Promise<void>;
	queueTask(taskId: string, options?: { agentId?: string; prompt?: string; workingDirectory?: string; model?: string; reasoningEffort?: string; terminalName?: string }): Promise<void>;
	completeTask(taskId: string): Promise<void>;
	reopenTask(taskId: string): Promise<void>;
	reworkTask(taskId: string, input: {
		actor: 'human' | 'system' | 'workflow';
		reasonCode: string;
		summary: string;
		sourceTaskId?: string;
		sourceAgentExecutionId?: string;
		artifactRefs?: MissionTaskArtifactReference[];
	}): Promise<void>;
	updateTaskLaunchPolicy(taskId: string, launchPolicy: TaskLaunchPolicy): Promise<void>;
	requireAgentAdapter(agentId: string): AgentAdapter;
	startTaskAgentExecution(
		task: MissionTaskState,
		adapter: AgentAdapter,
		request: AgentExecutionLaunchRequest
	): Promise<AgentExecutionSnapshot>;
	recordStartedTaskAgentExecution(snapshot: AgentExecutionSnapshot): Promise<AgentExecution>;
	recordTaskAgentExecutionLaunchFailure(taskId: string, error: unknown): Promise<void>;
};

export type TaskConfigureOptions = {
	agentAdapter?: string;
	model?: string | null;
	reasoningEffort?: string | null;
	autostart?: boolean;
	context?: NonNullable<MissionTaskState['context']>;
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

	public static toDataFromState(task: MissionTaskState, missionId: string): TaskDataType {
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
			return Task.requireData(await mission.buildMissionSnapshot(), input.taskId);
		} finally {
			mission.dispose();
		}
	}

	public static requireData(snapshot: MissionSnapshotType, taskId: string) {
		const task = snapshot.tasks.find((candidate) => candidate.taskId === taskId);
		if (!task) {
			throw new Error(`Task '${taskId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
		}
		return TaskDataSchema.parse(task);
	}

	public static async resolve(payload: unknown, context: EntityExecutionContext): Promise<Task> {
		const input = TaskCommandInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return new Task(Task.requireData(await mission.buildMissionSnapshot(), input.taskId));
		} finally {
			mission.dispose();
		}
	}

	public static isReady(task: MissionTaskState): boolean {
		return task.status === 'ready' && task.waitingOn.length === 0;
	}
	public static isActive(task: MissionTaskState): boolean {
		return task.status === 'queued' || task.status === 'running';
	}

	public static resolveStartAgentId(
		task: MissionTaskState,
		agentRegistry: AgentRegistry
	): string | undefined {
		const taskAdapterId = typeof task.agent === 'string' && task.agent.trim() ? task.agent.trim() : undefined;
		if (taskAdapterId) {
			return agentRegistry.requireAgent(taskAdapterId).agentId;
		}
		return agentRegistry.resolveStartAgentId();
	}

	public static fromWorkflowState(input: {
		task: MissionStateData['runtime']['tasks'][number];
		index: number;
		missionDir: string;
		fileTask?: MissionTaskState;
	}): MissionTaskState {
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
		sourceTask: MissionTaskState;
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
	private state: MissionTaskState | undefined;

	public constructor(data: TaskDataType);
	public constructor(owner: TaskOwner, state: MissionTaskState);
	public constructor(ownerOrData: TaskOwner | TaskDataType, state?: MissionTaskState) {
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

	public toState(): MissionTaskState {
		return structuredClone(this.requireState());
	}

	public async start(options: { agentId?: string; prompt?: string; workingDirectory?: string; model?: string; reasoningEffort?: string; terminalName?: string } = {}): Promise<MissionTaskState> {
		await this.refresh();
		this.assertCanTransition('start');
		const state = this.requireState();
		if (state.status === 'ready') {
			await this.requireOwner().queueTask(state.taskId, options);
		}
		await this.refresh();
		return this.toState();
	}

	public async configure(options: TaskConfigureOptions): Promise<MissionTaskState> {
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
	}): Promise<MissionTaskState> {
		await this.refresh();
		const taskState = this.toState();
		const requestedAdapterId = input.agentId?.trim();
		const agentId = requestedAdapterId
			? input.agentRegistry.requireAgent(requestedAdapterId).agentId
			: Task.resolveStartAgentId(taskState, input.agentRegistry);
		const model = input.model?.trim() || taskState.model?.trim();
		const reasoningEffort = input.reasoningEffort?.trim() || taskState.reasoningEffort?.trim();
		return this.start({
			...(agentId ? { agentId } : {}),
			prompt: buildTaskLaunchPrompt(taskState, input.missionWorkspacePath),
			workingDirectory: input.missionWorkspacePath,
			...(model ? { model } : {}),
			...(reasoningEffort ? { reasoningEffort } : {}),
			...(input.terminalName?.trim() ? { terminalName: input.terminalName.trim() } : {})
		});
	}

	public async complete(): Promise<MissionTaskState> {
		await this.refresh();
		this.assertCanTransition('done');
		await this.requireOwner().completeTask(this.requireState().taskId);
		await this.refresh();
		return this.toState();
	}

	public async reopen(): Promise<MissionTaskState> {
		await this.refresh();
		this.assertCanTransition('reopen');
		await this.requireOwner().reopenTask(this.requireState().taskId);
		await this.refresh();
		return this.toState();
	}

	public async rework(input: {
		actor: 'human' | 'system' | 'workflow';
		reasonCode: string;
		summary: string;
		sourceTaskId?: string;
		sourceAgentExecutionId?: string;
		artifactRefs?: MissionTaskArtifactReference[];
	}): Promise<MissionTaskState> {
		await this.refresh();
		this.assertCanTransition('reopen');
		await this.requireOwner().reworkTask(this.requireState().taskId, input);
		await this.refresh();
		return this.toState();
	}

	public async setAutostart(autostart: boolean): Promise<MissionTaskState> {
		await this.requireOwner().updateTaskLaunchPolicy(this.requireState().taskId, {
			autostart
		});
		await this.refresh();
		return this.toState();
	}

	public async launchAgentExecution(
		request: AgentExecutionLaunchRequest
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

	public async command(payload: unknown, context: EntityExecutionContext) {
		const input = TaskCommandInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			Task.requireData(await mission.buildMissionSnapshot(), input.taskId);
			switch (input.commandId) {
				case TaskCommandIds.configure:
					await mission.configureTask(input.taskId, Task.readConfigureCommandOptions(input.input));
					break;
				case TaskCommandIds.start:
					await mission.startTask(input.taskId, Task.readStartCommandOptions(input.input));
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
		const options = TaskStartCommandOptionsSchema.optional().parse(input);
		return {
			...(options?.agentAdapter ? { agentAdapter: options.agentAdapter } : {}),
			...(options?.model ? { model: options.model } : {}),
			...(options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
			...(options?.terminalName ? { terminalName: options.terminalName } : {})
		};
	}

	private static readConfigureCommandOptions(input: unknown): TaskConfigureOptions {
		const options = TaskConfigureCommandOptionsSchema.parse(input);
		return {
			...(options.agentAdapter ? { agentAdapter: options.agentAdapter } : {}),
			...(Object.prototype.hasOwnProperty.call(options, 'model') ? { model: options.model ?? null } : {}),
			...(Object.prototype.hasOwnProperty.call(options, 'reasoningEffort') ? { reasoningEffort: options.reasoningEffort ?? null } : {}),
			...(typeof options.autostart === 'boolean' ? { autostart: options.autostart } : {}),
			...(options.context ? { context: options.context.map((contextArtifact) => ({ ...contextArtifact })) } : {})
		};
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

	private requireState(): MissionTaskState {
		if (!this.state) {
			throw new Error(`Task '${this.taskId}' is not attached to Mission runtime state.`);
		}
		return this.state;
	}

	private static resolveWorkflowSubject(
		task: MissionStateData['runtime']['tasks'][number],
		fileTask: MissionTaskState | undefined,
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