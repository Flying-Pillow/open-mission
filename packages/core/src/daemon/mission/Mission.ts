import * as path from 'node:path';
import {
	MissionAgentEventEmitter,
	type MissionAgentDisposable
} from '../events.js';
import {
	type MissionAgentConsoleEvent,
	type MissionAgentConsoleState,
	type MissionAgentEvent,
	type MissionAgentSessionLaunchRequest,
	type MissionAgentSessionRecord
} from '../contracts.js';
import type {
	AgentCommand,
	AgentPrompt
} from '../../runtime/AgentRuntimeTypes.js';

import type { MissionDefaultAgentMode } from '../../lib/daemonConfig.js';
import { MissionSession } from './MissionSession.js';
import { MissionTask } from './MissionTask.js';
import { buildMissionTaskLaunchPrompt } from './taskLaunchPrompt.js';
import {
	MISSION_ARTIFACTS,
	MISSION_STAGES,
	MISSION_TASK_STAGE_DIRECTORIES,
	getMissionStageDefinition,
	type MissionActionDescriptor,
	type MissionCockpitProjection,
	type MissionCockpitStageRailItem,
	type MissionCockpitTreeNode,
	type MissionActionExecutionStep,
	type MissionTaskUpdate,
	type GateIntent,
	type MissionDescriptor,
	type MissionGateResult,
	type MissionArtifactKey,
	type MissionRecord,
	type MissionStageId,
	type MissionStageStatus,
	type MissionStatus,
	type MissionTaskState
} from '../../types.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import {
	MissionWorkflowController,
	MissionWorkflowRequestExecutor,
	DEFAULT_WORKFLOW_VERSION,
	createDraftMissionWorkflowRuntimeState,
	createMissionWorkflowConfigurationSnapshot,
	type MissionTaskLaunchMode,
	type MissionWorkflowEvent,
	type MissionRuntimeRecord,
	type WorkflowGlobalSettings
} from '../../workflow/engine/index.js';
import { getMissionWorkflowEventValidationErrors } from '../../workflow/engine/validation.js';
import type { AgentRunner } from '../../runtime/AgentRunner.js';
import type { AgentSessionEvent, AgentSessionSnapshot } from '../../runtime/AgentRuntimeTypes.js';

export type MissionWorkflowBindings = {
	workflow: WorkflowGlobalSettings;
	resolveWorkflow?: () => WorkflowGlobalSettings;
	taskRunners: Map<string, AgentRunner>;
	instructionsPath?: string;
	skillsPath?: string;
	defaultModel?: string;
	defaultMode?: MissionDefaultAgentMode;
};

export class Mission {
	private readonly agentConsoleEventEmitter = new MissionAgentEventEmitter<MissionAgentConsoleEvent>();
	private readonly agentEventEmitter = new MissionAgentEventEmitter<MissionAgentEvent>();
	private readonly agentRunners = new Map<string, AgentRunner>();
	private readonly consoleStates = new Map<string, MissionAgentConsoleState>();
	private descriptor: MissionDescriptor;
	private agentSessions: MissionAgentSessionRecord[] = [];
	private lastKnownStatus: MissionStatus | undefined;
	private readonly workflowRequestExecutor: MissionWorkflowRequestExecutor;
	private readonly workflowController: MissionWorkflowController;
	private readonly workflowResolver: () => WorkflowGlobalSettings;
	private readonly runtimeEventSubscription: MissionAgentDisposable;

	public readonly onDidAgentConsoleEvent = this.agentConsoleEventEmitter.event;
	public readonly onDidAgentEvent = this.agentEventEmitter.event;

	private constructor(
		private readonly adapter: FilesystemAdapter,
		private readonly missionDir: string,
		descriptor: MissionDescriptor,
		workflowBindings: MissionWorkflowBindings
	) {
		this.descriptor = descriptor;
		this.workflowResolver = workflowBindings.resolveWorkflow ?? (() => workflowBindings.workflow);
		for (const [runnerId, runner] of workflowBindings.taskRunners) {
			this.agentRunners.set(runnerId, runner);
		}
		this.workflowRequestExecutor = new MissionWorkflowRequestExecutor({
			adapter: this.adapter,
			runners: workflowBindings.taskRunners,
			...(workflowBindings.instructionsPath
				? { instructionsPath: workflowBindings.instructionsPath }
				: {}),
			...(workflowBindings.skillsPath ? { skillsPath: workflowBindings.skillsPath } : {}),
			...(workflowBindings.defaultModel ? { defaultModel: workflowBindings.defaultModel } : {}),
			...(workflowBindings.defaultMode ? { defaultMode: workflowBindings.defaultMode } : {})
		});
		this.runtimeEventSubscription = this.workflowRequestExecutor.onDidRuntimeEvent((event) => {
			this.handleRuntimeEvent(event);
		});
		this.workflowController = new MissionWorkflowController({
			adapter: this.adapter,
			descriptor,
			workflow: workflowBindings.workflow,
			resolveWorkflow: this.workflowResolver,
			requestExecutor: this.workflowRequestExecutor
		});
	}

	public static hydrate(
		adapter: FilesystemAdapter,
		missionDir: string,
		descriptor: MissionDescriptor,
		workflowBindings: MissionWorkflowBindings
	): Mission {
		return new Mission(adapter, missionDir, descriptor, workflowBindings);
	}

	public async initialize(): Promise<this> {
		await this.adapter.initializeMissionEnvironment(this.missionDir);
		await this.adapter.writeMissionDescriptor(this.missionDir, this.descriptor);
		await this.workflowController.initialize();
		return this.refresh();
	}

	public getMissionDir(): string {
		return this.missionDir;
	}

	public getRecord(): MissionRecord {
		const workspaceDir = this.adapter.getMissionWorkspacePath(this.missionDir);
		const flightDeckDir = this.adapter.getMissionFlightDeckPath(this.missionDir);
		return {
			id: this.descriptor.missionId,
			brief: { ...this.descriptor.brief },
			missionDir: workspaceDir,
			missionRootDir: this.missionDir,
			flightDeckDir,
			branchRef: this.descriptor.branchRef,
			createdAt: this.descriptor.createdAt,
			stage: this.lastKnownStatus?.stage ?? 'prd',
			agentSessions: this.getAgentSessions()
		};
	}

	public async refresh(): Promise<this> {
		const nextDescriptor = await this.adapter.readMissionDescriptor(this.missionDir);
		if (!nextDescriptor) {
			throw new Error(`Mission state is missing at '${this.missionDir}'.`);
		}

		this.descriptor = nextDescriptor;
		const document = await this.workflowController.refresh();
		this.syncAgentSessions(document);
		this.lastKnownStatus = await this.buildStatus(document);
		return this;
	}

	public async status(): Promise<MissionStatus> {
		const nextDescriptor = await this.adapter.readMissionDescriptor(this.missionDir);
		if (nextDescriptor) {
			this.descriptor = nextDescriptor;
		}

		const refreshedDocument = await this.workflowController.refresh();
		let document = refreshedDocument;
		if (refreshedDocument) {
			try {
				document = await this.workflowController.reconcileSessions();
			} catch {
				document = refreshedDocument;
			}
		}
		this.syncAgentSessions(document);
		this.lastKnownStatus = await this.buildStatus(document);
		return this.lastKnownStatus;
	}

	public async startWorkflow(): Promise<MissionStatus> {
		const document = await this.workflowController.startFromDraft({
			occurredAt: new Date().toISOString(),
			source: 'human',
			startMission: true
		});
		this.syncAgentSessions(document);
		this.lastKnownStatus = await this.buildStatus(document);
		return this.lastKnownStatus;
	}

	public getAgentSessions(): MissionAgentSessionRecord[] {
		return this.agentSessions.map((record) => MissionSession.cloneRecord(record));
	}

	public getAgentSession(sessionId: string): MissionAgentSessionRecord | undefined {
		const record = this.agentSessions.find((candidate) => candidate.sessionId === sessionId);
		return record ? MissionSession.cloneRecord(record) : undefined;
	}

	public getAgentConsoleState(sessionId: string): MissionAgentConsoleState | undefined {
		const state = this.consoleStates.get(sessionId);
		return state ? cloneMissionAgentConsoleState(state) : undefined;
	}

	public async launchAgentSession(
		request: MissionAgentSessionLaunchRequest
	): Promise<MissionAgentSessionRecord> {
		if (!request.taskId) {
			throw new Error('Mission task sessions require an explicit taskId.');
		}

		const task = await this.requireTask(request.taskId);
		const session = await task.launchSession(request);
		return session.toRecord();
	}

	public async cancelAgentSession(
		sessionId: string,
		reason?: string
	): Promise<MissionAgentSessionRecord> {
		const session = this.requireAgentSession(sessionId);
		return (await session.cancel(reason)).toRecord();
	}

	public async sendAgentSessionPrompt(
		sessionId: string,
		prompt: AgentPrompt
	): Promise<MissionAgentSessionRecord> {
		const session = this.requireAgentSession(sessionId);
		return (await session.sendPrompt(prompt)).toRecord();
	}

	public async sendAgentSessionCommand(
		sessionId: string,
		command: AgentCommand
	): Promise<MissionAgentSessionRecord> {
		const session = this.requireAgentSession(sessionId);
		return (await session.sendCommand(command)).toRecord();
	}

	public async terminateAgentSession(
		sessionId: string,
		reason?: string
	): Promise<MissionAgentSessionRecord> {
		const session = this.requireAgentSession(sessionId);
		return (await session.terminate(reason)).toRecord();
	}

