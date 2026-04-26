import * as path from 'node:path';
import {
	MissionAgentEventEmitter,
	type MissionAgentDisposable
} from '../agent/events.js';
import {
	type MissionAgentConsoleEvent,
	type MissionAgentConsoleState,
	type MissionAgentEvent,
	type MissionAgentLifecycleState,
	type MissionAgentSessionLaunchRequest,
	type MissionAgentSessionRecord
} from '../daemon/protocol/contracts.js';
import type {
	AgentCommand,
	AgentPrompt
} from '../agent/AgentRuntimeTypes.js';
import { toMission, type Mission } from '../entities/Mission/Mission.js';

import type { MissionDefaultAgentMode } from '../lib/daemonConfig.js';
import { RepositoryScaffoldingService } from '../lib/RepositoryScaffoldingService.js';
import { DEFAULT_AGENT_RUNNER_ID } from '../agent/runtimes/AgentRuntimeIds.js';
import { MissionSession } from './MissionSession.js';
import { MissionTask } from './MissionTask.js';
import { buildMissionTaskLaunchPrompt } from './taskLaunchPrompt.js';
import { getMissionStageDefinition } from '../workflow/manifest.js';
import {
	MISSION_ARTIFACTS,
	MISSION_STAGES,
	MISSION_STAGE_FOLDERS,
	type OperatorActionDescriptor,
	type OperatorActionListSnapshot,
	type MissionTowerProjection,
	type MissionTowerStageRailItem,
	type MissionTowerTreeNode,
	type OperatorActionExecutionStep,
	type MissionTaskUpdate,
	type GateIntent,
	type MissionDescriptor,
	type MissionGateResult,
	type MissionArtifactKey,
	type MissionStageId,
	type MissionRecord,
	type MissionStageStatus,
	type OperatorStatus,
	type MissionTaskState
} from '../types.js';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import { DEFAULT_WORKFLOW_VERSION } from '../workflow/mission/workflow.js';
import {
	MissionWorkflowController,
	MissionWorkflowRequestExecutor,
	createDraftMissionWorkflowRuntimeState,
	createMissionWorkflowConfigurationSnapshot,
	type MissionWorkflowEvent,
	type MissionRuntimeRecord,
	type WorkflowGlobalSettings
} from '../workflow/engine/index.js';
import { getMissionWorkflowEventValidationErrors } from '../workflow/engine/validation.js';
import type { AgentRunner } from '../agent/AgentRunner.js';
import type { AgentSessionEvent, AgentSessionSnapshot } from '../agent/AgentRuntimeTypes.js';

export type MissionWorkflowBindings = {
	workflow: WorkflowGlobalSettings;
	resolveWorkflow?: () => WorkflowGlobalSettings;
	taskRunners: Map<string, AgentRunner>;
	instructionsPath?: string;
	skillsPath?: string;
	defaultModel?: string;
	defaultMode?: MissionDefaultAgentMode;
};

export class MissionRuntime {
	private static readonly SESSION_RECONCILE_TIMEOUT_MS = 1_000;

