import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AgentSession, type AgentSessionMetadata } from './AgentSession.js';
import { Stage } from './Stage.js';
import {
	MissionAgentEventEmitter,
	cloneMissionAgentSessionRecord,
	type MissionAgentConsoleEvent,
	type MissionAgentConsoleState,
	type MissionAgentEvent,
	type MissionAgentRuntime,
	type MissionAgentScope,
	type MissionAgentSessionLaunchRequest,
	type MissionAgentSessionRecord,
	type MissionAgentTurnRequest
} from '../MissionAgentRuntime.js';
import {
	MISSION_ARTIFACTS,
	MISSION_STAGES,
	MISSION_TASK_STAGE_DIRECTORIES,
	evaluateMissionStageStatusIntent,
	evaluateMissionTaskLaunchEligibility,
	evaluateMissionTaskStatusIntent,
	getPrimaryMissionStageStatusIntent,
	type MissionTaskUpdate,
	type MissionStageControlState,
	type MissionControlState,
	type GateIntent,
	type MissionDescriptor,
	type MissionGateResult,
	type MissionArtifactKey,
	type MissionRecord,
	type MissionCommandDescriptor,
	type MissionCommandFlowDescriptor,
	type MissionStageId,
	type MissionStageStatus,
	type MissionStageStatusIntent,
	type MissionStatus,
	type MissionTaskStatusIntent,
	type MissionTaskState
} from '../../types.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import { getDaemonSessionStatePath } from '../daemonPaths.js';

type StageInventory = {
	stage: MissionStageId;
	directoryName: string;
	status: MissionStageStatus['status'];
	tasks: MissionTaskState[];
	taskCount: number;
	completedTaskCount: number;
};

export class Mission {
	private readonly agentRuntimeRegistry = new Map<string, MissionAgentRuntime>();
	private readonly managedAgentSessions = new Map<string, AgentSession>();
	private readonly agentConsoleEventEmitter = new MissionAgentEventEmitter<MissionAgentConsoleEvent>();
	private readonly agentEventEmitter = new MissionAgentEventEmitter<MissionAgentEvent>();
	private sessionMutationQueue: Promise<void> = Promise.resolve();
	private descriptor: MissionDescriptor;
	private agentSessions: MissionAgentSessionRecord[] = [];
	private lastKnownStatus?: MissionStatus;

	private constructor(
		private readonly adapter: FilesystemAdapter,
		private readonly missionDir: string,
		descriptor: MissionDescriptor
	) {
		this.descriptor = descriptor;
	}

	public readonly onDidAgentConsoleEvent = this.agentConsoleEventEmitter.event;
	public readonly onDidAgentEvent = this.agentEventEmitter.event;

	public static hydrate(
		adapter: FilesystemAdapter,
		missionDir: string,
		descriptor: MissionDescriptor
	): Mission {
		return new Mission(adapter, missionDir, descriptor);
	}

	public async initialize(): Promise<this> {
		await this.adapter.initializeMissionEnvironment(this.missionDir);
		await this.adapter.writeMissionDescriptor(this.missionDir, this.descriptor);
		await this.createStage('prd').enter(this.adapter, { activateNextTask: false });
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
		await this.sessionMutationQueue.catch(() => undefined);
		this.agentSessions = await this.readPersistedAgentSessions();
		this.lastKnownStatus = await this.buildStatus();
		return this;
	}

	public async status(): Promise<MissionStatus> {
		const nextDescriptor = await this.adapter.readMissionDescriptor(this.missionDir);
		if (nextDescriptor) {
			this.descriptor = nextDescriptor;
		}

		await this.sessionMutationQueue.catch(() => undefined);
		this.agentSessions = await this.readPersistedAgentSessions();
		this.lastKnownStatus = await this.buildStatus();
		return this.lastKnownStatus;
	}

	public registerAgentRuntime(runtime: MissionAgentRuntime): void {
		const existing = this.agentRuntimeRegistry.get(runtime.id);
		if (existing && existing !== runtime) {
			throw new Error(`Mission agent runtime '${runtime.id}' is already registered.`);
		}

		this.agentRuntimeRegistry.set(runtime.id, runtime);
	}