	public dispose(): void {
		this.consoleStates.clear();
		this.runtimeEventSubscription.dispose();
		this.workflowRequestExecutor.dispose();
		this.agentConsoleEventEmitter.dispose();
		this.agentEventEmitter.dispose();
	}

	public async evaluateGate(intent: GateIntent): Promise<MissionGateResult> {
		const status = await this.status();
		const errors: string[] = [];
		const warnings: string[] = [];
		const currentBranch = this.adapter.getCurrentBranch(this.adapter.getMissionWorkspacePath(this.missionDir));
		const gateIntent = intent === 'commit' ? 'implement' : intent;
		const gate = status.workflow?.gates.find((candidate) => candidate.intent === gateIntent);

		if (this.isDelivered(status.stages ?? [])) {
			errors.push('This mission has already been delivered.');
		}

		if (status.branchRef && currentBranch && currentBranch !== 'HEAD' && currentBranch !== status.branchRef) {
			errors.push(`Current branch '${currentBranch}' does not match mission branch '${status.branchRef}'.`);
		}
		if (!gate) {
			errors.push(`Workflow gate '${gateIntent}' is not defined.`);
		} else if (gate.state !== 'passed') {
			errors.push(...gate.reasons);
		}

		return {
			allowed: errors.length === 0,
			intent,
			...(status.stage ? { stage: status.stage } : {}),
			errors,
			warnings
		};
	}

	public async deliver(): Promise<MissionRecord> {
		const gate = await this.evaluateGate('deliver');
		if (!gate.allowed) {
			throw new Error(gate.errors.join(' | '));
		}

		await this.workflowController.applyEvent(this.createWorkflowEvent('mission.delivered', {}));
		await this.status();
		return this.getRecord();
	}

	public async executeAction(
		actionId: string,
		steps: MissionActionExecutionStep[] = []
	): Promise<MissionStatus> {
		if (steps.length > 0) {
			throw new Error(`Mission action '${actionId}' does not accept input steps.`);
		}

		if (actionId === MISSION_ACTION_IDS.pause) {
			await this.pauseMission();
			return this.status();
		}
		if (actionId === MISSION_ACTION_IDS.resume) {
			await this.resumeMission();
			return this.status();
		}
		if (actionId === MISSION_ACTION_IDS.panicStop) {
			await this.panicStopMission();
			return this.status();
		}
		if (actionId === MISSION_ACTION_IDS.clearPanic) {
			await this.clearMissionPanic();
			return this.status();
		}
		if (actionId === MISSION_ACTION_IDS.deliver) {
			await this.deliver();
			return this.status();
		}
		if (actionId.startsWith('generation.tasks.')) {
			await this.generateTasksForStage(actionId.slice('generation.tasks.'.length) as MissionStageId);
			return this.status();
		}
		if (actionId.startsWith('task.start.')) {
			await this.startTask(actionId.slice('task.start.'.length));
			return this.status();
		}
		if (actionId.startsWith('task.launch.')) {
			await this.launchTaskAction(actionId.slice('task.launch.'.length));
			return this.status();
		}
		if (actionId.startsWith('task.done.')) {
			await this.completeTask(actionId.slice('task.done.'.length));
			return this.status();
		}
		if (actionId.startsWith('task.block.')) {
			await this.blockTask(actionId.slice('task.block.'.length));
			return this.status();
		}
		if (actionId.startsWith('task.reopen.')) {
			await this.reopenTask(actionId.slice('task.reopen.'.length));
			return this.status();
		}
		if (actionId.startsWith('task.autostart.enable.')) {
			await this.setTaskAutostart(actionId.slice('task.autostart.enable.'.length), true);
			return this.status();
		}
		if (actionId.startsWith('task.autostart.disable.')) {
			await this.setTaskAutostart(actionId.slice('task.autostart.disable.'.length), false);
			return this.status();
		}
		if (actionId.startsWith('task.launch-mode.automatic.')) {
			await this.setTaskLaunchMode(actionId.slice('task.launch-mode.automatic.'.length), 'automatic');
			return this.status();
		}
		if (actionId.startsWith('task.launch-mode.manual.')) {
			await this.setTaskLaunchMode(actionId.slice('task.launch-mode.manual.'.length), 'manual');
			return this.status();
		}
		if (actionId.startsWith('session.cancel.')) {
			await this.cancelAgentSession(actionId.slice('session.cancel.'.length));
			return this.status();
		}
		if (actionId.startsWith('session.terminate.')) {
			await this.terminateAgentSession(actionId.slice('session.terminate.'.length));
			return this.status();
		}

		throw new Error(`Unknown mission action '${actionId}'.`);
	}

	public async updateTaskState(taskId: string, changes: MissionTaskUpdate): Promise<MissionTaskState> {
		const task = await this.requireTask(taskId);
		if (changes.status === 'active') {
			return task.start();
		}
		if (changes.status === 'done') {
			return task.complete();
		}
		if (changes.status === 'blocked') {
			return task.block('Marked blocked by operator.');
		}
		return task.toState();
	}

	public async pauseMission(): Promise<void> {
		await this.workflowController.applyEvent(
			this.createWorkflowEvent('mission.paused', { reason: 'human-requested' })
		);
		await this.status();
	}

	public async resumeMission(): Promise<void> {
		await this.workflowController.applyEvent(this.createWorkflowEvent('mission.resumed', {}));
		await this.status();
	}

	public async panicStopMission(): Promise<void> {
		await this.workflowController.applyEvent(this.createWorkflowEvent('mission.panic.requested', {}));
		await this.status();
	}

	public async clearMissionPanic(): Promise<void> {
		await this.workflowController.applyEvent(this.createWorkflowEvent('mission.panic.cleared', {}));
		await this.status();
	}

	public async startTask(taskId: string): Promise<void> {
		await (await this.requireTask(taskId)).start();
	}

	public async completeTask(taskId: string): Promise<void> {
		await (await this.requireTask(taskId)).complete();
	}

	public async blockTask(taskId: string): Promise<void> {
		await (await this.requireTask(taskId)).block();
	}

	public async reopenTask(taskId: string): Promise<void> {
		await (await this.requireTask(taskId)).reopen();
	}

	public async setTaskAutostart(taskId: string, autostart: boolean): Promise<void> {
		await (await this.requireTask(taskId)).setAutostart(autostart);
	}

	public async setTaskLaunchMode(
		taskId: string,
		launchMode: MissionTaskLaunchMode
	): Promise<void> {
		await (await this.requireTask(taskId)).setLaunchMode(launchMode);
	}

	public async generateTasksForStage(stageId: MissionStageId): Promise<void> {
		const document = await this.workflowController.getDocument();
		const eligibleStageId = this.resolveCurrentStageFromWorkflow(document);
		if (eligibleStageId !== stageId) {
			throw new Error(`Tasks can only be generated for the eligible stage '${eligibleStageId}'.`);
		}
		if (document.runtime.tasks.some((task) => task.stageId === stageId)) {
			throw new Error(`Stage '${stageId}' already has generated tasks.`);
		}
		const generationRule = document.configuration.workflow.taskGeneration.find(
			(candidate) => candidate.stageId === stageId
		);
		if (!generationRule || generationRule.templateSources.length === 0) {
			throw new Error(`Stage '${stageId}' does not support task generation.`);
		}

		await this.workflowController.refresh();
		const refreshedDocument = await this.workflowController.getDocument();
		if (!refreshedDocument.runtime.tasks.some((task) => task.stageId === stageId)) {
			throw new Error(`Task generation for stage '${stageId}' produced no runtime tasks.`);
		}
		await this.status();
	}

	private async buildStatus(document?: MissionRuntimeRecord): Promise<MissionStatus> {
		const persistedDocument = document ?? await this.workflowController.getPersistedDocument();
		if (!persistedDocument) {
			return this.buildDraftStatus();
		}
		const stages = await this.buildWorkflowStageStatuses(persistedDocument);
		const currentStageId = this.resolveCurrentStageFromWorkflow(persistedDocument);
		const currentStage = stages.find((stage) => stage.stage === currentStageId) ?? stages[0];
		const activeTasks = this.resolveActiveTasks(currentStage);
		const readyTasks = this.resolveReadyTasks(currentStage);
		const productFiles = await this.collectProductFiles();
		const sessions = this.getAgentSessions();
		const cockpit = this.buildCockpitProjection(persistedDocument.configuration, stages, sessions, productFiles);

		return {
			found: true,
			missionId: this.descriptor.missionId,
			title: this.descriptor.brief.title,
			...(this.descriptor.brief.issueId !== undefined ? { issueId: this.descriptor.brief.issueId } : {}),
			type: this.descriptor.brief.type,
			stage: currentStageId,
			branchRef: this.descriptor.branchRef,
			missionDir: this.adapter.getMissionWorkspacePath(this.missionDir),
			missionRootDir: this.missionDir,
			flightDeckDir: this.adapter.getMissionFlightDeckPath(this.missionDir),
			productFiles,
			...(activeTasks.length > 0 ? { activeTasks } : {}),
			...(readyTasks.length > 0 ? { readyTasks } : {}),
			stages,
			agentSessions: sessions,
			cockpit,
			workflow: {
				lifecycle: persistedDocument.runtime.lifecycle,
				pause: { ...persistedDocument.runtime.pause },
				panic: { ...persistedDocument.runtime.panic },
				...(currentStageId ? { currentStageId } : {}),
				configuration: persistedDocument.configuration,
				stages: persistedDocument.runtime.stages.map((stage) => ({
					...stage,
					taskIds: [...stage.taskIds],
					readyTaskIds: [...stage.readyTaskIds],
					queuedTaskIds: [...stage.queuedTaskIds],
					runningTaskIds: [...stage.runningTaskIds],
					blockedTaskIds: [...stage.blockedTaskIds],
					completedTaskIds: [...stage.completedTaskIds]
				})),
				tasks: persistedDocument.runtime.tasks.map((task) => ({
					...task,
					dependsOn: [...task.dependsOn],
					blockedByTaskIds: [...task.blockedByTaskIds],
					runtime: { ...task.runtime }
				})),
				gates: persistedDocument.runtime.gates.map((gateProjection) => ({
					...gateProjection,
					reasons: [...gateProjection.reasons]
				})),
				updatedAt: persistedDocument.runtime.updatedAt
			},
			recommendedAction: this.buildRecommendedAction(currentStageId, activeTasks, readyTasks),
			availableActions: this.buildAvailableActions(
				persistedDocument.configuration,
				persistedDocument.runtime,
				sessions
			)
		};
	}