	private readonly agentConsoleEventEmitter = new MissionAgentEventEmitter<MissionAgentConsoleEvent>();
	private readonly agentEventEmitter = new MissionAgentEventEmitter<MissionAgentEvent>();
	private readonly agentRunners = new Map<string, AgentRunner>();
	private readonly consoleStates = new Map<string, MissionAgentConsoleState>();
	private descriptor: MissionDescriptor;
	private agentSessions: MissionAgentSessionRecord[] = [];
	private lastKnownStatus: OperatorStatus | undefined;
	private lastKnownActionSnapshot: OperatorActionListSnapshot | undefined;
	private readonly workflowRequestExecutor: MissionWorkflowRequestExecutor;
	private readonly workflowController: MissionWorkflowController;
	private readonly workflowResolver: () => WorkflowGlobalSettings;
	private readonly runtimeEventSubscription: MissionAgentDisposable;
	private runtimeLifecycleIngestionQueue: Promise<void> = Promise.resolve();
	private workflowEventApplicationQueue: Promise<void> = Promise.resolve();

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
			if (event.type === 'session.completed' || event.type === 'session.failed') {
				this.enqueueRuntimeLifecycleIngestion();
			}
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
	): MissionRuntime {
		return new MissionRuntime(adapter, missionDir, descriptor, workflowBindings);
	}

	public async initialize(): Promise<this> {
		const missionWorkspaceRoot = this.adapter.getMissionWorkspacePath(this.missionDir);
		await new RepositoryScaffoldingService(missionWorkspaceRoot).initialize();
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
		return {
			id: this.descriptor.missionId,
			brief: { ...this.descriptor.brief },
			missionDir: workspaceDir,
			missionRootDir: this.missionDir,
			branchRef: this.descriptor.branchRef,
			createdAt: this.descriptor.createdAt,
			stage: this.lastKnownStatus?.stage ?? 'prd',
			...(this.descriptor.deliveredAt ? { deliveredAt: this.descriptor.deliveredAt } : {}),
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
		this.lastKnownActionSnapshot = undefined;
		this.lastKnownStatus = await this.buildStatus(document);
		return this;
	}

	public async status(): Promise<OperatorStatus> {
		await this.runtimeLifecycleIngestionQueue;
		if (
			this.lastKnownStatus
			&& this.lastKnownStatus.workflow?.lifecycle !== 'draft'
			&& !this.hasActiveAgentSessions()
		) {
			return this.lastKnownStatus;
		}

		const document = await this.readLiveWorkflowDocument({
			reconcileSessions: this.hasActiveAgentSessions()
		});
		this.syncAgentSessions(document);
		this.lastKnownActionSnapshot = undefined;
		this.lastKnownStatus = await this.buildStatus(document);
		return this.lastKnownStatus;
	}

	public async toEntity(): Promise<Mission> {
		return toMission(await this.status());
	}

	public async listAvailableActions(): Promise<OperatorActionDescriptor[]> {
		return (await this.listAvailableActionsSnapshot()).actions;
	}

	public async listAvailableActionsSnapshot(): Promise<OperatorActionListSnapshot> {
		await this.runtimeLifecycleIngestionQueue;
		if (
			this.lastKnownActionSnapshot
			&& this.lastKnownStatus?.workflow?.lifecycle !== 'draft'
			&& !this.hasActiveAgentSessions()
		) {
			return this.lastKnownActionSnapshot;
		}

		const document = await this.readLiveWorkflowDocument({
			reconcileSessions: this.hasActiveAgentSessions()
		});
		this.syncAgentSessions(document);
		this.lastKnownStatus = await this.buildStatus(document);
		const snapshot = {
			actions: await this.buildActionList(document),
			revision: this.buildActionRevision(document)
		};
		this.lastKnownActionSnapshot = snapshot;
		return snapshot;
	}

	public async startWorkflow(): Promise<OperatorStatus> {
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

	public getAgentSessionByTerminalSessionName(
		terminalSessionName: string,
	): MissionAgentSessionRecord | undefined {
		const record = this.agentSessions.find(
			(candidate) => candidate.terminalSessionName === terminalSessionName,
		);
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

		await this.status();

		const existingSession = this.agentSessions.find(
			(candidate) => candidate.taskId === request.taskId && isActiveMissionAgentSession(candidate.lifecycleState)
		);
		if (existingSession) {
			if (!(await this.isSessionCompatibleForLaunch(existingSession, request))) {
				await this.terminateAgentSession(existingSession.sessionId, 'replaced stale task session before relaunch');
				await this.status();
			} else {
				return MissionSession.cloneRecord(existingSession);
			}
		}

		let task = await this.requireTask(request.taskId);
		const workflowTask = await this.requireWorkflowTask(request.taskId);
		if (
			workflowTask.lifecycle === 'cancelled'
		) {
			await this.reopenTaskExecution(request.taskId);
			task = await this.requireTask(request.taskId);
		}
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

	public async completeAgentSession(
		sessionId: string
	): Promise<MissionAgentSessionRecord> {
		const session = this.requireAgentSession(sessionId);
		return (await session.done()).toRecord();
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

	private async isSessionCompatibleForLaunch(
		session: MissionAgentSessionRecord,
		request: MissionAgentSessionLaunchRequest
	): Promise<boolean> {
		try {
			const liveSession = this.workflowController.getRuntimeSession(session.sessionId)
				?? await this.workflowController.attachRuntimeSession({
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
				});
			if (!liveSession || isTerminalStatus(liveSession.status)) {
				return false;
			}
			if (liveSession.taskId !== request.taskId) {
				return false;
			}
			if (liveSession.workingDirectory && liveSession.workingDirectory !== request.workingDirectory) {
				return false;
			}
			return true;
		} catch {
			return true;
		}
	}

	public async evaluateGate(intent: GateIntent): Promise<MissionGateResult> {
		const status = await this.status();
		const errors: string[] = [];
		const warnings: string[] = [];
		const currentBranch = this.adapter.getCurrentBranch(this.adapter.getMissionWorkspacePath(this.missionDir));
		const gateIntent = intent === 'commit' ? 'implement' : intent;
		const gate = status.workflow?.gates.find((candidate: { intent: GateIntent }) => candidate.intent === gateIntent);

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

		await this.applyWorkflowEvent(this.createWorkflowEvent('mission.delivered', {}));
		await this.status();
		return this.getRecord();
	}

	public async executeAction(
		actionId: string,
		steps: OperatorActionExecutionStep[] = [],
		options: { terminalSessionName?: string } = {}
	): Promise<OperatorStatus> {
		if (actionId === MISSION_ACTION_IDS.pause) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.pauseMission();
			return this.status();
		}
		if (actionId === MISSION_ACTION_IDS.resume) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.resumeMission();
			return this.status();
		}
		if (actionId === MISSION_ACTION_IDS.panic) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.panicStopMission();
			return this.status();
		}
		if (actionId === MISSION_ACTION_IDS.clearPanic) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.clearMissionPanic();
			return this.status();
		}
		if (actionId === MISSION_ACTION_IDS.restartQueue) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.restartLaunchQueue();
			return this.status();
		}
		if (actionId === MISSION_ACTION_IDS.deliver) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.deliver();
			return this.status();
		}
		if (actionId.startsWith('generation.tasks.')) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.generateTasksForStage(actionId.slice('generation.tasks.'.length) as MissionStageId);
			return this.status();
		}
		if (actionId.startsWith('task.start.')) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.startTask(actionId.slice('task.start.'.length), options);
			return this.status();
		}
		if (actionId.startsWith('task.done.')) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.completeTask(actionId.slice('task.done.'.length));
			return this.status();
		}
		if (actionId.startsWith('task.reopen.')) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.reopenTask(actionId.slice('task.reopen.'.length));
			return this.status();
		}
		if (actionId.startsWith('task.rework.from-verification.')) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.reworkTaskFromVerification(actionId.slice('task.rework.from-verification.'.length));
			return this.status();
		}
		if (actionId.startsWith('task.rework.')) {
			const taskId = actionId.slice('task.rework.'.length);
			const summary = requireTextActionStep(steps, 'task.rework.instruction').value.trim();
			await this.reworkTask(taskId, {
				actor: 'human',
				reasonCode: 'manual.instruction',
				summary,
				artifactRefs: []
			});
			return this.status();
		}
		if (actionId.startsWith('task.autostart.enable.')) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.setTaskAutostart(actionId.slice('task.autostart.enable.'.length), true);
			return this.status();
		}
		if (actionId.startsWith('task.autostart.disable.')) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.setTaskAutostart(actionId.slice('task.autostart.disable.'.length), false);
			return this.status();
		}
		if (actionId.startsWith('session.cancel.')) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.cancelAgentSession(actionId.slice('session.cancel.'.length));
			return this.status();
		}
		if (actionId.startsWith('session.terminate.')) {
			if (steps.length > 0) {
				throw new Error(`Mission action '${actionId}' does not accept input steps.`);
			}
			await this.terminateAgentSession(actionId.slice('session.terminate.'.length));
			return this.status();
		}

		throw new Error(`Unknown mission action '${actionId}'.`);
	}

	public async updateTaskState(taskId: string, changes: MissionTaskUpdate): Promise<MissionTaskState> {
		const task = await this.requireTask(taskId);
		if (changes.status === 'ready' || changes.status === 'queued' || changes.status === 'running') {
			return task.start();
		}
		if (changes.status === 'completed') {
			return task.complete();
		}
		if (changes.status === 'pending') {
			return task.reopen();
		}
		return task.toState();
	}

	public async pauseMission(): Promise<void> {
		await this.applyWorkflowEvent(
			this.createWorkflowEvent('mission.paused', { reason: 'human-requested', targetType: 'mission' })
		);
		await this.status();
	}

	public async resumeMission(): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('mission.resumed', {}));
		await this.status();
	}

	public async panicStopMission(): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('mission.panic.requested', {}));
		await this.status();
	}

	public async clearMissionPanic(): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('mission.panic.cleared', {}));
		await this.status();
	}

	public async restartLaunchQueue(): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('mission.launch-queue.restarted', {}));
		await this.status();
	}

	public async startTask(taskId: string, options: { terminalSessionName?: string } = {}): Promise<void> {
		const task = await this.requireTask(taskId);
		const taskState = task.toState();
		const runnerId = this.resolveTaskStartRunnerId(taskState);
		await task.start({
			...(runnerId ? { runnerId } : {}),
			prompt: buildMissionTaskLaunchPrompt(taskState, this.adapter.getMissionWorkspacePath(this.missionDir)),
			workingDirectory: this.adapter.getMissionWorkspacePath(this.missionDir),
			...(options.terminalSessionName?.trim() ? { terminalSessionName: options.terminalSessionName.trim() } : {})
		});
	}

	public async completeTask(taskId: string): Promise<void> {
		await (await this.requireTask(taskId)).complete();
	}

	public async reopenTask(taskId: string): Promise<void> {
		await (await this.requireTask(taskId)).reopen();
	}

	public async reworkTask(inputTaskId: string, input: {
		actor: 'human' | 'system' | 'workflow';
		reasonCode: string;
		summary: string;
		sourceTaskId?: string;
		sourceSessionId?: string;
		artifactRefs?: Array<{ path: string; title?: string }>;
	}): Promise<void> {
		await this.requireTaskState(inputTaskId);
		await this.reworkTaskExecution(inputTaskId, input);
		await this.status();
	}

	public async reworkTaskFromVerification(sourceTaskId: string): Promise<void> {
		const request = await this.buildVerificationTaskReworkRequest(sourceTaskId);
		await this.reworkTask(request.taskId, request.input);
	}

	public async setTaskAutostart(taskId: string, autostart: boolean): Promise<void> {
		await (await this.requireTask(taskId)).setAutostart(autostart);
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
		if (
			!generationRule
			|| (!generationRule.artifactTasks && generationRule.templateSources.length === 0 && generationRule.tasks.length === 0)
		) {
			throw new Error(`Stage '${stageId}' does not support task generation.`);
		}

		const refreshedDocument = await this.workflowController.generateTasksForStage(stageId);
		if (!refreshedDocument.runtime.tasks.some((task) => task.stageId === stageId)) {
			throw new Error(`Task generation for stage '${stageId}' produced no runtime tasks.`);
		}
		await this.status();
	}

	private async buildStatus(document?: MissionRuntimeRecord): Promise<OperatorStatus> {
		const persistedDocument = document ?? await this.workflowController.getPersistedDocument();
		if (!persistedDocument) {
			return this.buildDraftStatus();
		}
		const hydratedWorkflowTasks = await this.hydrateRuntimeTasksForActions(persistedDocument.runtime.tasks);
		const stages = await this.buildWorkflowStageStatuses(persistedDocument);
		const projectedTasksById = new Map(stages.flatMap((stage) => stage.tasks).map((task) => [task.taskId, task]));
		const currentStageId = this.resolveCurrentStageFromWorkflow(persistedDocument);
		const currentStage = stages.find((stage) => stage.stage === currentStageId) ?? stages[0];
		const activeTasks = this.resolveActiveTasks(currentStage);
		const readyTasks = this.resolveReadyTasks(currentStage);
		const productFiles = await this.collectProductFiles();
		const sessions = this.getAgentSessions();
		const tower = this.buildTowerProjection(persistedDocument.configuration, stages, sessions, productFiles);

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
			productFiles,
			...(activeTasks.length > 0 ? { activeTasks } : {}),
			...(readyTasks.length > 0 ? { readyTasks } : {}),
			stages,
			agentSessions: sessions,
			tower,
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
					completedTaskIds: [...stage.completedTaskIds]
				})),
				tasks: hydratedWorkflowTasks.map((task) => ({
					...task,
					title: projectedTasksById.get(task.taskId)?.subject ?? task.title,
					dependsOn: [...task.dependsOn],
					waitingOnTaskIds: [...task.waitingOnTaskIds],
					runtime: { ...task.runtime }
				})),
				gates: persistedDocument.runtime.gates.map((gateProjection) => ({
					...gateProjection,
					reasons: [...gateProjection.reasons]
				})),
				updatedAt: persistedDocument.runtime.updatedAt
			},
			recommendedAction: this.buildRecommendedAction(currentStageId, activeTasks, readyTasks)
		};
	}

	private async buildDraftStatus(): Promise<OperatorStatus> {
		const workflow = this.workflowResolver();
		const configuration = createMissionWorkflowConfigurationSnapshot({
			createdAt: this.descriptor.createdAt,
			workflowVersion: DEFAULT_WORKFLOW_VERSION,
			workflow
		});
		const runtime = createDraftMissionWorkflowRuntimeState(configuration, this.descriptor.createdAt);
		const stages: MissionStageStatus[] = MISSION_STAGES.map((stageId) => ({
			stage: stageId,
			folderName: MISSION_STAGE_FOLDERS[stageId],
			status: 'pending',
			taskCount: 0,
			completedTaskCount: 0,
			activeTaskIds: [],
			readyTaskIds: [],
			tasks: []
		}));
		const currentStageId = (workflow.stageOrder[0] as MissionStageId | undefined) ?? 'prd';
		const productFiles = await this.collectProductFiles();
		const tower = this.buildTowerProjection(configuration, stages, [], productFiles);

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
			productFiles,
			stages,
			agentSessions: [],
			tower,
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
					completedTaskIds: [...stage.completedTaskIds]
				})),
				tasks: [],
				gates: runtime.gates.map((gateProjection) => ({
					...gateProjection,
					reasons: [...gateProjection.reasons]
				})),
				updatedAt: runtime.updatedAt
			},
			recommendedAction: 'Mission is still draft. Start the workflow to capture repository settings and initialize tasks.'
		};
	}

	private async buildActionList(document?: MissionRuntimeRecord): Promise<OperatorActionDescriptor[]> {
		if (!document) {
			const workflow = this.workflowResolver();
			const configuration = createMissionWorkflowConfigurationSnapshot({
				createdAt: this.descriptor.createdAt,
				workflowVersion: DEFAULT_WORKFLOW_VERSION,
				workflow
			});
			const runtime = createDraftMissionWorkflowRuntimeState(configuration, this.descriptor.createdAt);
			return this.buildAvailableActions(configuration, runtime, []);
		}

		return this.buildAvailableActions(
			document.configuration,
			document.runtime,
			this.getAgentSessions()
		);
	}

	private buildActionRevision(document?: MissionRuntimeRecord): string {
		const runtimeUpdatedAt = document?.runtime.updatedAt?.trim();
		if (runtimeUpdatedAt) {
			return `mission:${this.descriptor.missionId}:${runtimeUpdatedAt}`;
		}
		return `mission:${this.descriptor.missionId}:${this.descriptor.createdAt}`;
	}

	private async buildWorkflowStageStatuses(
		document: MissionRuntimeRecord
	): Promise<MissionStageStatus[]> {
		return Promise.all(MISSION_STAGES.map(async (stageId) => {
			const runtimeStage = document.runtime.stages.find((stage) => stage.stageId === stageId);
			const runtimeTasks = document.runtime.tasks.filter((task) => task.stageId === stageId);
			const runtimeTasksById = new Map(runtimeTasks.map((task, index) => [task.taskId, { task, index }]));
			const fileTasks = await this.adapter.listTaskStates(this.missionDir, stageId).catch(() => []);
			const fileTaskIds = new Set(fileTasks.map((task) => task.taskId));
			const tasks: MissionTaskState[] = [];

			for (const fileTask of fileTasks) {
				const runtimeTaskEntry = runtimeTasksById.get(fileTask.taskId);
				if (runtimeTaskEntry) {
					tasks.push(this.toWorkflowProjectedTaskState(runtimeTaskEntry.task, runtimeTaskEntry.index, fileTask));
					continue;
				}
				tasks.push({
					...fileTask,
					waitingOn: [...fileTask.waitingOn],
					status: 'pending'
				});
			}

			for (const [taskId, runtimeTaskEntry] of runtimeTasksById.entries()) {
				if (fileTaskIds.has(taskId)) {
					continue;
				}
				tasks.push(this.toWorkflowProjectedTaskState(runtimeTaskEntry.task, runtimeTaskEntry.index));
			}

			tasks.sort((left, right) => left.sequence - right.sequence || left.taskId.localeCompare(right.taskId));
			return {
				stage: stageId,
				folderName: MISSION_STAGE_FOLDERS[stageId],
				status: runtimeStage?.lifecycle ?? 'pending',
				taskCount: tasks.length,
				completedTaskCount: tasks.filter((task) => task.status === 'completed').length,
				activeTaskIds: tasks
					.filter((task) => task.status === 'queued' || task.status === 'running')
					.map((task) => task.taskId),
				readyTaskIds: tasks.filter((task) => this.isTaskReady(task)).map((task) => task.taskId),
				tasks
			};
		}));
	}

	private buildTowerProjection(
		configuration: MissionRuntimeRecord['configuration'],
		stages: MissionStageStatus[],
		sessions: MissionAgentSessionRecord[],
		productFiles: Partial<Record<MissionArtifactKey, string>>
	): MissionTowerProjection {
		return {
			stageRail: stages.map((stage) => this.toTowerStageRailItem(stage, configuration)),
			treeNodes: this.buildTowerTreeNodes(configuration, stages, sessions, productFiles)
		};
	}

	private toTowerStageRailItem(
		stage: MissionStageStatus,
		configuration: MissionRuntimeRecord['configuration']
	): MissionTowerStageRailItem {
		return {
			id: stage.stage,
			label: this.resolveTowerStageLabel(stage.stage, configuration),
			state: this.toTowerStageRailState(stage.status),
			subtitle: `${String(stage.completedTaskCount)}/${String(stage.taskCount)}`
		};
	}

	private buildTowerTreeNodes(
		configuration: MissionRuntimeRecord['configuration'],
		stages: MissionStageStatus[],
		sessions: MissionAgentSessionRecord[],
		productFiles: Partial<Record<MissionArtifactKey, string>>
	): MissionTowerTreeNode[] {
		const nodes: MissionTowerTreeNode[] = [];
		const missionArtifactPath = productFiles.brief;
		if (missionArtifactPath) {
			nodes.push({
				id: 'tree:mission-artifact:brief',
				label: MISSION_ARTIFACTS.brief,
				kind: 'mission-artifact',
				depth: 0,
				color: this.progressTone('pending'),
				statusLabel: 'Mission artifact',
				collapsible: false,
				sourcePath: missionArtifactPath
			});
		}
		for (const stage of stages) {
			const stageArtifactPath = this.resolveStageArtifactPath(stage.stage, productFiles);
			const stageStatusLabel = this.toStatusLabel(stage.status);
			nodes.push({
				id: `tree:stage:${stage.stage}`,
				label: this.resolveTowerStageLabel(stage.stage, configuration),
				kind: 'stage',
				depth: 0,
				color: this.progressTone(stage.status),
				statusLabel: stageStatusLabel,
				collapsible: Boolean(stageArtifactPath) || stage.tasks.length > 0,
				stageId: stage.stage
			});

			for (const task of stage.tasks) {
				const taskColor = this.progressTone(task.status);
				const taskStatusLabel = this.toStatusLabel(task.status);
				nodes.push({
					id: `tree:task:${task.taskId}`,
					label: `${String(task.sequence)} ${task.subject}`,
					kind: 'task',
					depth: 1,
					color: taskColor,
					statusLabel: taskStatusLabel,
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
						label: `${session.runnerId} ${session.sessionId.slice(-4)}`,
						kind: 'session',
						depth: 2,
						color: this.sessionTone(session.lifecycleState, taskColor),
						statusLabel: this.toStatusLabel(session.lifecycleState),
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
						statusLabel: taskStatusLabel,
						collapsible: false,
						sourcePath: task.filePath,
						stageId: stage.stage,
						taskId: task.taskId
					});
				}
			}

			if (stageArtifactPath) {
				nodes.push({
					id: `tree:stage-artifact:${stage.stage}`,
					label: path.basename(stageArtifactPath),
					kind: 'stage-artifact',
					depth: 1,
					color: this.progressTone(stage.status),
					statusLabel: stageStatusLabel,
					collapsible: false,
					sourcePath: stageArtifactPath,
					stageId: stage.stage
				});
			}
		}
		return nodes;
	}

	private resolveTowerStageLabel(
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

	private toTowerStageRailState(status: MissionStageStatus['status']): MissionTowerStageRailItem['state'] {
		return status;
	}

	private progressTone(status: MissionStageStatus['status'] | MissionTaskState['status']): string {
		if (status === 'completed') {
			return '#3fb950';
		}
		if (status === 'active' || status === 'queued' || status === 'running') {
			return '#58a6ff';
		}
		if (status === 'ready') {
			return '#79c0ff';
		}
		if (status === 'failed') {
			return '#f85149';
		}
		if (status === 'cancelled') {
			return '#ffa657';
		}
		return '#8b949e';
	}

	private sessionTone(state: string, fallbackColor: string): string {
		if (state === 'starting') {
			return '#79c0ff';
		}
		if (state === 'running') {
			return '#58a6ff';
		}
		if (state === 'terminated') {
			return '#9be9a8';
		}
		if (state === 'failed') {
			return '#f85149';
		}
		if (state === 'cancelled') {
			return '#d29922';
		}
		if (state === 'completed') {
			return '#3fb950';
		}
		return fallbackColor;
	}

	private toStatusLabel(state: string): string {
		const normalized = state.trim();
		return normalized.length > 0 ? normalized.replace(/[_-]+/g, ' ') : 'unknown';
	}

	private toWorkflowProjectedTaskState(
		task: MissionRuntimeRecord['runtime']['tasks'][number],
		index: number,
		fileTask?: MissionTaskState
	): MissionTaskState {
		const fileName = fileTask?.fileName ?? `${task.taskId.split('/').pop() ?? task.taskId}.md`;
		const relativePath = fileTask?.relativePath ?? [
			MISSION_STAGE_FOLDERS[task.stageId as MissionStageId],
			'tasks',
			fileName
		].join('/');
		const filePath = fileTask?.filePath ?? path.join(this.missionDir, ...relativePath.split('/'));
		const taskKind = task.taskKind ?? fileTask?.taskKind;
		const pairedTaskId = task.pairedTaskId ?? fileTask?.pairedTaskId;
		return {
			taskId: task.taskId,
			stage: task.stageId as MissionStageId,
			sequence: fileTask?.sequence ?? index + 1,
			subject: this.resolveWorkflowTaskSubject(task, fileTask, fileName),
			instruction: task.instruction,
			body: task.instruction,
			...(taskKind ? { taskKind } : {}),
			...(pairedTaskId ? { pairedTaskId } : {}),
			dependsOn: [...task.dependsOn],
			waitingOn: [...task.waitingOnTaskIds],
			status: task.lifecycle,
			agent: task.agentRunner ?? fileTask?.agent ?? 'copilot',
			retries: task.retries,
			fileName,
			filePath,
			relativePath
		};
	}

	private resolveWorkflowTaskSubject(
		task: MissionRuntimeRecord['runtime']['tasks'][number],
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

	private resolveCurrentStageFromWorkflow(document: MissionRuntimeRecord): MissionStageId {
		return ((
			(document.runtime.activeStageId as MissionStageId | undefined) ??
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

	private async buildAvailableActions(
		configuration: MissionRuntimeRecord['configuration'],
		runtime: MissionRuntimeRecord['runtime'],
		sessions: MissionAgentSessionRecord[]
	): Promise<OperatorActionDescriptor[]> {
		const runtimeTasksForActions = await this.hydrateRuntimeTasksForActions(runtime.tasks);
		return buildMissionAvailableActions({
			missionId: this.descriptor.missionId,
			configuration,
			runtime: {
				...runtime,
				tasks: runtimeTasksForActions
			},
			sessions
		});
	}

	private async hydrateRuntimeTasksForActions(
		tasks: MissionRuntimeRecord['runtime']['tasks']
	): Promise<MissionRuntimeRecord['runtime']['tasks']> {
		const fileTasksById = new Map<string, MissionTaskState>();
		const fileTaskGroups = await Promise.all(
			MISSION_STAGES.map((stageId) => this.adapter.listTaskStates(this.missionDir, stageId).catch(() => []))
		);

		for (const fileTasks of fileTaskGroups) {
			for (const fileTask of fileTasks) {
				fileTasksById.set(fileTask.taskId, fileTask);
			}
		}

		return tasks.map((task) => {
			const fileTask = fileTasksById.get(task.taskId);
			const taskKind = task.taskKind ?? fileTask?.taskKind;
			const pairedTaskId = task.pairedTaskId ?? fileTask?.pairedTaskId;
			return {
				...task,
				...(taskKind ? { taskKind } : {}),
				...(pairedTaskId ? { pairedTaskId } : {})
			};
		});
	}

	private resolveActiveTasks(stage: MissionStageStatus | undefined): MissionTaskState[] {
		if (!stage) {
			return [];
		}

		return stage.tasks.filter((task) => task.status === 'queued' || task.status === 'running');
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

		return `Review tasks/${MISSION_STAGE_FOLDERS[stage]} and add the next task file.`;
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
		return stages.some((stage) => stage.stage === 'delivery' && stage.status === 'completed');
	}

	private async requireWorkflowTask(
		taskId: string
	): Promise<NonNullable<OperatorStatus['workflow']>['tasks'][number]> {
		const status = this.lastKnownStatus ?? (await this.status());
		const task = status.workflow?.tasks.find((candidate: { taskId: string }) => candidate.taskId === taskId);
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
		return task.status === 'ready' && task.waitingOn.length === 0;
	}

	private async requireTask(taskId: string): Promise<MissionTask> {
		const task = await this.requireTaskState(taskId);
		return this.createTask(task);
	}

	private requireAgentRunner(runnerId: string): AgentRunner {
		const runner = this.agentRunners.get(runnerId);
		if (!runner) {
			throw new Error(`Mission agent runner '${runnerId}' is not registered.`);
		}
		return runner;
	}

	private resolveTaskStartRunnerId(task: MissionTaskState): string | undefined {
		const taskRunnerId = typeof task.agent === 'string' && task.agent.trim() ? task.agent.trim() : undefined;
		return (taskRunnerId && this.agentRunners.has(taskRunnerId) ? taskRunnerId : undefined)
			?? (this.agentRunners.size === 1 ? this.agentRunners.keys().next().value : undefined)
			?? (this.agentRunners.has(DEFAULT_AGENT_RUNNER_ID) ? DEFAULT_AGENT_RUNNER_ID : undefined);
	}

	private async startTaskRuntimeSession(
		task: MissionTaskState,
		runner: AgentRunner,
		request: MissionAgentSessionLaunchRequest
	): Promise<AgentSessionSnapshot> {
		const promptText = request.prompt.trim().length > 0
			? request.prompt
			: buildMissionTaskLaunchPrompt(task, this.adapter.getMissionWorkspacePath(this.missionDir));
		return this.workflowController.startRuntimeSession({
			missionId: this.descriptor.missionId,
			workingDirectory: request.workingDirectory,
			task: {
				taskId: task.taskId,
				stageId: task.stage,
				title: task.subject,
				description: task.subject || task.instruction,
				instruction: task.instruction
			},
			specification: {
				summary: task.subject || task.instruction,
				documents: []
			},
			requestedRunnerId: runner.id,
			resume: { mode: 'new' },
			initialPrompt: {
				source: 'operator',
				text: promptText,
				...(request.title ? { title: request.title } : task.subject ? { title: task.subject } : {})
			},
			...(request.terminalSessionName?.trim()
				? { metadata: { terminalSessionName: request.terminalSessionName.trim() } }
				: {})
		});
	}

	private async recordStartedTaskSession(snapshot: AgentSessionSnapshot): Promise<MissionSession> {
		await this.applyWorkflowEvent({
			eventId: `${this.descriptor.missionId}:session-started:${snapshot.sessionId}`,
			type: 'session.started',
			occurredAt: snapshot.updatedAt,
			source: 'daemon',
			sessionId: snapshot.sessionId,
			taskId: snapshot.taskId,
			runnerId: snapshot.runnerId,
			sessionLogPath: this.adapter.getMissionSessionLogRelativePath(snapshot.sessionId),
			...(snapshot.transport?.kind === 'terminal' ? { transportId: 'terminal' } : {}),
			...(snapshot.transport?.kind === 'terminal' ? { terminalSessionName: snapshot.transport.terminalSessionName } : {}),
			...(snapshot.transport?.kind === 'terminal' && snapshot.transport.paneId ? { terminalPaneId: snapshot.transport.paneId } : {})
		});
		await this.refresh();
		this.emitSyntheticSessionStart(snapshot);
		return this.requireAgentSession(snapshot.sessionId);
	}

	private async recordTaskSessionLaunchFailure(taskId: string, error: unknown): Promise<void> {
		const failureEventNonce = Date.now().toString(36);
		await this.applyWorkflowEvent({
			eventId: `${this.descriptor.missionId}:session-launch-failed:${taskId}:${failureEventNonce}`,
			type: 'session.launch-failed',
			occurredAt: new Date().toISOString(),
			source: 'daemon',
			taskId,
			reason: error instanceof Error ? error.message : String(error)
		});
		await this.refresh();
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
		const record = this.requireAgentSessionRecord(sessionId);
		await this.ensureRuntimeSessionAttached(sessionId);
		const document = await this.workflowController.cancelRuntimeSession(sessionId, reason, record.taskId);
		await this.ensureSessionLifecycleRecorded(document, record, 'cancelled');
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

	private async completeSessionRecord(
		sessionId: string
	): Promise<MissionAgentSessionRecord> {
		const record = this.requireAgentSessionRecord(sessionId);
		await this.ensureRuntimeSessionAttached(sessionId);
		await this.workflowController.completeRuntimeSession(sessionId, record.taskId);
		await this.refresh();
		return this.requireAgentSessionRecord(sessionId);
	}

	private async terminateSessionRecord(
		sessionId: string,
		reason?: string
	): Promise<MissionAgentSessionRecord> {
		const record = this.requireAgentSessionRecord(sessionId);
		await this.ensureRuntimeSessionAttached(sessionId);
		const document = await this.workflowController.terminateRuntimeSession(sessionId, reason, record.taskId);
		await this.ensureSessionLifecycleRecorded(document, record, 'terminated');
		await this.refresh();
		return this.requireAgentSessionRecord(sessionId);
	}

	private async ensureSessionLifecycleRecorded(
		document: MissionRuntimeRecord,
		record: MissionAgentSessionRecord,
		lifecycle: 'cancelled' | 'terminated'
	): Promise<void> {
		const persistedSession = document.runtime.sessions.find(
			(candidate) => candidate.sessionId === record.sessionId,
		);
		if (persistedSession?.lifecycle === lifecycle) {
			return;
		}
		await this.applyWorkflowEvent(
			this.createWorkflowEvent(
				lifecycle === 'cancelled' ? 'session.cancelled' : 'session.terminated',
				{
					sessionId: record.sessionId,
					taskId: record.taskId,
				},
			),
		);
	}

	private createTask(task: MissionTaskState): MissionTask {
		return new MissionTask({
			isMissionDelivered: () => this.isDelivered(this.lastKnownStatus?.stages ?? []),
			refreshTaskState: (taskId) => this.requireTaskState(taskId),
			queueTask: (taskId, options) => this.queueTask(taskId, options),
			completeTask: (taskId) => this.completeTaskExecution(taskId),
			reopenTask: (taskId) => this.reopenTaskExecution(taskId),
			reworkTask: (taskId, input) => this.reworkTaskExecution(taskId, input),
			updateTaskLaunchPolicy: (taskId, launchPolicy) =>
				this.updateTaskLaunchPolicy(taskId, launchPolicy),
			requireAgentRunner: (runnerId) => this.requireAgentRunner(runnerId),
			startTaskRuntimeSession: (taskState, runner, request) =>
				this.startTaskRuntimeSession(taskState, runner, request),
			recordStartedTaskSession: (snapshot) => this.recordStartedTaskSession(snapshot),
			recordTaskSessionLaunchFailure: (taskId, error) =>
				this.recordTaskSessionLaunchFailure(taskId, error)
		}, task);
	}

	private createSession(record: MissionAgentSessionRecord): MissionSession {
		return new MissionSession({
			completeSessionRecord: (sessionId) => this.completeSessionRecord(sessionId),
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
			runnerId: record.runnerId,
			sessionId: record.sessionId,
			...(record.transportId === 'terminal' || record.terminalSessionName || record.terminalPaneId
				? {
					transport: {
						kind: 'terminal',
						terminalSessionName: record.terminalSessionName ?? record.sessionId,
						...(record.terminalPaneId ? { paneId: record.terminalPaneId } : {})
					}
				}
				: {})
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
				runnerLabel: this.agentRunners.get(session.runnerId)?.displayName ?? session.runnerId,
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
					runnerId: record.runnerId,
					runnerLabel: record.runnerLabel,
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
				runnerLabel: this.agentRunners.get(snapshot.runnerId)?.displayName ?? snapshot.runnerId
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
				runnerLabel:
					this.agentRunners.get(event.snapshot.runnerId)?.displayName ?? event.snapshot.runnerId
			});
		const currentConsole = this.consoleStates.get(event.snapshot.sessionId) ?? createEmptyMissionAgentConsoleState({
			awaitingInput: state.lifecycleState === 'awaiting-input',
			runnerId: state.runnerId,
			runnerLabel: state.runnerLabel,
			sessionId: state.sessionId,
			...(state.currentTurnTitle ? { title: state.currentTurnTitle } : {})
		});

		switch (event.type) {
			case 'session.started':
			case 'session.attached':
			case 'session.updated': {
				const nextState = cloneMissionAgentConsoleState({
					...currentConsole,
					awaitingInput: state.lifecycleState === 'awaiting-input',
					...(state.currentTurnTitle ? { title: state.currentTurnTitle } : {})
				});
				this.consoleStates.set(state.sessionId, nextState);
				this.agentEventEmitter.fire({
					type: 'session-state-changed',
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
			default:
				return;
		}
	}

	private enqueueRuntimeLifecycleIngestion(): void {
		this.runtimeLifecycleIngestionQueue = this.runtimeLifecycleIngestionQueue
			.then(async () => {
				await this.ingestRuntimeLifecycleEvents();
			})
			.catch(() => undefined);
	}

	private async ingestRuntimeLifecycleEvents(): Promise<void> {
		const events = this.workflowRequestExecutor.consumeRuntimeLifecycleEvents();
		if (events.length === 0) {
			return;
		}
		for (const event of events) {
			try {
				await this.applyWorkflowEvent(event);
			} catch {
				// Best-effort ingestion avoids stalling runtime event delivery to clients.
			}
		}
		const document = await this.workflowController.getPersistedDocument();
		this.syncAgentSessions(document);
	}

	private async applyWorkflowEvent(event: MissionWorkflowEvent): Promise<void> {
		const run = this.workflowEventApplicationQueue.then(async () => {
			await this.workflowController.applyEvent(event);
			this.invalidateCachedMissionSnapshots();
		});
		this.workflowEventApplicationQueue = run.catch(() => undefined);
		await run;
	}

	private async readLiveWorkflowDocument(
		options: { reconcileSessions?: boolean } = {}
	): Promise<MissionRuntimeRecord | undefined> {
		const currentDocument = await this.workflowController.getPersistedDocument();
		if (!currentDocument) {
			return undefined;
		}
		if (!options.reconcileSessions) {
			return currentDocument;
		}
		try {
			return await promiseWithTimeout(
				this.workflowController.reconcileSessions(),
				MissionRuntime.SESSION_RECONCILE_TIMEOUT_MS
			);
		} catch {
			return currentDocument;
		}
	}

	private hasActiveAgentSessions(): boolean {
		return this.agentSessions.some((session) => isActiveMissionAgentSession(session.lifecycleState));
	}

	private invalidateCachedMissionSnapshots(): void {
		this.lastKnownStatus = undefined;
		this.lastKnownActionSnapshot = undefined;
	}

	private async queueTask(taskId: string, options: { runnerId?: string; prompt?: string; workingDirectory?: string; terminalSessionName?: string } = {}): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.queued', {
			taskId,
			...(options.runnerId?.trim() ? { runnerId: options.runnerId.trim() } : {}),
			...(options.prompt?.trim() ? { prompt: options.prompt.trim() } : {}),
			...(options.workingDirectory?.trim() ? { workingDirectory: options.workingDirectory.trim() } : {}),
			...(options.terminalSessionName?.trim() ? { terminalSessionName: options.terminalSessionName.trim() } : {})
		}));
	}

	private async completeTaskExecution(taskId: string): Promise<void> {
		const activeSessions = this.agentSessions.filter(
			(candidate) => candidate.taskId === taskId && isActiveMissionAgentSession(candidate.lifecycleState)
		);
		for (const session of activeSessions) {
			await this.ensureRuntimeSessionAttached(session.sessionId);
			await this.workflowController.completeRuntimeSession(session.sessionId, taskId);
		}
		if (activeSessions.length === 0) {
			await this.applyWorkflowEvent(this.createWorkflowEvent('task.completed', { taskId }));
		}
	}

	private async reopenTaskExecution(taskId: string): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.reopened', { taskId }));
	}

	private async reworkTaskExecution(taskId: string, input: {
		actor: 'human' | 'system' | 'workflow';
		reasonCode: string;
		summary: string;
		sourceTaskId?: string;
		sourceSessionId?: string;
		artifactRefs?: Array<{ path: string; title?: string }>;
	}): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.reworked', {
			taskId,
			actor: input.actor,
			reasonCode: input.reasonCode,
			summary: input.summary,
			...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
			...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
			artifactRefs: (input.artifactRefs ?? []).map((artifactRef) => ({ ...artifactRef }))
		}));
	}

	private async buildVerificationTaskReworkRequest(sourceTaskId: string): Promise<{
		taskId: string;
		input: {
			actor: 'workflow';
			reasonCode: 'verification.failed';
			summary: string;
			sourceTaskId: string;
			artifactRefs: Array<{ path: string; title?: string }>;
		};
	}> {
		const sourceWorkflowTask = await this.requireWorkflowTask(sourceTaskId);
		const status = this.lastKnownStatus ?? (await this.status());
		const targetTask = resolveVerificationReworkTargetTask(status.workflow?.tasks ?? [], sourceWorkflowTask);
		if (!targetTask) {
			throw new Error(`Mission task '${sourceTaskId}' is not a paired verification task with a resolvable implementation target.`);
		}

		const sourceTask = await this.requireTaskState(sourceTaskId);
		const artifactRefs: Array<{ path: string; title?: string }> = [
			{ path: sourceTask.relativePath, title: sourceTask.subject }
		];
		const verificationArtifact = await this.adapter.readArtifactRecord(this.missionDir, 'verify');
		if (verificationArtifact?.relativePath) {
			artifactRefs.push({
				path: verificationArtifact.relativePath,
				title: verificationArtifact.fileName
			});
		}

		return {
			taskId: targetTask.taskId,
			input: {
				actor: 'workflow',
				reasonCode: 'verification.failed',
				summary: `Verification task '${sourceTask.subject}' requested corrective rework for '${targetTask.title}'. Review the referenced verification evidence before restarting the implementation task.`,
				sourceTaskId,
				artifactRefs: dedupeArtifactRefs(artifactRefs)
			}
		};
	}

	private async updateTaskLaunchPolicy(
		taskId: string,
		launchPolicy: { autostart: boolean }
	): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.launch-policy.changed', {
			taskId,
			autostart: launchPolicy.autostart
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
	panic: 'mission.panic',
	clearPanic: 'mission.clear-panic',
	restartQueue: 'mission.restart-queue',
	deliver: 'mission.deliver'
} as const;