	public getAgentSessions(): MissionAgentSessionRecord[] {
		return this.agentSessions.map((record) => cloneMissionAgentSessionRecord(record));
	}

	public getAgentSession(sessionId: string): MissionAgentSessionRecord | undefined {
		const record = this.agentSessions.find((candidate) => candidate.sessionId === sessionId);
		return record ? cloneMissionAgentSessionRecord(record) : undefined;
	}

	public getAgentConsoleState(sessionId: string): MissionAgentConsoleState | undefined {
		return this.managedAgentSessions.get(sessionId)?.getConsoleState();
	}

	public async launchAgentSession(
		request: MissionAgentSessionLaunchRequest
	): Promise<MissionAgentSessionRecord> {
		const task = request.taskId ? await this.prepareTaskOwnedSession(request.taskId) : undefined;
		const runtime = this.requireAgentRuntime(request.runtimeId);
		const availability = await runtime.isAvailable();
		if (!availability.available) {
			throw new Error(availability.detail ?? `${runtime.displayName} is unavailable.`);
		}

		const existingRecord = request.sessionId ? this.getAgentSession(request.sessionId) : undefined;
		let managed = request.sessionId ? this.managedAgentSessions.get(request.sessionId) : undefined;
		if (managed && managed.runtimeId !== runtime.id) {
			throw new Error(
				`Mission agent session '${managed.sessionId}' is attached to runtime '${managed.runtimeId}', not '${runtime.id}'.`
			);
		}

		if (!managed || request.startFreshSession === true) {
			if (managed) {
				this.detachManagedAgentSession(managed.sessionId);
			}

			if (request.sessionId && !runtime.resumeSession && !request.startFreshSession) {
				throw new Error(
					`${runtime.displayName} cannot resume session '${request.sessionId}'. Start a fresh session instead.`
				);
			}

			const session =
				request.sessionId && runtime.resumeSession
					? await runtime.resumeSession(request.sessionId)
					: await runtime.createSession();
			managed = this.attachManagedAgentSession(runtime, session, {
				createdAt: existingRecord?.createdAt ?? new Date().toISOString(),
				...(request.taskId
					? { taskId: request.taskId }
					: existingRecord?.taskId
						? { taskId: existingRecord.taskId }
						: {}),
				...(request.assignmentLabel
					? { assignmentLabel: request.assignmentLabel }
					: task?.relativePath
						? { assignmentLabel: task.relativePath }
						: existingRecord?.assignmentLabel
							? { assignmentLabel: existingRecord.assignmentLabel }
							: {})
			});
			await managed.persist();
		} else if (request.assignmentLabel) {
			managed.updateMetadata({
				assignmentLabel: request.assignmentLabel,
				...(request.taskId ? { taskId: request.taskId } : {})
			});
			await managed.persist();
		}

		await managed.submitTurn({
			workingDirectory: request.workingDirectory,
			prompt: request.prompt,
			...(request.scope
				? { scope: request.scope }
				: task
					? { scope: this.createTaskAgentScope(task) }
					: {}),
			...(request.title ? { title: request.title } : task ? { title: task.subject } : {}),
			...(request.operatorIntent ? { operatorIntent: request.operatorIntent } : {}),
			...(request.startFreshSession !== undefined
				? { startFreshSession: request.startFreshSession }
				: {})
		});

		return this.requirePersistedAgentSession(managed.sessionId);
	}

	public async submitAgentTurn(
		sessionId: string,
		request: MissionAgentTurnRequest
	): Promise<MissionAgentSessionRecord> {
		const managed = this.requireManagedAgentSession(sessionId);
		await managed.submitTurn(request);
		return this.requirePersistedAgentSession(sessionId);
	}

	public async sendAgentInput(
		sessionId: string,
		text: string
	): Promise<MissionAgentSessionRecord> {
		const managed = this.requireManagedAgentSession(sessionId);
		await managed.sendInput(text);
		return this.requirePersistedAgentSession(sessionId);
	}

	public async resizeAgentSession(
		sessionId: string,
		dimensions: { cols: number; rows: number }
	): Promise<MissionAgentSessionRecord> {
		const managed = this.requireManagedAgentSession(sessionId);
		const cols = Math.max(1, Math.floor(dimensions.cols));
		const rows = Math.max(1, Math.floor(dimensions.rows));
		await managed.resize({ cols, rows });
		return this.requirePersistedAgentSession(sessionId);
	}