	private async buildDraftStatus(): Promise<MissionStatus> {
		const workflow = this.workflowResolver();
		const configuration = createMissionWorkflowConfigurationSnapshot({
			createdAt: this.descriptor.createdAt,
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow
		});
		const runtime = createDraftMissionWorkflowRuntimeState(configuration, this.descriptor.createdAt);
		const stages: MissionStageStatus[] = MISSION_STAGES.map((stageId) => ({
			stage: stageId,
			directoryName: MISSION_TASK_STAGE_DIRECTORIES[stageId],
			status: 'pending',
			taskCount: 0,
			completedTaskCount: 0,
			activeTaskIds: [],
			readyTaskIds: [],
			tasks: []
		}));
		const currentStageId = (workflow.stageOrder[0] as MissionStageId | undefined) ?? 'prd';
		const productFiles = await this.collectProductFiles();
		const cockpit = this.buildCockpitProjection(configuration, stages, [], productFiles);

		return {
			found: true,
			missionId: this.descriptor.missionId,
			title: this.descriptor.brief.title,
			...(this.descriptor.brief.issueId !== undefined ? { issueId: this.descriptor.brief.issueId } : {}),
			type: this.descriptor.brief.type,
			stage: currentStageId,
			branchRef: this.descriptor.branchRef,
			missionDir: this.adapter.getMissionWorkspacePath(this.missionDir),
			missionRootDir: this.missionDir,
			flightDeckDir: this.adapter.getMissionFlightDeckPath(this.missionDir),
			productFiles,
			stages,
			agentSessions: [],
			cockpit,
			workflow: {
				lifecycle: runtime.lifecycle,
				pause: { ...runtime.pause },
				panic: { ...runtime.panic },
				currentStageId,
				configuration,
				stages: runtime.stages.map((stage) => ({
					...stage,
					taskIds: [...stage.taskIds],
					readyTaskIds: [...stage.readyTaskIds],
					queuedTaskIds: [...stage.queuedTaskIds],
					runningTaskIds: [...stage.runningTaskIds],
					blockedTaskIds: [...stage.blockedTaskIds],
					completedTaskIds: [...stage.completedTaskIds]
				})),
				tasks: [],
				gates: runtime.gates.map((gateProjection) => ({
					...gateProjection,
					reasons: [...gateProjection.reasons]
				})),
				updatedAt: runtime.updatedAt
			},
			recommendedAction: 'Mission is still draft. Start the workflow to capture repository settings and initialize tasks.',
			availableActions: this.buildAvailableActions(configuration, runtime, [])
		};
	}

	private async buildWorkflowStageStatuses(
		document: MissionRuntimeRecord
	): Promise<MissionStageStatus[]> {
		return MISSION_STAGES.map((stageId) => {
			const runtimeStage = document.runtime.stages.find((stage) => stage.stageId === stageId);
			const runtimeTasks = document.runtime.tasks.filter((task) => task.stageId === stageId);
			const tasks = runtimeTasks.map((task, index) => this.toWorkflowProjectedTaskState(task, index));
			return {
				stage: stageId,
				directoryName: MISSION_TASK_STAGE_DIRECTORIES[stageId],
				status:
					document.runtime.lifecycle === 'delivered' && stageId === 'delivery'
						? 'done'
						: tasks.length === 0 && runtimeStage?.lifecycle === 'blocked'
							? 'pending'
							: this.toLegacyStageProgress(runtimeStage?.lifecycle),
				taskCount: tasks.length,
				completedTaskCount: tasks.filter((task) => task.status === 'done').length,
				activeTaskIds: tasks.filter((task) => task.status === 'active').map((task) => task.taskId),
				readyTaskIds: tasks.filter((task) => this.isTaskReady(task)).map((task) => task.taskId),
				tasks
			};
		});
	}

	private buildCockpitProjection(
		configuration: MissionRuntimeRecord['configuration'],
		stages: MissionStageStatus[],
		sessions: MissionAgentSessionRecord[],
		productFiles: Partial<Record<MissionArtifactKey, string>>
	): MissionCockpitProjection {
		return {
			stageRail: stages.map((stage) => this.toCockpitStageRailItem(stage, configuration)),
			treeNodes: this.buildCockpitTreeNodes(configuration, stages, sessions, productFiles)
		};
	}

	private toCockpitStageRailItem(
		stage: MissionStageStatus,
		configuration: MissionRuntimeRecord['configuration']
	): MissionCockpitStageRailItem {
		return {
			id: stage.stage,
			label: this.resolveCockpitStageLabel(stage.stage, configuration),
			state: this.toCockpitStageRailState(stage.status),
			subtitle: `${String(stage.completedTaskCount)}/${String(stage.taskCount)}`
		};
	}

	private buildCockpitTreeNodes(
		configuration: MissionRuntimeRecord['configuration'],
		stages: MissionStageStatus[],
		sessions: MissionAgentSessionRecord[],
		productFiles: Partial<Record<MissionArtifactKey, string>>
	): MissionCockpitTreeNode[] {
		const nodes: MissionCockpitTreeNode[] = [];
		for (const stage of stages) {
			const stageArtifactPath = this.resolveStageArtifactPath(stage.stage, productFiles);
			nodes.push({
				id: `tree:stage:${stage.stage}`,
				label: this.resolveCockpitStageLabel(stage.stage, configuration),
				kind: 'stage',
				depth: 0,
				color: this.progressTone(stage.status),
				collapsible: Boolean(stageArtifactPath) || stage.tasks.length > 0,
				stageId: stage.stage
			});

			if (stageArtifactPath) {
				nodes.push({
					id: `tree:stage-artifact:${stage.stage}`,
					label: path.basename(stageArtifactPath),
					kind: 'stage-artifact',
					depth: 1,
					color: this.progressTone(stage.status),
					collapsible: false,
					sourcePath: stageArtifactPath,
					stageId: stage.stage
				});
			}

			for (const task of stage.tasks) {
				const taskColor = this.progressTone(task.status);
				nodes.push({
					id: `tree:task:${task.taskId}`,
					label: `${String(task.sequence)} ${task.subject}`,
					kind: 'task',
					depth: 1,
					color: taskColor,
					collapsible: Boolean(task.filePath) || sessions.some((session) => session.taskId === task.taskId),
					stageId: stage.stage,
					taskId: task.taskId
				});

				const taskSessions = sessions
					.filter((session) => session.taskId === task.taskId)
					.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
				for (const session of taskSessions) {
					nodes.push({
						id: `tree:session:${session.sessionId}`,
						label: `${session.runtimeId} ${session.sessionId.slice(-4)}`,
						kind: 'session',
						depth: 2,
						color: this.sessionTone(session.lifecycleState, taskColor),
						collapsible: false,
						stageId: stage.stage,
						taskId: task.taskId,
						sessionId: session.sessionId
					});
				}

				if (task.filePath) {
					nodes.push({
						id: `tree:task-artifact:${task.taskId}`,
						label: task.fileName,
						kind: 'task-artifact',
						depth: 2,
						color: taskColor,
						collapsible: false,
						sourcePath: task.filePath,
						stageId: stage.stage,
						taskId: task.taskId
					});
				}
			}
		}
		return nodes;
	}

	private resolveCockpitStageLabel(
		stageId: MissionStageId,
		configuration: MissionRuntimeRecord['configuration']
	): string {
		const configuredLabel = configuration.workflow.stages[stageId]?.displayName?.trim();
		if (configuredLabel) {
			return configuredLabel.toUpperCase();
		}
		return stageId.toUpperCase();
	}

	private resolveStageArtifactPath(
		stageId: MissionStageId,
		productFiles: Partial<Record<MissionArtifactKey, string>>
	): string | undefined {
		for (const artifactKey of getMissionStageDefinition(stageId).artifacts) {
			const filePath = productFiles[artifactKey];
			if (filePath) {
				return filePath;
			}
		}
		return undefined;
	}

	private toCockpitStageRailState(status: MissionStageStatus['status']): MissionCockpitStageRailItem['state'] {
		if (status === 'done') {
			return 'done';
		}
		if (status === 'active') {
			return 'active';
		}
		if (status === 'blocked') {
			return 'blocked';
		}
		return 'pending';
	}

	private progressTone(status: MissionStageStatus['status'] | MissionTaskState['status']): string {
		if (status === 'done') {
			return '#3fb950';
		}
		if (status === 'active') {
			return '#58a6ff';
		}
		if (status === 'blocked') {
			return '#d29922';
		}
		return '#8b949e';
	}

	private sessionTone(state: string, fallbackColor: string): string {
		if (state === 'running') {
			return '#3fb950';
		}
		if (state === 'failed') {
			return '#f85149';
		}
		if (state === 'cancelled') {
			return '#d29922';
		}
		if (state === 'completed') {
			return '#f0f6fc';
		}
		return fallbackColor;
	}