function buildMissionAvailableActions(input: MissionAvailableActionsInput): OperatorActionDescriptor[] {
	const currentStageId = resolveCurrentStageId(input);
	const eligibleStageId = resolveEligibleStageId(input);
	const actions: OperatorActionDescriptor[] = [
		buildPauseMissionAction(input, currentStageId),
		buildResumeMissionAction(input, currentStageId),
		buildPanicStopAction(input, currentStageId),
		buildClearPanicAction(input, currentStageId),
		buildRestartLaunchQueueAction(input, currentStageId),
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
		actions.push(buildTaskDoneAction(input, task));
		actions.push(buildTaskReopenAction(input, task));
		actions.push(buildTaskReworkAction(input, task));
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
): Pick<OperatorActionDescriptor, 'enabled' | 'disabled' | 'disabledReason' | 'reason'> {
	if (enabled) {
		return { enabled: true, disabled: false, disabledReason: '' };
	}
	const disabledReason = reason ?? 'Action is unavailable.';
	return { enabled: false, disabled: true, disabledReason, reason: disabledReason };
}

function buildPauseMissionAction(
	input: MissionAvailableActionsInput,
	currentStageId: MissionStageId | undefined
): OperatorActionDescriptor {
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
): OperatorActionDescriptor {
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
		presentationTargets: buildMissionPresentationTargets(currentStageId),
		ordering: { group: 'recovery' }
	};
}