	public async cancelAgentSession(
		sessionId: string,
		reason?: string
	): Promise<MissionAgentSessionRecord> {
		const managed = this.requireManagedAgentSession(sessionId);
		await managed.cancel(reason);
		return this.requirePersistedAgentSession(sessionId);
	}

	public async terminateAgentSession(
		sessionId: string,
		reason?: string
	): Promise<MissionAgentSessionRecord> {
		const managed = this.requireManagedAgentSession(sessionId);
		await managed.terminate(reason);
		return this.requirePersistedAgentSession(sessionId);
	}

	public disposeAgentSession(sessionId: string): void {
		this.detachManagedAgentSession(sessionId);
	}

	public dispose(): void {
		for (const sessionId of this.managedAgentSessions.keys()) {
			this.detachManagedAgentSession(sessionId);
		}
		this.agentConsoleEventEmitter.dispose();
		this.agentEventEmitter.dispose();
	}

	public async evaluateGate(intent: GateIntent): Promise<MissionGateResult> {
		const status = await this.status();
		const stages = status.stages ?? [];
		const errors: string[] = [];
		const warnings: string[] = [];
		const currentBranch = this.adapter.getCurrentBranch(this.adapter.getMissionWorkspacePath(this.missionDir));

		if (this.isDelivered(status.stages ?? [])) {
			errors.push('This mission has already been delivered.');
		}

		if (status.branchRef && currentBranch && currentBranch !== 'HEAD' && currentBranch !== status.branchRef) {
			errors.push(`Current branch '${currentBranch}' does not match mission branch '${status.branchRef}'.`);
		}

		switch (intent) {
			case 'implement':
			case 'commit':
				if (status.stage !== 'implementation') {
					errors.push(`Intent '${intent}' requires stage 'implementation'. Current stage: '${status.stage ?? 'unknown'}'.`);
				}
				if (!this.arePreviousStagesComplete(stages, 'implementation')) {
					errors.push('PRD and SPEC tasks must be complete before implementation actions are allowed.');
				}
				break;
			case 'verify':
				if (status.stage !== 'implementation') {
					errors.push(`Intent 'verify' requires stage 'implementation'. Current stage: '${status.stage ?? 'unknown'}'.`);
				}
				if (!this.isStageComplete(stages, 'implementation')) {
					errors.push('Implementation tasks must be complete before verification can begin.');
				}
				break;
			case 'audit':
				if (status.stage !== 'audit') {
					errors.push(`Intent 'audit' requires stage 'audit'. Current stage: '${status.stage ?? 'unknown'}'.`);
				}
				if (!this.isStageComplete(stages, 'implementation')) {
					errors.push('Implementation tasks must be complete before audit can begin.');
				}
				break;
			case 'deliver':
				if (status.stage !== 'delivery') {
					errors.push(`Intent 'deliver' requires stage 'delivery'. Current stage: '${status.stage ?? 'unknown'}'.`);
				}
				if (!this.isStageComplete(stages, 'audit')) {
					errors.push('Audit tasks must be complete before delivery.');
				}
				if (!stages.every((stage) => stage.completedTaskCount === stage.taskCount)) {
					errors.push('All mission tasks must be marked done before delivery.');
				}
				break;
		}

		return {
			allowed: errors.length === 0,
			intent,
			...(status.stage ? { stage: status.stage } : {}),
			errors,
			warnings
		};
	}

	public async transition(toStage: MissionStageId): Promise<MissionRecord> {
		const status = await this.status();
		const stage = this.requireStageStatus(status.stages ?? [], toStage);
		const intent = getPrimaryMissionStageStatusIntent(stage.status);
		await this.applyStageIntent(stage, intent, status.stages ?? []);
		await this.status();
		return this.getRecord();
	}

	public async updateStageState(
		stageId: MissionStageId,
		intent: MissionStageStatusIntent
	): Promise<MissionRecord> {
		const status = await this.status();
		const stage = this.requireStageStatus(status.stages ?? [], stageId);
		await this.applyStageIntent(stage, intent, status.stages ?? []);
		await this.status();
		return this.getRecord();
	}