	private toWorkflowProjectedTaskState(
		task: MissionRuntimeRecord['runtime']['tasks'][number],
		index: number
	): MissionTaskState {
		const fileName = `${task.taskId.split('/').pop() ?? task.taskId}.md`;
		const relativePath =
			[
				'flight-deck',
				MISSION_TASK_STAGE_DIRECTORIES[task.stageId as MissionStageId],
				'tasks',
				fileName
			].join('/');
		const filePath = path.join(this.missionDir, ...relativePath.split('/'));
		return {
			taskId: task.taskId,
			stage: task.stageId as MissionStageId,
			sequence: index + 1,
			subject: task.title,
			instruction: task.instruction,
			body: task.instruction,
			dependsOn: [...task.dependsOn],
			blockedBy: [...task.blockedByTaskIds],
			status: this.toLegacyTaskStatus(task.lifecycle),
			agent: task.agentRunner ?? 'copilot',
			retries: task.retries,
			fileName,
			filePath,
			relativePath
		};
	}

	private toLegacyTaskStatus(
		lifecycle: MissionRuntimeRecord['runtime']['tasks'][number]['lifecycle']
	): MissionTaskState['status'] {
		switch (lifecycle) {
			case 'completed':
				return 'done';
			case 'queued':
			case 'running':
				return 'active';
			case 'blocked':
			case 'failed':
			case 'cancelled':
				return 'blocked';
			case 'pending':
			case 'ready':
			default:
				return 'todo';
		}
	}

	private toLegacyStageProgress(
		lifecycle: MissionRuntimeRecord['runtime']['stages'][number]['lifecycle'] | undefined
	): MissionStageStatus['status'] {
		switch (lifecycle) {
			case 'completed':
				return 'done';
			case 'active':
			case 'blocked':
				return 'active';
			case 'ready':
				return 'pending';
			case 'pending':
			default:
				return 'pending';
		}
	}

	private resolveCurrentStageFromWorkflow(document: MissionRuntimeRecord): MissionStageId {
		return ((
			(document.runtime.stages.find((stage) => stage.lifecycle !== 'completed')?.stageId as MissionStageId | undefined) ??
			(document.configuration.workflow.stageOrder[
				document.configuration.workflow.stageOrder.length - 1
			] as MissionStageId | undefined) ??
			'prd'
		) as MissionStageId);
	}

	private createWorkflowEvent(
		type: MissionWorkflowEvent['type'],
		payload: Record<string, unknown>
	): MissionWorkflowEvent {
		return {
			eventId: `${this.descriptor.missionId}:${type}:${Date.now().toString(36)}`,
			type,
			occurredAt: new Date().toISOString(),
			source: 'human',
			...payload
		} as MissionWorkflowEvent;
	}

	private buildAvailableActions(
		configuration: MissionRuntimeRecord['configuration'],
		runtime: MissionRuntimeRecord['runtime'],
		sessions: MissionAgentSessionRecord[]
	): MissionActionDescriptor[] {
		return buildMissionAvailableActions({
			missionId: this.descriptor.missionId,
			configuration,
			runtime,
			sessions
		});
	}

	private resolveActiveTasks(stage: MissionStageStatus | undefined): MissionTaskState[] {
		if (!stage) {
			return [];
		}

		return stage.tasks.filter((task) => task.status === 'active');
	}

	private resolveReadyTasks(stage: MissionStageStatus | undefined): MissionTaskState[] {
		if (!stage) {
			return [];
		}

		return stage.tasks.filter((task) => this.isTaskReady(task));
	}

	private buildRecommendedAction(
		stage: MissionStageId,
		activeTasks: MissionTaskState[],
		readyTasks: MissionTaskState[]
	): string {
		if (this.isDelivered(this.lastKnownStatus?.stages ?? [])) {
			return 'Mission delivered.';
		}

		const blockedTask = [...activeTasks, ...readyTasks].find((task) => task.status === 'blocked');
		if (blockedTask) {
			return `Resolve the blocked task in ${blockedTask.relativePath}.`;
		}

		if (activeTasks.length > 0) {
			const leadTask = activeTasks[0];
			return activeTasks.length === 1
				? `Continue ${leadTask?.relativePath}; Mission tracks workflow state in mission.json.`
				: `Continue ${leadTask?.relativePath} and ${String(activeTasks.length - 1)} other active task(s); Mission tracks workflow state in mission.json.`;
		}

		if (readyTasks.length > 0) {
			const leadTask = readyTasks[0];
			return readyTasks.length === 1
				? `Activate the ready task through Mission controls, then continue ${leadTask?.relativePath}.`
				: `Activate one or more ready tasks through Mission controls, starting with ${leadTask?.relativePath}.`;
		}

		if (stage === 'delivery') {
			return 'Complete DELIVERY.md and deliver the mission.';
		}

		return `Review tasks/${MISSION_TASK_STAGE_DIRECTORIES[stage]} and add the next task file.`;
	}

	private async collectProductFiles(): Promise<Partial<Record<MissionArtifactKey, string>>> {
		const entries = await Promise.all(
			(Object.keys(MISSION_ARTIFACTS) as MissionArtifactKey[]).map(async (artifact) => {
				const filePath = await this.adapter.readArtifactRecord(this.missionDir, artifact).then(
					(record) => record?.filePath
				);
				const exists = await this.adapter.artifactExists(this.missionDir, artifact);
				return exists && filePath ? ([artifact, filePath] as const) : undefined;
			})
		);

		const result: Partial<Record<MissionArtifactKey, string>> = {};
		for (const entry of entries) {
			if (!entry) {
				continue;
			}
			result[entry[0]] = entry[1];
		}
		return result;
	}

	private isDelivered(stages: MissionStageStatus[]): boolean {
		return stages.some((stage) => stage.stage === 'delivery' && stage.status === 'done');
	}

	private async requireWorkflowTask(
		taskId: string
	): Promise<NonNullable<MissionStatus['workflow']>['tasks'][number]> {
		const status = this.lastKnownStatus ?? (await this.status());
		const task = status.workflow?.tasks.find((candidate) => candidate.taskId === taskId);
		if (!task) {
			throw new Error(`Mission workflow task '${taskId}' does not exist.`);
		}
		return task;
	}

	private async requireTaskState(taskId: string): Promise<MissionTaskState> {
		const status = this.lastKnownStatus ?? (await this.status());
		for (const stage of status.stages ?? []) {
			const task = stage.tasks.find((candidate) => candidate.taskId === taskId);
			if (task) {
				return task;
			}
		}

		throw new Error(`Mission task '${taskId}' does not exist.`);
	}

	private isTaskReady(task: MissionTaskState): boolean {
		return task.status === 'todo' && task.blockedBy.length === 0;
	}

	private async requireTask(taskId: string): Promise<MissionTask> {
		const task = await this.requireTaskState(taskId);
		return this.createTask(task);
	}

	private requireAgentRunner(runtimeId: string): AgentRunner {
		const runner = this.agentRunners.get(runtimeId);
		if (!runner) {
			throw new Error(`Mission agent runner '${runtimeId}' is not registered.`);
		}
		return runner;
	}

	private resolveDefaultRuntimeId(): string {
		const runtimeId = this.agentRunners.keys().next().value;
		if (!runtimeId) {
			throw new Error('No mission agent runners are configured for this mission.');
		}
		return runtimeId;
	}

	private async startTaskRuntimeSession(
		task: MissionTaskState,
		runner: AgentRunner,
		request: MissionAgentSessionLaunchRequest
	): Promise<AgentSessionSnapshot> {
		return this.workflowController.startRuntimeSession({
			runtimeId: runner.id,
			request: {
				missionId: this.descriptor.missionId,
				taskId: task.taskId,
				workingDirectory: request.workingDirectory,
				transportId: request.transportId ?? runner.transportId,
				initialPrompt: {
					source: 'operator',
					text: request.prompt,
					...(request.title ? { title: request.title } : task.subject ? { title: task.subject } : {})
				}
			}
		});
	}

	private async recordStartedTaskSession(snapshot: AgentSessionSnapshot): Promise<MissionSession> {
		await this.workflowController.applyEvent({
			eventId: `${this.descriptor.missionId}:session-started:${snapshot.sessionId}`,
			type: 'session.started',
			occurredAt: snapshot.updatedAt,
			source: 'daemon',
			sessionId: snapshot.sessionId,
			taskId: snapshot.taskId,
			runtimeId: snapshot.runtimeId,
			...(snapshot.transportId ? { transportId: snapshot.transportId } : {})
		});
		await this.refresh();
		this.emitSyntheticSessionStart(snapshot);
		return this.requireAgentSession(snapshot.sessionId);
	}

	private async recordTaskSessionLaunchFailure(taskId: string, error: unknown): Promise<void> {
		const failureEventNonce = Date.now().toString(36);
		await this.workflowController.applyEvent({
			eventId: `${this.descriptor.missionId}:session-launch-failed:${taskId}:${failureEventNonce}`,
			type: 'session.launch-failed',
			occurredAt: new Date().toISOString(),
			source: 'daemon',
			taskId,
			reason: error instanceof Error ? error.message : String(error)
		});
		await this.refresh();
	}