function buildPanicStopAction(
	input: MissionAvailableActionsInput,
	currentStageId: MissionStageId | undefined
): OperatorActionDescriptor {
	const errors = getValidationErrors(input, { type: 'mission.panic.requested' });
	const enabled =
		input.runtime.lifecycle !== 'draft'
		&& input.runtime.lifecycle !== 'completed'
		&& input.runtime.lifecycle !== 'delivered'
		&& !input.runtime.panic.active
		&& errors.length === 0;
	return {
		id: MISSION_ACTION_IDS.panic,
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
): OperatorActionDescriptor {
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
		presentationTargets: buildMissionPresentationTargets(currentStageId),
		ordering: { group: 'recovery' }
	};
}

function buildRestartLaunchQueueAction(
	input: MissionAvailableActionsInput,
	currentStageId: MissionStageId | undefined
): OperatorActionDescriptor {
	const errors = getValidationErrors(input, { type: 'mission.launch-queue.restarted' });
	const enabled = errors.length === 0;
	return {
		id: MISSION_ACTION_IDS.restartQueue,
		label: 'Restart Launch Queue',
		action: '/mission restart-queue',
		scope: 'mission',
		...buildAvailability(enabled, describeRestartLaunchQueueUnavailable(input, errors)),
		ui: {
			toolbarLabel: 'RESTART QUEUE',
			requiresConfirmation: true,
			confirmationPrompt: 'Clear stale launch requests and retry queued tasks now?'
		},
		flow: { targetLabel: 'MISSION', actionLabel: 'RESTART QUEUE', steps: [] },
		presentationTargets: buildMissionPresentationTargets(currentStageId),
		ordering: { group: 'recovery' }
	};
}