	public async deliver(): Promise<MissionRecord> {
		const gate = await this.evaluateGate('deliver');
		if (!gate.allowed) {
			throw new Error(gate.errors.join(' | '));
		}

		const deliveredAt = new Date().toISOString();
		await this.adapter.setMissionDeliveredAt(this.missionDir, deliveredAt);
		await this.status();
		return this.getRecord();
	}

	public async updateTaskState(taskId: string, changes: MissionTaskUpdate): Promise<MissionTaskState> {
		const task = await this.requireTaskState(taskId);
		if (changes.status === 'active') {
			this.ensureTaskStatusCanTransition(task, 'active');
		}
		if (changes.status === 'done') {
			this.ensureTaskStatusCanTransition(task, 'done');
		}
		if (changes.status === 'blocked') {
			this.ensureTaskStatusCanTransition(task, 'blocked');
		}

		await this.adapter.updateTaskState(task, changes);
		await this.status();
		return this.requireTaskState(taskId);
	}

	private async buildStatus(): Promise<MissionStatus> {
		const controlState = await this.adapter.reconcileMissionControlState(this.missionDir);
		const inventories = await Promise.all(
			MISSION_STAGES.map((stage) => this.readStageInventory(stage, controlState))
		);
		const currentStageId = this.resolveCurrentStage(inventories);
		const stages = inventories.map((inventory, index) => this.toStageStatus(inventory, currentStageId, index));
		const currentStage = stages.find((stage) => stage.stage === currentStageId) ?? stages[0];
		const activeTasks = this.resolveActiveTasks(currentStage);
		const readyTasks = this.resolveReadyTasks(currentStage);
		const productFiles = await this.collectProductFiles();
		const delivered = this.isDelivered(stages);

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
			agentSessions: this.getAgentSessions(),
			recommendedCommand: this.buildRecommendedCommand(currentStageId, activeTasks, readyTasks),
			availableCommands: this.buildAvailableCommands(stages, currentStageId, this.getAgentSessions(), delivered)
		};
	}

	private buildAvailableCommands(
		stages: MissionStageStatus[],
		currentStageId: MissionStageId,
		sessions: MissionAgentSessionRecord[],
		delivered: boolean
	): MissionCommandDescriptor[] {
		const commands: MissionCommandDescriptor[] = [];

		const canDeliver =
			!delivered &&
			currentStageId === 'delivery' &&
			this.isStageComplete(stages, 'audit') &&
			stages.every((stage) => stage.completedTaskCount === stage.taskCount);
		commands.push({
			id: 'mission.deliver',
			label: 'Deliver mission',
			command: '/deliver',
			scope: 'mission',
			enabled: canDeliver,
			ui: {
				toolbarLabel: 'DELIVER',
				requiresConfirmation: true,
				confirmationPrompt: 'Deliver this mission now?'
			},
			flow: {
				targetLabel: 'MISSION',
				actionLabel: 'DELIVER',
				steps: []
			},
			...(canDeliver ? {} : { reason: delivered ? 'Mission already delivered.' : 'Audit must be complete and the mission must be in delivery.' })
		});

		for (const stage of stages) {
			const stageIntent = getPrimaryMissionStageStatusIntent(stage.status);
			const stageRule = this.evaluateStageStatusTransition(
				stage,
				delivered,
				stageIntent,
				stages
			);
			commands.push({
				id: `stage.${stageIntent}.${stage.stage}`,
				label: this.buildStageCommandLabel(stage.stage, stageIntent),
				command:
					stageIntent === 'start'
						? `/stage start ${stage.stage}`
						: `/stage restart ${stage.stage}`,
				scope: 'stage',
				targetId: stage.stage,
				enabled: stageRule.enabled,
				ui: {
					toolbarLabel: stageIntent === 'start' ? 'START STAGE' : 'RESTART STAGE',
					requiresConfirmation: true,
					confirmationPrompt:
						stageIntent === 'start'
							? `Start ${stage.stage.toUpperCase()} stage?`
							: `Restart ${stage.stage.toUpperCase()} stage and reset its tasks?`
				},
				flow: this.buildStageTransitionFlow(stage.stage, stageIntent),
				...(stageRule.enabled ? {} : { reason: stageRule.reason })
			});
			for (const task of stage.tasks) {
				const activateRule = this.evaluateTaskStatusTransition(task, delivered, 'active');
				commands.push({
					id: `task.activate.${task.taskId}`,
					label: `Set ${task.subject} active`,
					command: '/task active',
					scope: 'task',
					targetId: task.taskId,
					enabled: activateRule.enabled,
					ui: {
						toolbarLabel: 'START TASK',
						requiresConfirmation: false
					},
					flow: {
						targetLabel: 'TASK',
						actionLabel: 'ACTIVE',
						steps: []
					},
					...(activateRule.enabled ? {} : { reason: activateRule.reason })
				});

				const completeRule = this.evaluateTaskStatusTransition(task, delivered, 'done');
				commands.push({
					id: `task.complete.${task.taskId}`,
					label: `Mark ${task.subject} done`,
					command: '/task done',
					scope: 'task',
					targetId: task.taskId,
					enabled: completeRule.enabled,
					ui: {
						toolbarLabel: 'COMPLETE TASK',
						requiresConfirmation: true,
						confirmationPrompt: 'Mark this task as done?'
					},
					flow: {
						targetLabel: 'TASK',
						actionLabel: 'DONE',
						steps: []
					},
					...(completeRule.enabled ? {} : { reason: completeRule.reason })
				});

				const blockRule = this.evaluateTaskStatusTransition(task, delivered, 'blocked');
				commands.push({
					id: `task.block.${task.taskId}`,
					label: `Mark ${task.subject} blocked`,
					command: '/task blocked',
					scope: 'task',
					targetId: task.taskId,
					enabled: blockRule.enabled,
					ui: {
						toolbarLabel: 'PAUSE TASK',
						requiresConfirmation: true,
						confirmationPrompt: 'Pause this task and mark it blocked?'
					},
					flow: {
						targetLabel: 'TASK',
						actionLabel: 'BLOCKED',
						steps: []
					},
					...(blockRule.enabled ? {} : { reason: blockRule.reason })
				});

				const launchRule = evaluateMissionTaskLaunchEligibility({
					currentStatus: task.status,
					blockedBy: task.blockedBy,
					delivered
				});
				commands.push({
					id: `task.launch.${task.taskId}`,
					label: `Launch agent for ${task.subject}`,
					command: '/launch',
					scope: 'task',
					targetId: task.taskId,
					enabled: launchRule.enabled,
					ui: {
						toolbarLabel: 'START AGENT',
						requiresConfirmation: false
					},
					flow: {
						targetLabel: 'AGENT',
						actionLabel: 'LAUNCH',
						steps: []
					},
					...(launchRule.enabled ? {} : { reason: launchRule.reason })
				});
			}
		}

		for (const session of sessions) {
			const canControl =
				session.lifecycleState !== 'completed' &&
				session.lifecycleState !== 'failed' &&
				session.lifecycleState !== 'cancelled';
			commands.push({
				id: `session.cancel.${session.sessionId}`,
				label: `Cancel session ${session.sessionId}`,
				command: '/cancel',
				scope: 'session',
				targetId: session.sessionId,
				enabled: canControl,
				ui: {
					toolbarLabel: 'STOP AGENT',
					requiresConfirmation: true,
					confirmationPrompt: 'Stop the running agent session?'
				},
				flow: {
					targetLabel: 'AGENT',
					actionLabel: 'CANCEL',
					steps: []
				},
				...(canControl ? {} : { reason: 'Session is not active.' })
			});
			commands.push({
				id: `session.terminate.${session.sessionId}`,
				label: `Terminate session ${session.sessionId}`,
				command: '/terminate',
				scope: 'session',
				targetId: session.sessionId,
				enabled: canControl,
				ui: {
					toolbarLabel: 'FORCE STOP',
					requiresConfirmation: true,
					confirmationPrompt: 'Force stop this agent session?'
				},
				flow: {
					targetLabel: 'AGENT',
					actionLabel: 'TERMINATE',
					steps: []
				},
				...(canControl ? {} : { reason: 'Session is not active.' })
			});
		}

		return commands;
	}

	private buildStageTransitionFlow(
		stageId: MissionStageId,
		intent: MissionStageStatusIntent
	): MissionCommandFlowDescriptor {
		return {
			targetLabel: stageId.toUpperCase(),
			actionLabel: intent === 'start' ? 'START' : 'RESTART',
			steps: []
		};
	}

	private buildStageCommandLabel(
		stageId: MissionStageId,
		intent: MissionStageStatusIntent
	): string {
		return intent === 'start' ? `Start ${stageId}` : `Restart ${stageId}`;
	}

	private evaluateStageStatusTransition(
		stage: MissionStageStatus,
		delivered: boolean,
		intent: MissionStageStatusIntent,
		stages: MissionStageStatus[]
	): { enabled: boolean; reason?: string } {
		const evaluation = evaluateMissionStageStatusIntent(intent, {
			currentStatus: stage.status,
			previousStagesComplete: this.arePreviousStagesComplete(stages, stage.stage),
			delivered
		});
		return {
			enabled: evaluation.enabled,
			...(evaluation.reason ? { reason: evaluation.reason } : {})
		};
	}

	private evaluateTaskStatusTransition(
		task: MissionTaskState,
		delivered: boolean,
		intent: MissionTaskStatusIntent
	): { enabled: boolean; reason?: string } {
		const evaluation = evaluateMissionTaskStatusIntent(intent, {
			currentStatus: task.status,
			blockedBy: task.blockedBy,
			delivered
		});
		return {
			enabled: evaluation.enabled,
			...(evaluation.reason ? { reason: evaluation.reason } : {})
		};
	}

	private async readStageInventory(
		stage: MissionStageId,
		controlState: MissionControlState
	): Promise<StageInventory> {
		const stageState = this.getStageControlState(controlState, stage);
		const directoryName = this.createStage(stage).getDirectoryName();
		const tasks = await this.adapter.listTaskStates(this.missionDir, stage, controlState);

		return {
			stage,
			directoryName,
			status: stageState?.status ?? 'pending',
			tasks,
			taskCount: tasks.length,
			completedTaskCount: tasks.filter((task) => task.status === 'done').length
		};
	}

	private resolveCurrentStage(inventories: StageInventory[]): MissionStageId {
		const activeStage = inventories.find((inventory) => inventory.status === 'active');
		if (activeStage) {
			return activeStage.stage;
		}

		const pendingStage = inventories.find((inventory) => inventory.status === 'pending');
		if (pendingStage) {
			return pendingStage.stage;
		}

		return inventories[inventories.length - 1]?.stage ?? 'prd';
	}

	private toStageStatus(
		inventory: StageInventory,
		currentStageId: MissionStageId,
		stageIndex: number
	): MissionStageStatus {
		void currentStageId;
		void stageIndex;
		const activeTasks = inventory.tasks.filter((task) => task.status === 'active');
		const readyTasks = inventory.tasks.filter((task) => this.isTaskReady(task));

		return {
			stage: inventory.stage,
			directoryName: inventory.directoryName,
			status: inventory.status,
			taskCount: inventory.taskCount,
			completedTaskCount: inventory.completedTaskCount,
			activeTaskIds: activeTasks.map((task) => task.taskId),
			readyTaskIds: readyTasks.map((task) => task.taskId),
			tasks: inventory.tasks
		};
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

	private buildRecommendedCommand(
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

	private arePreviousStagesComplete(stages: MissionStageStatus[], targetStage: MissionStageId): boolean {
		const targetIndex = MISSION_STAGES.indexOf(targetStage);
		if (targetIndex <= 0) {
			return true;
		}

		for (const stage of stages) {
			const stageIndex = MISSION_STAGES.indexOf(stage.stage);
			if (stageIndex < 0 || stageIndex >= targetIndex) {
				continue;
			}

			if (stage.completedTaskCount !== stage.taskCount) {
				return false;
			}
		}

		return true;
	}

	private isStageComplete(stages: MissionStageStatus[], targetStage: MissionStageId): boolean {
		const stage = stages.find((candidate) => candidate.stage === targetStage);
		return stage !== undefined && stage.status === 'done';
	}

	private getStageControlState(
		controlState: MissionControlState,
		stageId: MissionStageId
	): MissionStageControlState | undefined {
		return controlState.stages.find((stage) => stage.id === stageId);
	}

	private isDelivered(stages: MissionStageStatus[]): boolean {
		return stages.some((stage) => stage.stage === 'delivery' && stage.status === 'done');
	}

	private requireStageStatus(
		stages: MissionStageStatus[],
		stageId: MissionStageId
	): MissionStageStatus {
		const stage = stages.find((candidate) => candidate.stage === stageId);
		if (!stage) {
			throw new Error(`Mission stage '${stageId}' does not exist.`);
		}
		return stage;
	}

	private async applyStageIntent(
		stage: MissionStageStatus,
		intent: MissionStageStatusIntent,
		stages: MissionStageStatus[]
	): Promise<void> {
		this.ensureStageStatusCanTransition(stage, intent, stages);
		if (intent === 'restart') {
			await this.resetStageTasks(stage.stage);
		}
		await this.activateStage(stage.stage);
	}

	private async activateStage(stageId: MissionStageId): Promise<void> {
		await this.createStage(stageId).enter(this.adapter, { activateNextTask: true });
		await this.adapter.activateMissionStage(this.missionDir, stageId);
	}

	private async resetStageTasks(stageId: MissionStageId): Promise<void> {
		const tasks = await this.adapter.listTaskStates(this.missionDir, stageId);
		for (const task of tasks) {
			await this.adapter.updateTaskState(task, {
				status: 'todo',
				retries: 0
			});
		}
	}

	private createStage(stageId: MissionStageId): Stage {
		return new Stage(this.descriptor, stageId, this.isDelivered(this.lastKnownStatus?.stages ?? []));
	}

	private getAgentSessionsFilePath(): string {
		return getDaemonSessionStatePath(this.adapter.getWorkspaceRoot(), this.descriptor.missionId);
	}

	private async readPersistedAgentSessions(): Promise<MissionAgentSessionRecord[]> {
		try {
			const content = await fs.readFile(this.getAgentSessionsFilePath(), 'utf8');
			const parsed = JSON.parse(content);
			if (!Array.isArray(parsed)) {
				return [];
			}
			return parsed.map((record) => cloneMissionAgentSessionRecord(record as MissionAgentSessionRecord));
		} catch {
			return [];
		}
	}

	private async writePersistedAgentSessions(records: MissionAgentSessionRecord[]): Promise<void> {
		const destinationPath = this.getAgentSessionsFilePath();
		const directoryPath = path.dirname(destinationPath);
		await fs.mkdir(directoryPath, { recursive: true });
		const tempPath = path.join(
			directoryPath,
			`${path.basename(destinationPath)}.${process.pid.toString(36)}.tmp`
		);
		await fs.writeFile(tempPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
		await fs.rename(tempPath, destinationPath);
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

	private ensureTaskStatusCanTransition(
		task: MissionTaskState,
		intent: MissionTaskStatusIntent
	): void {
		const delivered = this.isDelivered(this.lastKnownStatus?.stages ?? []);
		const evaluation = this.evaluateTaskStatusTransition(task, delivered, intent);
		if (!evaluation.enabled) {
			throw new Error(
				evaluation.reason
					? `Mission task '${task.taskId}' cannot transition: ${evaluation.reason}`
					: `Mission task '${task.taskId}' cannot transition via '${intent}'.`
			);
		}
	}

	private ensureStageStatusCanTransition(
		stage: MissionStageStatus,
		intent: MissionStageStatusIntent,
		stages: MissionStageStatus[]
	): void {
		const delivered = this.isDelivered(this.lastKnownStatus?.stages ?? stages);
		const evaluation = this.evaluateStageStatusTransition(stage, delivered, intent, stages);
		if (!evaluation.enabled) {
			throw new Error(
				evaluation.reason
					? `Mission stage '${stage.stage}' cannot transition: ${evaluation.reason}`
					: `Mission stage '${stage.stage}' cannot transition via '${intent}'.`
			);
		}
	}

	private requireAgentRuntime(runtimeId: string): MissionAgentRuntime {
		const runtime = this.agentRuntimeRegistry.get(runtimeId);
		if (!runtime) {
			throw new Error(`Mission agent runtime '${runtimeId}' is not registered.`);
		}
		return runtime;
	}

	private requireManagedAgentSession(sessionId: string): AgentSession {
		const managed = this.managedAgentSessions.get(sessionId);
		if (managed) {
			return managed;
		}

		const persisted = this.agentSessions.find((candidate) => candidate.sessionId === sessionId);
		if (persisted) {
			throw new Error(
				`Mission agent session '${sessionId}' is recorded for runtime '${persisted.runtimeId}' but is not attached in this process.`
			);
		}

		throw new Error(`Mission agent session '${sessionId}' is not attached to this mission.`);
	}

	private async prepareTaskOwnedSession(taskId: string): Promise<MissionTaskState> {
		const task = await this.requireTaskState(taskId);
		if (task.status === 'active') {
			return task;
		}

		this.ensureTaskStatusCanTransition(task, 'active');
		await this.adapter.updateTaskState(task, { status: 'active' });
		await this.status();
		return this.requireTaskState(taskId);
	}

	private createTaskAgentScope(task: MissionTaskState): MissionAgentScope {
		return {
			kind: 'slice',
			sliceTitle: task.subject,
			verificationTargets: [],
			requiredSkills: [],
			dependsOn: [...task.dependsOn],
			...(this.descriptor.missionId ? { missionId: this.descriptor.missionId } : {}),
			...(this.adapter.getMissionWorkspacePath(this.missionDir)
				? { missionDir: this.adapter.getMissionWorkspacePath(this.missionDir) }
				: {}),
			...(task.stage ? { stage: task.stage } : {}),
			...(task.taskId ? { taskId: task.taskId } : {}),
			...(task.subject ? { taskTitle: task.subject } : {}),
			...(task.subject ? { taskSummary: task.subject } : {}),
			...(task.instruction ? { taskInstruction: task.instruction } : {})
		};
	}

	private requirePersistedAgentSession(sessionId: string): MissionAgentSessionRecord {
		const record = this.agentSessions.find((candidate) => candidate.sessionId === sessionId);
		if (!record) {
			throw new Error(`Mission agent session '${sessionId}' is not recorded in mission state.`);
		}

		return cloneMissionAgentSessionRecord(record);
	}

	private attachManagedAgentSession(
		runtime: MissionAgentRuntime,
		session: Awaited<ReturnType<MissionAgentRuntime['createSession']>>,
		metadata: AgentSessionMetadata
	): AgentSession {
		const managed = new AgentSession(runtime, session, metadata, {
			persistRecord: async (record) => {
				await this.persistAgentSessionRecord(record);
			},
			emitConsoleEvent: (event) => {
				this.agentConsoleEventEmitter.fire(event);
			},
			emitEvent: (event) => {
				this.agentEventEmitter.fire(event);
			}
		});

		this.managedAgentSessions.set(session.sessionId, managed);
		return managed;
	}

	private detachManagedAgentSession(sessionId: string): void {
		const managed = this.managedAgentSessions.get(sessionId);
		if (!managed) {
			return;
		}

		managed.dispose();
		this.managedAgentSessions.delete(sessionId);
	}

	private async persistAgentSessionRecord(sessionRecord: MissionAgentSessionRecord): Promise<void> {
		await this.updatePersistedAgentSessions((records) => {
			const nextRecords = records.map((record) => cloneMissionAgentSessionRecord(record));
			const existingIndex = nextRecords.findIndex((record) => record.sessionId === sessionRecord.sessionId);
			if (existingIndex >= 0) {
				nextRecords[existingIndex] = cloneMissionAgentSessionRecord(sessionRecord);
			} else {
				nextRecords.push(cloneMissionAgentSessionRecord(sessionRecord));
			}
			return nextRecords;
		});
	}

	private async updatePersistedAgentSessions(
		mutator: (records: MissionAgentSessionRecord[]) => MissionAgentSessionRecord[]
	): Promise<void> {
		const writeOperation = this.sessionMutationQueue
			.catch(() => undefined)
			.then(async () => {
				const baseRecords = await this.readPersistedAgentSessions();
				const nextRecords = mutator(baseRecords);
				this.agentSessions = nextRecords.map((record) => cloneMissionAgentSessionRecord(record));
				await this.writePersistedAgentSessions(this.agentSessions);
			});

		this.sessionMutationQueue = writeOperation;
		await writeOperation;
	}
}