	private async launchTaskAction(taskId: string): Promise<MissionAgentSessionRecord> {
		const task = await this.requireTask(taskId);
		const taskState = task.toState();
		const status = await this.status();
		const missionDir = status.missionDir ?? this.adapter.getMissionWorkspacePath(this.missionDir);
		const session = await task.launchSession({
			runtimeId: this.resolveDefaultRuntimeId(),
			transportId: this.requireAgentRunner(this.resolveDefaultRuntimeId()).transportId,
			workingDirectory: missionDir,
			prompt: buildMissionTaskLaunchPrompt(taskState, missionDir),
			title: taskState.subject,
			assignmentLabel: taskState.relativePath,
			scope: {
				kind: 'slice',
				sliceTitle: taskState.subject,
				verificationTargets: [],
				requiredSkills: [],
				dependsOn: [...taskState.dependsOn],
				...(status.missionId ? { missionId: status.missionId } : {}),
				...(status.missionDir ? { missionDir: status.missionDir } : {}),
				stage: taskState.stage,
				taskId: taskState.taskId,
				taskTitle: taskState.subject,
				taskSummary: taskState.subject,
				taskInstruction: taskState.instruction
			},
			startFreshSession: true
		});
		return session.toRecord();
	}

	private requireAgentSessionRecord(sessionId: string): MissionAgentSessionRecord {
		const record = this.agentSessions.find((candidate) => candidate.sessionId === sessionId);
		if (!record) {
			throw new Error(`Mission agent session '${sessionId}' is not recorded in mission state.`);
		}
		return MissionSession.cloneRecord(record);
	}

	private requireAgentSession(sessionId: string): MissionSession {
		return this.createSession(this.requireAgentSessionRecord(sessionId));
	}

	private async cancelSessionRecord(
		sessionId: string,
		reason?: string
	): Promise<MissionAgentSessionRecord> {
		this.requireAgentSessionRecord(sessionId);
		await this.workflowController.cancelRuntimeSession(sessionId, reason);
		await this.refresh();
		return this.requireAgentSessionRecord(sessionId);
	}

	private async sendSessionPrompt(
		sessionId: string,
		prompt: AgentPrompt
	): Promise<MissionAgentSessionRecord> {
		await this.ensureRuntimeSessionAttached(sessionId);
		await this.workflowController.promptRuntimeSession(sessionId, prompt);
		await this.refresh();
		return this.requireAgentSessionRecord(sessionId);
	}

	private async sendSessionCommand(
		sessionId: string,
		command: AgentCommand
	): Promise<MissionAgentSessionRecord> {
		await this.ensureRuntimeSessionAttached(sessionId);
		await this.workflowController.commandRuntimeSession(sessionId, command);
		await this.refresh();
		return this.requireAgentSessionRecord(sessionId);
	}

	private async terminateSessionRecord(
		sessionId: string,
		reason?: string
	): Promise<MissionAgentSessionRecord> {
		this.requireAgentSessionRecord(sessionId);
		await this.workflowController.terminateRuntimeSession(sessionId, reason);
		await this.refresh();
		return this.requireAgentSessionRecord(sessionId);
	}

	private createTask(task: MissionTaskState): MissionTask {
		return new MissionTask({
			isMissionDelivered: () => this.isDelivered(this.lastKnownStatus?.stages ?? []),
			refreshTaskState: (taskId) => this.requireTaskState(taskId),
			readTaskLaunchPolicy: async (taskId) => {
				const taskState = await this.requireWorkflowTask(taskId);
				return {
					autostart: taskState.runtime.autostart,
					launchMode: taskState.runtime.launchMode
				};
			},
			queueTask: (taskId) => this.queueTask(taskId),
			startTaskExecution: (taskId) => this.startTaskExecution(taskId),
			completeTask: (taskId) => this.completeTaskExecution(taskId),
			blockTask: (taskId, reason) => this.blockTaskExecution(taskId, reason),
			reopenTask: (taskId) => this.reopenTaskExecution(taskId),
			updateTaskLaunchPolicy: (taskId, launchPolicy) =>
				this.updateTaskLaunchPolicy(taskId, launchPolicy),
			requireAgentRunner: (runtimeId) => this.requireAgentRunner(runtimeId),
			startTaskRuntimeSession: (taskState, runner, request) =>
				this.startTaskRuntimeSession(taskState, runner, request),
			recordStartedTaskSession: (snapshot) => this.recordStartedTaskSession(snapshot),
			recordTaskSessionLaunchFailure: (taskId, error) =>
				this.recordTaskSessionLaunchFailure(taskId, error)
		}, task);
	}

	private createSession(record: MissionAgentSessionRecord): MissionSession {
		return new MissionSession({
			sendSessionPrompt: (sessionId, prompt) => this.sendSessionPrompt(sessionId, prompt),
			sendSessionCommand: (sessionId, command) => this.sendSessionCommand(sessionId, command),
			cancelSessionRecord: (sessionId, reason) => this.cancelSessionRecord(sessionId, reason),
			terminateSessionRecord: (sessionId, reason) => this.terminateSessionRecord(sessionId, reason)
		}, record);
	}

	private async ensureRuntimeSessionAttached(sessionId: string): Promise<void> {
		if (this.workflowController.getRuntimeSession(sessionId)) {
			return;
		}
		const record = this.requireAgentSessionRecord(sessionId);
		await this.workflowController.attachRuntimeSession({
			runtimeId: record.runtimeId,
			...(record.transportId ? { transportId: record.transportId } : {}),
			sessionId: record.sessionId
		});
	}

	private syncAgentSessions(document: MissionRuntimeRecord | undefined): void {
		if (!document) {
			this.agentSessions = [];
			this.consoleStates.clear();
			return;
		}
		const runtimeSnapshots = new Map(
			this.workflowController.listRuntimeSessions().map((snapshot) => [snapshot.sessionId, snapshot] as const)
		);
		const tasksById = new Map(
			document.runtime.tasks.map((task, index) => [
				task.taskId,
				this.toWorkflowProjectedTaskState(task, index)
			] as const)
		);

		this.agentSessions = document.runtime.sessions.map((session) => {
			const runtimeSnapshot = runtimeSnapshots.get(session.sessionId);
			const task = tasksById.get(session.taskId);
			return MissionSession.createRecordFromRuntime({
				runtime: session,
				runtimeLabel: this.agentRunners.get(session.runtimeId)?.displayName ?? session.runtimeId,
				...(runtimeSnapshot ? { snapshot: runtimeSnapshot } : {}),
				...(task ? { task } : {}),
				missionId: this.descriptor.missionId,
				missionDir: this.adapter.getMissionWorkspacePath(this.missionDir)
			});
		});

		const activeSessionIds = new Set(this.agentSessions.map((session) => session.sessionId));
		for (const record of this.agentSessions) {
			if (!this.consoleStates.has(record.sessionId)) {
				this.consoleStates.set(record.sessionId, createEmptyMissionAgentConsoleState({
					awaitingInput: record.lifecycleState === 'awaiting-input',
					runtimeId: record.runtimeId,
					runtimeLabel: record.runtimeLabel,
					sessionId: record.sessionId,
					...(record.currentTurnTitle ? { title: record.currentTurnTitle } : {})
				}));
			}
		}
		for (const sessionId of [...this.consoleStates.keys()]) {
			if (!activeSessionIds.has(sessionId)) {
				this.consoleStates.delete(sessionId);
			}
		}
	}

	private emitSyntheticSessionStart(snapshot: AgentSessionSnapshot): void {
		const session = this.getAgentSession(snapshot.sessionId);
		const state = session
			? this.createSession(session).toState(snapshot)
			: MissionSession.createStateFromSnapshot({
				snapshot,
				runtimeLabel: this.agentRunners.get(snapshot.runtimeId)?.displayName ?? snapshot.runtimeId
			});
		this.agentEventEmitter.fire({
			type: 'session-started',
			state
		});
	}