function buildDeliverMissionAction(
	input: MissionAvailableActionsInput,
	currentStageId: MissionStageId | undefined
): OperatorActionDescriptor {
	const errors = getValidationErrors(input, { type: 'mission.delivered' });
	const delivered = isRuntimeDelivered(input.runtime);
	return {
		id: MISSION_ACTION_IDS.deliver,
		label: 'Deliver Mission',
		action: '/mission deliver',
		scope: 'mission',
		...buildAvailability(!delivered && errors.length === 0, delivered ? 'Mission already delivered.' : errors[0]),
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
): OperatorActionDescriptor | undefined {
	const generationRule = input.configuration.workflow.taskGeneration.find((candidate) => candidate.stageId === stageId);
	if (
		!generationRule
		|| (!generationRule.artifactTasks && generationRule.templateSources.length === 0 && generationRule.tasks.length === 0)
	) {
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

function buildTaskStartAction(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): OperatorActionDescriptor {
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
			autostart: task.runtime.autostart
		}
	};
}

function buildTaskDoneAction(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): OperatorActionDescriptor {
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

function buildTaskReopenAction(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): OperatorActionDescriptor {
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

function buildTaskReworkAction(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): OperatorActionDescriptor {
	const verificationAction = buildVerificationDerivedTaskReworkAction(input, task);
	if (verificationAction) {
		return verificationAction;
	}

	const errors = getValidationErrors(input, {
		type: 'task.reworked',
		taskId: task.taskId,
		actor: 'human',
		reasonCode: 'manual.rework',
		summary: 'Manual corrective rework requested.',
		artifactRefs: []
	});
	return {
		id: `task.rework.${task.taskId}`,
		label: 'Instruct',
		action: '/task rework',
		scope: 'task',
		targetId: task.taskId,
		...buildAvailability(errors.length === 0, errors[0]),
		ui: { toolbarLabel: 'INSTRUCT', requiresConfirmation: true, confirmationPrompt: 'Restart this task with corrective guidance?' },
		flow: {
			targetLabel: 'TASK',
			actionLabel: 'INSTRUCT',
			steps: [
				{
					kind: 'text',
					id: 'task.rework.instruction',
					label: 'Instruction',
					title: 'Describe what the next attempt must do differently',
					helperText: 'This guidance is recorded as rework context and appended to the next launch prompt.',
					placeholder: 'Explain what was wrong and how the next attempt should correct it.',
					inputMode: 'expanded',
					format: 'markdown'
				}
			]
		},
		presentationTargets: buildTaskPresentationTargets(task.taskId, task.stageId as MissionStageId),
		metadata: { stageId: task.stageId as MissionStageId }
	};
}

function buildVerificationDerivedTaskReworkAction(
	input: MissionAvailableActionsInput,
	task: MissionRuntimeRecord['runtime']['tasks'][number]
): OperatorActionDescriptor | undefined {
	const targetTask = resolveVerificationReworkTargetTask(input.runtime.tasks, task);
	if (!targetTask) {
		return undefined;
	}

	const errors = getValidationErrors(input, {
		type: 'task.reworked',
		taskId: targetTask.taskId,
		actor: 'workflow',
		reasonCode: 'verification.failed',
		summary: `Verification task '${task.title}' requested corrective rework for '${targetTask.title}'.`,
		sourceTaskId: task.taskId,
		artifactRefs: []
	});

	return {
		id: `task.rework.from-verification.${task.taskId}`,
		label: 'Send Back',
		action: '/task rework',
		scope: 'task',
		targetId: targetTask.taskId,
		...buildAvailability(errors.length === 0, errors[0]),
		ui: {
			toolbarLabel: 'SEND BACK',
			requiresConfirmation: true,
			confirmationPrompt: `Send '${targetTask.title}' back for fixes using the evidence captured by verification task '${task.title}'?`
		},
		flow: { targetLabel: 'TASK', actionLabel: 'SEND BACK', steps: [] },
		presentationTargets: [{ scope: 'task', targetId: task.taskId }, { scope: 'stage', targetId: task.stageId as MissionStageId }],
		metadata: { stageId: task.stageId as MissionStageId },
		ordering: { group: 'recovery' }
	};
}

function buildTaskLaunchPolicyActions(input: MissionAvailableActionsInput, task: MissionRuntimeRecord['runtime']['tasks'][number]): OperatorActionDescriptor[] {
	const actions: OperatorActionDescriptor[] = [];
	const changeErrors = (autostart: boolean) => getValidationErrors(input, {
		type: 'task.launch-policy.changed',
		taskId: task.taskId,
		autostart
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
			metadata: { stageId: task.stageId as MissionStageId, autostart: false }
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
			metadata: { stageId: task.stageId as MissionStageId, autostart: true }
		});
	}

	return actions;
}

function buildSessionCancelAction(session: MissionAgentSessionRecord, stageId: MissionStageId | undefined): OperatorActionDescriptor {
	const enabled = session.lifecycleState === 'starting' || session.lifecycleState === 'running' || session.lifecycleState === 'awaiting-input';
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

function buildSessionTerminateAction(session: MissionAgentSessionRecord, stageId: MissionStageId | undefined): OperatorActionDescriptor {
	const enabled = session.lifecycleState === 'starting' || session.lifecycleState === 'running' || session.lifecycleState === 'awaiting-input';
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
		...(state.runnerId ? { runnerId: state.runnerId } : {}),
		...(state.runnerLabel ? { runnerLabel: state.runnerLabel } : {}),
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
			...(overrides.runnerId ? { runnerId: overrides.runnerId } : {}),
			...(overrides.runnerLabel ? { runnerLabel: overrides.runnerLabel } : {}),
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

function resolveVerificationReworkTargetTask(
	tasks: Array<{ taskId: string; stageId: string; title: string; taskKind?: 'implementation' | 'verification'; pairedTaskId?: string }>,
	task: { taskId: string; stageId: string; title: string; taskKind?: 'implementation' | 'verification'; pairedTaskId?: string }
) {
	if (task.taskKind !== 'verification' || !task.pairedTaskId) {
		return undefined;
	}

	return tasks.find((candidate) => candidate.taskId === task.pairedTaskId && candidate.taskKind === 'implementation');
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

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`Timed out after ${String(timeoutMs)}ms.`));
		}, timeoutMs);

		promise.then(
			(value) => {
				clearTimeout(timeout);
				resolve(value);
			},
			(error) => {
				clearTimeout(timeout);
				reject(error);
			}
		);
	});
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
	if (input.runtime.lifecycle === 'completed') {
		return 'Mission is already completed.';
	}
	if (input.runtime.lifecycle === 'delivered') {
		return 'Mission already delivered.';
	}
	return errors[0] ?? 'Mission cannot enter panic state.';
}

function describeClearPanicUnavailable(input: MissionAvailableActionsInput, errors: string[]): string {
	if (!input.runtime.panic.active) {
		return 'Mission is not panicked.';
	}
	return errors[0] ?? 'Panic cannot be cleared right now.';
}

function describeRestartLaunchQueueUnavailable(input: MissionAvailableActionsInput, errors: string[]): string {
	if (input.runtime.panic.active || input.runtime.lifecycle === 'panicked') {
		return 'Clear panic before restarting the launch queue.';
	}
	if (input.runtime.pause.paused || input.runtime.lifecycle !== 'running') {
		return 'Mission must be running to restart the launch queue.';
	}
	const hasQueuedWork =
		input.runtime.launchQueue.length > 0
		|| input.runtime.tasks.some((task) => task.lifecycle === 'queued');
	if (!hasQueuedWork) {
		return 'There are no queued tasks to restart.';
	}
	return errors[0] ?? 'Launch queue cannot be restarted right now.';
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
			return task.waitingOnTaskIds.length > 0 ? `Waiting on ${task.waitingOnTaskIds.join(', ')}.` : 'Waiting for an earlier stage to become eligible.';
		case 'queued': return 'Task is already queued.';
		case 'running': return 'Task is already running.';
		case 'completed': return 'Task is already completed.';
		case 'failed':
		case 'cancelled':
			return 'Reopen the task before starting it again.';
		default:
			return errors[0] ?? 'Task is not ready to start.';
	}
}