	private handleRuntimeEvent(event: AgentSessionEvent): void {
		const session = this.getAgentSession(event.snapshot.sessionId);
		const state = session
			? this.createSession(session).toState(event.snapshot)
			: MissionSession.createStateFromSnapshot({
				snapshot: event.snapshot,
				runtimeLabel:
					this.agentRunners.get(event.snapshot.runtimeId)?.displayName ?? event.snapshot.runtimeId
			});
		const currentConsole = this.consoleStates.get(event.snapshot.sessionId) ?? createEmptyMissionAgentConsoleState({
			awaitingInput: state.lifecycleState === 'awaiting-input',
			runtimeId: state.runtimeId,
			runtimeLabel: state.runtimeLabel,
			sessionId: state.sessionId,
			...(state.currentTurnTitle ? { title: state.currentTurnTitle } : {})
		});

		switch (event.type) {
			case 'prompt.accepted': {
				const promptText = event.prompt.text;
				const nextState = cloneMissionAgentConsoleState({
					...currentConsole,
					lines: [...currentConsole.lines, `> ${promptText}`],
					awaitingInput: state.lifecycleState === 'awaiting-input'
				});
				this.consoleStates.set(state.sessionId, nextState);
				this.agentConsoleEventEmitter.fire({
					type: 'lines',
					lines: [`> ${promptText}`],
					state: nextState
				});
				this.agentEventEmitter.fire({
					type: 'prompt-accepted',
					prompt: promptText,
					state
				});
				return;
			}
			case 'prompt.rejected': {
				this.agentEventEmitter.fire({
					type: 'prompt-rejected',
					prompt: event.prompt.text,
					reason: event.reason,
					state
				});
				return;
			}
			case 'session.message': {
				const nextState = cloneMissionAgentConsoleState({
					...currentConsole,
					lines: [...currentConsole.lines, event.text],
					awaitingInput: state.lifecycleState === 'awaiting-input'
				});
				this.consoleStates.set(state.sessionId, nextState);
				this.agentConsoleEventEmitter.fire({
					type: 'lines',
					lines: [event.text],
					state: nextState
				});
				this.agentEventEmitter.fire({
					type: 'agent-message',
					channel: event.channel === 'stderr' ? 'stderr' : event.channel === 'stdout' ? 'stdout' : 'system',
					text: event.text,
					state
				});
				return;
			}
			case 'session.awaiting-input': {
				const nextState = cloneMissionAgentConsoleState({
					...currentConsole,
					awaitingInput: true
				});
				this.consoleStates.set(state.sessionId, nextState);
				this.agentConsoleEventEmitter.fire({
					type: 'prompt',
					state: nextState
				});
				this.agentEventEmitter.fire({
					type: 'session-state-changed',
					state: {
						...state,
						lifecycleState: 'awaiting-input'
					}
				});
				return;
			}
			case 'session.completed':
				this.agentEventEmitter.fire({
					type: 'session-completed',
					exitCode: 0,
					state
				});
				return;
			case 'session.failed':
				this.agentEventEmitter.fire({
					type: 'session-failed',
					errorMessage: event.reason,
					state
				});
				return;
			case 'session.cancelled':
				this.agentEventEmitter.fire({
					type: 'session-cancelled',
					...(event.reason ? { reason: event.reason } : {}),
					state
				});
				return;
			case 'session.terminated':
				this.agentEventEmitter.fire({
					type: 'session-cancelled',
					...(event.reason ? { reason: event.reason } : {}),
					state: {
						...state,
						lifecycleState: 'terminated'
					}
				});
				return;
			case 'session.state-changed': {
				const nextState = cloneMissionAgentConsoleState({
					...currentConsole,
					awaitingInput: state.lifecycleState === 'awaiting-input'
				});
				this.consoleStates.set(state.sessionId, nextState);
				if (state.lifecycleState === 'completed') {
					this.agentEventEmitter.fire({
						type: 'session-completed',
						exitCode: 0,
						state
					});
					return;
				}
				if (state.lifecycleState === 'failed') {
					this.agentEventEmitter.fire({
						type: 'session-failed',
						errorMessage: state.failureMessage ?? 'Agent session failed.',
						state
					});
					return;
				}
				if (state.lifecycleState === 'cancelled' || state.lifecycleState === 'terminated') {
					this.agentEventEmitter.fire({
						type: 'session-cancelled',
						...(state.failureMessage ? { reason: state.failureMessage } : {}),
						state
					});
					return;
				}
				this.agentEventEmitter.fire({
					type: 'session-state-changed',
					state
				});
				return;
			}
			default:
				return;
		}
	}

	private async applyWorkflowEvent(event: MissionWorkflowEvent): Promise<void> {
		await this.workflowController.applyEvent(event);
		this.lastKnownStatus = undefined;
	}

	private async queueTask(taskId: string): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.queued', { taskId }));
	}

	private async startTaskExecution(taskId: string): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.started', { taskId }));
	}

	private async completeTaskExecution(taskId: string): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.completed', { taskId }));
	}

	private async blockTaskExecution(taskId: string, reason?: string): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.blocked', {
			taskId,
			reason: reason ?? 'Marked blocked by operator.'
		}));
	}

	private async reopenTaskExecution(taskId: string): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.reopened', { taskId }));
	}

	private async updateTaskLaunchPolicy(
		taskId: string,
		launchPolicy: { autostart: boolean; launchMode: MissionTaskLaunchMode }
	): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.launch-policy.changed', {
			taskId,
			autostart: launchPolicy.autostart,
			launchMode: launchPolicy.launchMode
		}));
	}
}

type MissionAvailableActionsInput = {
	missionId: string;
	configuration: MissionRuntimeRecord['configuration'];
	runtime: MissionRuntimeRecord['runtime'];
	sessions: MissionAgentSessionRecord[];
};

const MISSION_ACTION_IDS = {
	pause: 'mission.pause',
	resume: 'mission.resume',
	panicStop: 'mission.panic-stop',
	clearPanic: 'mission.clear-panic',
	deliver: 'mission.deliver'
} as const;

function buildMissionAvailableActions(input: MissionAvailableActionsInput): MissionActionDescriptor[] {
	const currentStageId = resolveCurrentStageId(input);
	const eligibleStageId = resolveEligibleStageId(input);
	const actions: MissionActionDescriptor[] = [
		buildPauseMissionAction(input, currentStageId),
		buildResumeMissionAction(input, currentStageId),
		buildPanicStopAction(input, currentStageId),
		buildClearPanicAction(input, currentStageId),
		buildDeliverMissionAction(input, currentStageId)
	];

	if (eligibleStageId) {
		const generationAction = buildGenerationAction(input, eligibleStageId);
		if (generationAction) {
			actions.push(generationAction);
		}
	}

	for (const task of getOrderedTasks(input)) {
		actions.push(buildTaskStartAction(input, task));
		actions.push(buildTaskLaunchAction(input, task));
		actions.push(buildTaskDoneAction(input, task));
		actions.push(buildTaskBlockedAction(input, task));
		actions.push(buildTaskReopenAction(input, task));
		actions.push(...buildTaskLaunchPolicyActions(input, task));
	}

	for (const session of getOrderedSessions(input)) {
		const sessionTask = input.runtime.tasks.find((task) => task.taskId === session.taskId);
		const stageId = sessionTask?.stageId as MissionStageId | undefined;
		actions.push(buildSessionCancelAction(session, stageId));
		actions.push(buildSessionTerminateAction(session, stageId));
	}

	return actions;
}

function buildAvailability(
	enabled: boolean,
	reason?: string
): Pick<MissionActionDescriptor, 'enabled' | 'disabled' | 'disabledReason' | 'reason'> {
	if (enabled) {
		return { enabled: true, disabled: false, disabledReason: '' };
	}
	const disabledReason = reason ?? 'Action is unavailable.';
	return { enabled: false, disabled: true, disabledReason, reason: disabledReason };
}

function buildPauseMissionAction(
	input: MissionAvailableActionsInput,
	currentStageId: MissionStageId | undefined
): MissionActionDescriptor {
	const enabled = input.runtime.lifecycle === 'running';
	return {
		id: MISSION_ACTION_IDS.pause,
		label: 'Pause Mission',
		action: '/mission pause',
		scope: 'mission',
		...buildAvailability(enabled, describePauseUnavailable(input)),
		ui: { toolbarLabel: 'PAUSE', requiresConfirmation: false },
		flow: { targetLabel: 'MISSION', actionLabel: 'PAUSE', steps: [] },
		presentationTargets: buildMissionPresentationTargets(currentStageId)
	};
}

function buildResumeMissionAction(
	input: MissionAvailableActionsInput,
	currentStageId: MissionStageId | undefined
): MissionActionDescriptor {
	const errors = getValidationErrors(input, { type: 'mission.resumed' });
	const enabled = input.runtime.lifecycle === 'paused' && !input.runtime.panic.active && errors.length === 0;
	return {
		id: MISSION_ACTION_IDS.resume,
		label: 'Resume Mission',
		action: '/mission resume',
		scope: 'mission',
		...buildAvailability(enabled, describeResumeUnavailable(input, errors)),
		ui: { toolbarLabel: 'RESUME', requiresConfirmation: false },
		flow: { targetLabel: 'MISSION', actionLabel: 'RESUME', steps: [] },
		presentationTargets: buildMissionPresentationTargets(currentStageId)
	};
}

function buildPanicStopAction(
	input: MissionAvailableActionsInput,
	currentStageId: MissionStageId | undefined
): MissionActionDescriptor {
	const errors = getValidationErrors(input, { type: 'mission.panic.requested' });
	const enabled =
		input.runtime.lifecycle !== 'draft'
		&& input.runtime.lifecycle !== 'delivered'
		&& !input.runtime.panic.active
		&& errors.length === 0;
	return {
		id: MISSION_ACTION_IDS.panicStop,
		label: 'Panic Stop',
		action: '/mission panic',
		scope: 'mission',
		...buildAvailability(enabled, describePanicUnavailable(input, errors)),
		ui: {
			toolbarLabel: 'PANIC',
			requiresConfirmation: true,
			confirmationPrompt: 'Panic stop the mission and interrupt active work?'
		},
		flow: { targetLabel: 'MISSION', actionLabel: 'PANIC STOP', steps: [] },
		presentationTargets: buildMissionPresentationTargets(currentStageId)
	};
}

function buildClearPanicAction(
	input: MissionAvailableActionsInput,
	currentStageId: MissionStageId | undefined
): MissionActionDescriptor {
	const errors = getValidationErrors(input, { type: 'mission.panic.cleared' });
	const enabled = input.runtime.panic.active && input.runtime.lifecycle === 'panicked' && errors.length === 0;
	return {
		id: MISSION_ACTION_IDS.clearPanic,
		label: 'Clear Panic',
		action: '/mission clear-panic',
		scope: 'mission',
		...buildAvailability(enabled, describeClearPanicUnavailable(input, errors)),
		ui: {
			toolbarLabel: 'CLEAR PANIC',
			requiresConfirmation: true,
			confirmationPrompt: 'Clear the mission panic state?'
		},
		flow: { targetLabel: 'MISSION', actionLabel: 'CLEAR PANIC', steps: [] },
		presentationTargets: buildMissionPresentationTargets(currentStageId)
	};
}

function buildDeliverMissionAction(
	input: MissionAvailableActionsInput,
	currentStageId: MissionStageId | undefined
): MissionActionDescriptor {
	const errors = getValidationErrors(input, { type: 'mission.delivered' });
	return {
		id: MISSION_ACTION_IDS.deliver,
		label: 'Deliver Mission',
		action: '/mission deliver',
		scope: 'mission',
		...buildAvailability(errors.length === 0, errors[0]),
		ui: {
			toolbarLabel: 'DELIVER',
			requiresConfirmation: true,
			confirmationPrompt: 'Deliver this mission now?'
		},
		flow: { targetLabel: 'MISSION', actionLabel: 'DELIVER', steps: [] },
		presentationTargets: buildMissionPresentationTargets(currentStageId)
	};
}

function buildGenerationAction(
	input: MissionAvailableActionsInput,
	stageId: MissionStageId
): MissionActionDescriptor | undefined {
	const generationRule = input.configuration.workflow.taskGeneration.find((candidate) => candidate.stageId === stageId);
	if (!generationRule || generationRule.templateSources.length === 0) {
		return undefined;
	}
	if (input.runtime.tasks.some((task) => task.stageId === stageId)) {
		return undefined;
	}
	if (resolveEligibleStageId(input) !== stageId) {
		return undefined;
	}
	const displayName = input.configuration.workflow.stages[stageId]?.displayName ?? stageId;
	return {
		id: `generation.tasks.${stageId}`,
		label: `Generate ${displayName} Tasks`,
		action: '/generate',
		scope: 'generation',
		targetId: stageId,
		...buildAvailability(true),
		ui: { toolbarLabel: 'GENERATE TASKS', requiresConfirmation: false },
		flow: { targetLabel: displayName.toUpperCase(), actionLabel: 'GENERATE TASKS', steps: [] },
		presentationTargets: [{ scope: 'stage', targetId: stageId }, { scope: 'mission' }],
		metadata: { stageId }
	};
}

function buildTaskStartAction(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): MissionActionDescriptor {
	const errors = getValidationErrors(input, { type: 'task.queued', taskId: task.taskId });
	const enabled = task.lifecycle === 'ready' && errors.length === 0;
	return {
		id: `task.start.${task.taskId}`,
		label: 'Start Ready Task',
		action: '/task start',
		scope: 'task',
		targetId: task.taskId,
		...buildAvailability(enabled, describeTaskStartUnavailable(input, task, errors)),
		ui: { toolbarLabel: 'START TASK', requiresConfirmation: false },
		flow: { targetLabel: 'TASK', actionLabel: 'START', steps: [] },
		presentationTargets: buildTaskPresentationTargets(task.taskId, task.stageId as MissionStageId),
		metadata: {
			stageId: task.stageId as MissionStageId,
			launchMode: task.runtime.launchMode,
			autostart: task.runtime.autostart
		}
	};
}

function buildTaskLaunchAction(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): MissionActionDescriptor {
	const enabled = isTaskLaunchEnabled(input, task);
	return {
		id: `task.launch.${task.taskId}`,
		label: 'Launch Agent Session',
		action: '/launch',
		scope: 'task',
		targetId: task.taskId,
		...buildAvailability(enabled, describeTaskLaunchUnavailable(input, task)),
		ui: { toolbarLabel: 'LAUNCH', requiresConfirmation: false },
		flow: { targetLabel: 'TASK', actionLabel: 'LAUNCH', steps: [] },
		presentationTargets: buildTaskPresentationTargets(task.taskId, task.stageId as MissionStageId),
		metadata: {
			stageId: task.stageId as MissionStageId,
			launchMode: task.runtime.launchMode,
			autostart: task.runtime.autostart
		}
	};
}

function buildTaskDoneAction(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): MissionActionDescriptor {
	const errors = getValidationErrors(input, { type: 'task.completed', taskId: task.taskId });
	return {
		id: `task.done.${task.taskId}`,
		label: 'Mark Task Done',
		action: '/task done',
		scope: 'task',
		targetId: task.taskId,
		...buildAvailability(errors.length === 0, errors[0]),
		ui: { toolbarLabel: 'DONE', requiresConfirmation: true, confirmationPrompt: 'Mark this task done?' },
		flow: { targetLabel: 'TASK', actionLabel: 'DONE', steps: [] },
		presentationTargets: buildTaskPresentationTargets(task.taskId, task.stageId as MissionStageId),
		metadata: { stageId: task.stageId as MissionStageId }
	};
}

function buildTaskBlockedAction(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): MissionActionDescriptor {
	const errors = getValidationErrors(input, { type: 'task.blocked', taskId: task.taskId, reason: 'Marked blocked by operator.' });
	return {
		id: `task.block.${task.taskId}`,
		label: 'Mark Task Blocked',
		action: '/task blocked',
		scope: 'task',
		targetId: task.taskId,
		...buildAvailability(errors.length === 0, errors[0]),
		ui: { toolbarLabel: 'BLOCK TASK', requiresConfirmation: true, confirmationPrompt: 'Mark this task blocked?' },
		flow: { targetLabel: 'TASK', actionLabel: 'BLOCK', steps: [] },
		presentationTargets: buildTaskPresentationTargets(task.taskId, task.stageId as MissionStageId),
		metadata: { stageId: task.stageId as MissionStageId }
	};
}

function buildTaskReopenAction(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): MissionActionDescriptor {
	const errors = getValidationErrors(input, { type: 'task.reopened', taskId: task.taskId });
	return {
		id: `task.reopen.${task.taskId}`,
		label: 'Reopen Task',
		action: '/task reopen',
		scope: 'task',
		targetId: task.taskId,
		...buildAvailability(errors.length === 0, errors[0]),
		ui: { toolbarLabel: 'REOPEN', requiresConfirmation: true, confirmationPrompt: 'Reopen this task and invalidate downstream stage progress?' },
		flow: { targetLabel: 'TASK', actionLabel: 'REOPEN', steps: [] },
		presentationTargets: buildTaskPresentationTargets(task.taskId, task.stageId as MissionStageId),
		metadata: { stageId: task.stageId as MissionStageId }
	};
}

function buildTaskLaunchPolicyActions(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): MissionActionDescriptor[] {
	const actions: MissionActionDescriptor[] = [];
	const changeErrors = (autostart: boolean, launchMode = task.runtime.launchMode) => getValidationErrors(input, {
		type: 'task.launch-policy.changed',
		taskId: task.taskId,
		autostart,
		launchMode
	});

	if (task.runtime.autostart) {
		const errors = changeErrors(false);
		actions.push({
			id: `task.autostart.disable.${task.taskId}`,
			label: 'Disable Autostart',
			action: '/task autostart off',
			scope: 'task',
			targetId: task.taskId,
			...buildAvailability(errors.length === 0, errors[0]),
			ui: { toolbarLabel: 'AUTOSTART OFF', requiresConfirmation: false },
			flow: { targetLabel: 'TASK', actionLabel: 'DISABLE AUTOSTART', steps: [] },
			presentationTargets: buildTaskPresentationTargets(task.taskId, task.stageId as MissionStageId),
			metadata: { stageId: task.stageId as MissionStageId, autostart: false, launchMode: task.runtime.launchMode }
		});
	} else {
		const errors = changeErrors(true);
		actions.push({
			id: `task.autostart.enable.${task.taskId}`,
			label: 'Enable Autostart',
			action: '/task autostart on',
			scope: 'task',
			targetId: task.taskId,
			...buildAvailability(errors.length === 0, errors[0]),
			ui: { toolbarLabel: 'AUTOSTART ON', requiresConfirmation: false },
			flow: { targetLabel: 'TASK', actionLabel: 'ENABLE AUTOSTART', steps: [] },
			presentationTargets: buildTaskPresentationTargets(task.taskId, task.stageId as MissionStageId),
			metadata: { stageId: task.stageId as MissionStageId, autostart: true, launchMode: task.runtime.launchMode }
		});
	}

	const targetLaunchMode = task.runtime.launchMode === 'automatic' ? 'manual' : 'automatic';
	const launchModeErrors = changeErrors(task.runtime.autostart, targetLaunchMode);
	actions.push({
		id: `task.launch-mode.${targetLaunchMode}.${task.taskId}`,
		label: targetLaunchMode === 'automatic' ? 'Switch To Automatic Launch' : 'Require Manual Start',
		action: targetLaunchMode === 'automatic' ? '/task launch-mode automatic' : '/task launch-mode manual',
		scope: 'task',
		targetId: task.taskId,
		...buildAvailability(launchModeErrors.length === 0, launchModeErrors[0]),
		ui: { toolbarLabel: targetLaunchMode === 'automatic' ? 'AUTO LAUNCH' : 'MANUAL START', requiresConfirmation: false },
		flow: { targetLabel: 'TASK', actionLabel: targetLaunchMode === 'automatic' ? 'SWITCH TO AUTOMATIC LAUNCH' : 'REQUIRE MANUAL START', steps: [] },
		presentationTargets: buildTaskPresentationTargets(task.taskId, task.stageId as MissionStageId),
		metadata: { stageId: task.stageId as MissionStageId, autostart: task.runtime.autostart, launchMode: targetLaunchMode }
	});

	return actions;
}

function buildSessionCancelAction(session: MissionAgentSessionRecord, stageId: MissionStageId | undefined): MissionActionDescriptor {
	const enabled = session.lifecycleState === 'starting' || session.lifecycleState === 'running';
	return {
		id: `session.cancel.${session.sessionId}`,
		label: 'Stop Running Agent',
		action: '/session cancel',
		scope: 'session',
		targetId: session.sessionId,
		...buildAvailability(enabled, 'Session is not active.'),
		ui: { toolbarLabel: 'STOP AGENT', requiresConfirmation: true, confirmationPrompt: 'Stop the running agent session?' },
		flow: { targetLabel: 'SESSION', actionLabel: 'CANCEL', steps: [] },
		presentationTargets: buildSessionPresentationTargets(session.sessionId, stageId)
	};
}