function isActiveMissionAgentSession(lifecycleState: MissionAgentLifecycleState): boolean {
	return lifecycleState === 'starting'
		|| lifecycleState === 'running'
		|| lifecycleState === 'awaiting-input';
}

function isTerminalStatus(status: AgentSessionSnapshot['status']): boolean {
	return status === 'completed'
		|| status === 'failed'
		|| status === 'cancelled'
		|| status === 'terminated';
}

function getValidationErrors(
	input: MissionAvailableActionsInput,
	event:
		| { type: 'mission.resumed' }
		| { type: 'mission.panic.requested' }
		| { type: 'mission.panic.cleared' }
		| { type: 'mission.launch-queue.restarted' }
		| { type: 'mission.delivered' }
		| { type: 'task.queued'; taskId: string }
		| { type: 'task.completed'; taskId: string }
		| { type: 'task.reopened'; taskId: string }
		| { type: 'task.reworked'; taskId: string; actor: 'human' | 'system' | 'workflow'; reasonCode: string; summary: string; sourceTaskId?: string; sourceSessionId?: string; artifactRefs: Array<{ path: string; title?: string }> }
		| { type: 'task.launch-policy.changed'; taskId: string; autostart: boolean }
): string[] {
	return getMissionWorkflowEventValidationErrors(
		input.runtime,
		{ eventId: `${input.missionId}:action`, occurredAt: input.runtime.updatedAt, source: 'human', ...event } as MissionWorkflowEvent,
		input.configuration
	);
}