function buildSessionTerminateAction(session: MissionAgentSessionRecord, stageId: MissionStageId | undefined): MissionActionDescriptor {
	const enabled = session.lifecycleState === 'starting' || session.lifecycleState === 'running';
	return {
		id: `session.terminate.${session.sessionId}`,
		label: 'Force Stop Agent',
		action: '/session terminate',
		scope: 'session',
		targetId: session.sessionId,
		...buildAvailability(enabled, 'Session is not active.'),
		ui: { toolbarLabel: 'FORCE STOP', requiresConfirmation: true, confirmationPrompt: 'Force stop this agent session?' },
		flow: { targetLabel: 'SESSION', actionLabel: 'TERMINATE', steps: [] },
		presentationTargets: buildSessionPresentationTargets(session.sessionId, stageId)
	};
}

function cloneMissionAgentConsoleState(
	state: MissionAgentConsoleState
): MissionAgentConsoleState {
	return {
		...(state.title ? { title: state.title } : {}),
		lines: [...state.lines],
		promptOptions: state.promptOptions ? [...state.promptOptions] : null,
		awaitingInput: state.awaitingInput,
		...(state.runtimeId ? { runtimeId: state.runtimeId } : {}),
		...(state.runtimeLabel ? { runtimeLabel: state.runtimeLabel } : {}),
		...(state.sessionId ? { sessionId: state.sessionId } : {})
	};
}

function createEmptyMissionAgentConsoleState(
	overrides: Partial<MissionAgentConsoleState> = {}
): MissionAgentConsoleState {
	return {
		...cloneMissionAgentConsoleState({
			lines: overrides.lines ?? [],
			promptOptions: overrides.promptOptions ?? null,
			awaitingInput: overrides.awaitingInput ?? false,
			...(overrides.title ? { title: overrides.title } : {}),
			...(overrides.runtimeId ? { runtimeId: overrides.runtimeId } : {}),
			...(overrides.runtimeLabel ? { runtimeLabel: overrides.runtimeLabel } : {}),
			...(overrides.sessionId ? { sessionId: overrides.sessionId } : {})
		})
	};
}

function buildMissionPresentationTargets(currentStageId: MissionStageId | undefined) {
	return currentStageId ? [{ scope: 'mission' as const }, { scope: 'stage' as const, targetId: currentStageId }] : [{ scope: 'mission' as const }];
}

function buildTaskPresentationTargets(taskId: string, stageId: MissionStageId) {
	return [{ scope: 'task' as const, targetId: taskId }, { scope: 'stage' as const, targetId: stageId }];
}

function buildSessionPresentationTargets(sessionId: string, stageId: MissionStageId | undefined) {
	return [{ scope: 'session' as const, targetId: sessionId }, ...(stageId ? [{ scope: 'stage' as const, targetId: stageId }] : [])];
}

function describePauseUnavailable(input: MissionAvailableActionsInput): string {
	switch (input.runtime.lifecycle) {
		case 'paused': return 'Mission is already paused.';
		case 'panicked': return 'Mission is panicked.';
		case 'delivered': return 'Mission already delivered.';
		default: return 'Mission is not running.';
	}
}

function describeResumeUnavailable(input: MissionAvailableActionsInput, errors: string[]): string {
	if (input.runtime.panic.active) {
		return 'Clear panic before resuming the mission.';
	}
	if (input.runtime.lifecycle !== 'paused') {
		return 'Mission is not paused.';
	}
	return errors[0] ?? 'Mission cannot be resumed.';
}

function describePanicUnavailable(input: MissionAvailableActionsInput, errors: string[]): string {
	if (input.runtime.panic.active) {
		return 'Mission is already in panic state.';
	}
	if (input.runtime.lifecycle === 'draft') {
		return 'Start the workflow before using panic stop.';
	}
	return errors[0] ?? 'Mission cannot enter panic state.';
}

function describeClearPanicUnavailable(input: MissionAvailableActionsInput, errors: string[]): string {
	if (!input.runtime.panic.active) {
		return 'Mission is not panicked.';
	}
	return errors[0] ?? 'Panic cannot be cleared right now.';
}

function describeTaskStartUnavailable(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number], errors: string[]): string {
	if (input.runtime.lifecycle === 'panicked' || input.runtime.panic.active) {
		return 'Clear panic before starting new work.';
	}
	if (input.runtime.lifecycle === 'paused' || input.runtime.pause.paused) {
		return 'Resume the mission before starting new work.';
	}
	switch (task.lifecycle) {
		case 'pending':
			return task.blockedByTaskIds.length > 0 ? `Waiting on ${task.blockedByTaskIds.join(', ')}.` : 'Waiting for an earlier stage to become eligible.';
		case 'queued': return 'Task is already queued.';
		case 'running': return 'Task is already running.';
		case 'blocked': return 'Task is blocked.';
		case 'completed': return 'Task is already completed.';
		case 'failed':
		case 'cancelled':
			return 'Reopen the task before starting it again.';
		default:
			return errors[0] ?? 'Task is not ready to start.';
	}
}

function isTaskLaunchEnabled(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): boolean {
	if (input.runtime.lifecycle === 'panicked' || input.runtime.panic.active) {
		return false;
	}
	if (input.runtime.lifecycle === 'paused' || input.runtime.pause.paused) {
		return false;
	}
	if (task.lifecycle !== 'ready' && task.lifecycle !== 'queued' && task.lifecycle !== 'running') {
		return false;
	}
	return !input.sessions.some(
		(session) =>
			session.taskId === task.taskId
			&& (
				session.lifecycleState === 'starting'
				|| session.lifecycleState === 'running'
				|| session.lifecycleState === 'awaiting-input'
			)
	);
}

function describeTaskLaunchUnavailable(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): string {
	if (input.runtime.lifecycle === 'panicked' || input.runtime.panic.active) {
		return 'Clear panic before launching an agent.';
	}
	if (input.runtime.lifecycle === 'paused' || input.runtime.pause.paused) {
		return 'Resume the mission before launching an agent.';
	}
	if (input.sessions.some((session) => session.taskId === task.taskId && (
		session.lifecycleState === 'starting'
		|| session.lifecycleState === 'running'
		|| session.lifecycleState === 'awaiting-input'
	))) {
		return 'Task already has an active agent session.';
	}
	if (task.lifecycle === 'ready' || task.lifecycle === 'queued' || task.lifecycle === 'running') {
		return 'Task is ready to launch.';
	}
	if (task.lifecycle === 'pending') {
		return task.blockedByTaskIds.length > 0 ? `Waiting on ${task.blockedByTaskIds.join(', ')}.` : 'Waiting for an earlier stage to become eligible.';
	}
	if (task.lifecycle === 'blocked') {
		return 'Task is blocked.';
	}
	if (task.lifecycle === 'completed') {
		return 'Task is already completed.';
	}
	if (task.lifecycle === 'failed' || task.lifecycle === 'cancelled') {
		return 'Reopen the task before launching it again.';
	}
	return 'Task is not available for launch.';
}

function getValidationErrors(
	input: MissionAvailableActionsInput,
	event:
		| { type: 'mission.resumed' }
		| { type: 'mission.panic.requested' }
		| { type: 'mission.panic.cleared' }
		| { type: 'mission.delivered' }
		| { type: 'task.queued'; taskId: string }
		| { type: 'task.completed'; taskId: string }
		| { type: 'task.blocked'; taskId: string; reason: string }
		| { type: 'task.reopened'; taskId: string }
		| { type: 'task.launch-policy.changed'; taskId: string; autostart: boolean; launchMode: MissionRuntimeRecord['runtime']['tasks'][number]['runtime']['launchMode'] }
): string[] {
	return getMissionWorkflowEventValidationErrors(
		input.runtime,
		{ eventId: `${input.missionId}:action`, occurredAt: input.runtime.updatedAt, source: 'human', ...event } as MissionWorkflowEvent,
		input.configuration
	);
}

function getOrderedTasks(input: MissionAvailableActionsInput) {
	return [...input.runtime.tasks].sort((left, right) => {
		const leftStageIndex = input.configuration.workflow.stageOrder.indexOf(left.stageId);
		const rightStageIndex = input.configuration.workflow.stageOrder.indexOf(right.stageId);
		if (leftStageIndex !== rightStageIndex) {
			return leftStageIndex - rightStageIndex;
		}
		return left.taskId.localeCompare(right.taskId);
	});
}

function getOrderedSessions(input: MissionAvailableActionsInput) {
	return [...input.sessions].sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

function resolveEligibleStageId(input: MissionAvailableActionsInput): MissionStageId | undefined {
	for (const stageId of input.configuration.workflow.stageOrder) {
		const stageTasks = input.runtime.tasks.filter((task) => task.stageId === stageId);
		const completed = stageTasks.length > 0 && stageTasks.every((task) => task.lifecycle === 'completed');
		if (!completed) {
			return stageId as MissionStageId;
		}
	}
	return input.configuration.workflow.stageOrder[input.configuration.workflow.stageOrder.length - 1] as MissionStageId | undefined;
}

function resolveCurrentStageId(input: MissionAvailableActionsInput): MissionStageId | undefined {
	return (input.runtime.stages.find((stage) => stage.lifecycle !== 'completed')?.stageId as MissionStageId | undefined)
		?? (input.configuration.workflow.stageOrder[input.configuration.workflow.stageOrder.length - 1] as MissionStageId | undefined);
}