function requireTextActionStep(
	steps: OperatorActionExecutionStep[],
	stepId: string
): Extract<OperatorActionExecutionStep, { kind: 'text' }> {
	const step = steps.find((candidate): candidate is Extract<OperatorActionExecutionStep, { kind: 'text' }> =>
		candidate.kind === 'text' && candidate.stepId === stepId
	);
	if (!step) {
		throw new Error(`Mission action requires text step '${stepId}'.`);
	}
	if (!step.value.trim()) {
		throw new Error(`Mission action requires a non-empty text value for step '${stepId}'.`);
	}
	return step;
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
	return (input.runtime.activeStageId as MissionStageId | undefined)
		?? (input.runtime.stages.find((stage) => stage.lifecycle !== 'completed')?.stageId as MissionStageId | undefined)
		?? (input.configuration.workflow.stageOrder[input.configuration.workflow.stageOrder.length - 1] as MissionStageId | undefined);
}

function isRuntimeDelivered(runtime: MissionRuntimeRecord['runtime']): boolean {
	return runtime.stages.some((stage) => stage.stageId === 'delivery' && stage.lifecycle === 'completed');
}

function stripTaskStemPrefix(value: string): string {
	return value.replace(/^\d+(?:-[a-z0-9]+)?-/iu, '');
}

function stripMarkdownExtension(value: string): string {
	return value.toLowerCase().endsWith('.md') ? value.slice(0, -3) : value;
}
