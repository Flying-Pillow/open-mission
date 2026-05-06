import { createEntityId, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import {
	MissionAgentEventEmitter,
	type MissionAgentDisposable
} from '../../daemon/runtime/agent/events.js';
import {
	type MissionAgentConsoleEvent,
	type MissionAgentConsoleState,
	type MissionAgentEvent,
	type MissionTerminalSnapshotType,
	type MissionDefaultAgentModeType,
	type MissionReasoningEffortType,
	type MissionCommandAcknowledgementType,
	type MissionDataType,
	type MissionLocatorType,
	type MissionCommandViewSnapshotType,
	type MissionOwnedCommandDescriptorType
} from './MissionSchema.js';
import type {
	MissionAgentLifecycleState,
	AgentSessionLaunchRequest,
	AgentSessionRecord
} from '../AgentSession/AgentSessionSchema.js';
import type {
	AgentCommand,
	AgentPrompt
} from '../../daemon/runtime/agent/AgentRuntimeTypes.js';
import { AgentSession } from '../AgentSession/AgentSession.js';
import { AgentSessionLogWriter } from '../AgentSession/AgentSessionLogWriter.js';
import {
	type MissionTaskUpdate,
	type GateIntent,
	type MissionBrief,
	type MissionDescriptor as MissionDossierDescriptor,
	type MissionGateResult,
	type MissionRecord,
	type MissionSelector,
	type MissionTaskState,
	type MissionType,
	type OperatorStatus
} from './MissionSchema.js';
import { MISSION_STAGES, type MissionStageId } from '../../workflow/mission/manifest.js';
import { MissionDossierFilesystem } from './MissionDossierFilesystem.js';
import { DEFAULT_WORKFLOW_VERSION } from '../../workflow/mission/workflow.js';
import {
	MissionWorkflowController,
	MissionWorkflowRequestExecutor,
	createDraftMissionWorkflowRuntimeState,
	createMissionStateData,
	createMissionWorkflowConfigurationSnapshot,
	type MissionWorkflowConfigurationSnapshot,
	type MissionWorkflowEvent,
	type MissionWorkflowEventRecord,
	type MissionStateData,
	type MissionTaskArtifactReference,
	type WorkflowDefinition
} from '../../workflow/engine/index.js';
import type { AgentRunner } from '../../daemon/runtime/agent/AgentRunner.js';
import type { AgentSessionEvent, AgentSessionSnapshot } from '../../daemon/runtime/agent/AgentRuntimeTypes.js';
import type {
	AgentSessionObservation,
	AgentSessionSignalDecision
} from '../../daemon/runtime/agent/signals/AgentSessionSignal.js';
import { MISSION_ARTIFACT_KEYS, getMissionStageDefinition } from '../../workflow/mission/manifest.js';
import { Artifact } from '../Artifact/Artifact.js';
import { Task, type TaskConfigureOptions } from '../Task/Task.js';
import type { ArtifactDataType } from '../Artifact/ArtifactSchema.js';
import type { TaskDataType } from '../Task/TaskSchema.js';
import { Stage } from '../Stage/Stage.js';
import type { StageDataType } from '../Stage/StageSchema.js';
import {
	MissionCommandAcknowledgementSchema,
	MissionCommandIds,
	MissionCommandInputSchema,
	MissionDataSchema,
	MissionDocumentSnapshotSchema,
	MissionEntityTypeSchema,
	MissionFindSchema,
	MissionCatalogEntrySchema,
	missionEntityName,
	MissionLocatorSchema,
	MissionReadDocumentInputSchema,
	MissionSendTerminalInputSchema,
	MissionSnapshotSchema,
	MissionTerminalSnapshotSchema,
	MissionWorktreeSnapshotSchema,
	MissionWriteDocumentInputSchema,
} from './MissionSchema.js';
import {
	MissionWorkflowEventRecordSchema,
	MissionStateDataSchema
} from '../../workflow/engine/types.js';
import { buildMissionAvailableCommands } from './MissionAvailableCommands.js';
import {
	buildMissionControlViewSnapshot,
	buildMissionSnapshot
} from './MissionControlView.js';
import {
	buildMissionStatusView,
	resolveCurrentMissionStage
} from './MissionStatusView.js';

export type MissionWorkflowBindings = {
	workflow: WorkflowDefinition;
	resolveWorkflow?: () => WorkflowDefinition;
	taskRunners: Map<string, AgentRunner>;
	logger?: {
		info(message: string, metadata?: Record<string, unknown>): void;
	};
	instructionsPath?: string;
	skillsPath?: string;
	defaultModel?: string;
	defaultReasoningEffort?: MissionReasoningEffortType;
	defaultMode?: MissionDefaultAgentModeType;
};

export class Mission extends Entity<MissionDataType, string> {
	public static override readonly entityName = missionEntityName;
	private static readonly SESSION_RECONCILE_TIMEOUT_MS = 1_000;

	public static async find(payload: unknown, context: EntityExecutionContext) {
		const input = MissionFindSchema.parse(payload);
		const repositoryRootPath = input.repositoryRootPath ?? context.surfacePath;
		const store = new MissionDossierFilesystem(repositoryRootPath);
		const missions = await store.listMissions().catch(() => []);

		return MissionCatalogEntrySchema.array().parse(missions.map(({ missionDir, descriptor }) => ({
			missionId: descriptor.missionId,
			title: descriptor.brief.title,
			branchRef: descriptor.branchRef,
			createdAt: descriptor.createdAt,
			repositoryRootPath: store.getMissionWorkspacePath(missionDir),
			...(descriptor.brief.issueId !== undefined ? { issueId: descriptor.brief.issueId } : {})
		})));
	}

	public static async resolve(payload: unknown, context?: EntityExecutionContext): Promise<Mission> {
		if (!context) {
			throw new Error('Mission entity resolution requires a daemon context.');
		}
		const inputRecord = Mission.isRecord(payload) ? payload : {};
		const input = MissionLocatorSchema.parse({
			missionId: inputRecord['missionId'],
			...(typeof inputRecord['repositoryRootPath'] === 'string' ? { repositoryRootPath: inputRecord['repositoryRootPath'] } : {})
		});
		const service = await Mission.loadMissionRegistry(context);
		return await service.loadRequiredMission(input, context) as unknown as Mission;
	}

	public async read(payload: unknown, _context: EntityExecutionContext) {
		const input = MissionLocatorSchema.parse(payload);
		this.assertResolvedMissionId(input.missionId);
		return this.buildMissionSnapshot();
	}

	public async readControlView(payload: unknown, _context: EntityExecutionContext) {
		const input = MissionLocatorSchema.parse(payload);
		this.assertResolvedMissionId(input.missionId);
		return this.buildMissionControlViewSnapshot();
	}

	public async readDocument(payload: unknown, _context: EntityExecutionContext) {
		const input = MissionReadDocumentInputSchema.parse(payload);
		this.assertResolvedMissionId(input.missionId);
		await this.adapter.assertFilePath(input.path, 'read');
		const fileBody = await this.adapter.readFileBody(input.path);
		return MissionDocumentSnapshotSchema.parse({
			filePath: fileBody.filePath,
			content: fileBody.body,
			...(fileBody.updatedAt ? { updatedAt: fileBody.updatedAt } : {})
		});
	}

	public async readWorktree(payload: unknown, _context: EntityExecutionContext) {
		const input = MissionLocatorSchema.parse(payload);
		const missionId = this.assertResolvedMissionId(input.missionId);
		const rootPath = this.adapter.getMissionWorktreePath(missionId);
		return MissionWorktreeSnapshotSchema.parse({
			rootPath,
			fetchedAt: new Date().toISOString(),
			tree: await this.adapter.readDirectoryTree(rootPath, rootPath)
		});
	}

	public async readTerminal(payload: unknown, context: EntityExecutionContext) {
		const input = MissionLocatorSchema.parse(payload);
		const missionId = this.assertResolvedMissionId(input.missionId);
		const { readMissionTerminalState } = await import('../../daemon/MissionTerminal.js');
		const state = await readMissionTerminalState({
			surfacePath: context.surfacePath,
			selector: { missionId }
		});
		if (!state) {
			throw new Error(`Mission terminal for '${missionId}' is not available.`);
		}
		return Mission.parseTerminalSnapshot(missionId, state);
	}

	public async command(payload: unknown, _context: EntityExecutionContext) {
		const input = MissionCommandInputSchema.parse(payload);
		this.assertResolvedMissionId(input.missionId);
		switch (input.commandId) {
			case MissionCommandIds.pause:
				await this.pauseMission();
				break;
			case MissionCommandIds.resume:
				await this.resumeMission();
				break;
			case MissionCommandIds.restartQueue:
				await this.restartLaunchQueue();
				break;
			case MissionCommandIds.deliver:
				await this.deliver();
				break;
			default:
				throw new Error(`Mission command '${input.commandId}' is not implemented in the daemon.`);
		}
		return Mission.buildCommandAcknowledgement(input, 'command');
	}

	public async writeDocument(payload: unknown, _context: EntityExecutionContext) {
		const input = MissionWriteDocumentInputSchema.parse(payload);
		this.assertResolvedMissionId(input.missionId);
		await this.adapter.assertFilePath(input.path, 'write');
		const fileBody = await this.adapter.writeFileBody(input.path, input.content);
		return MissionDocumentSnapshotSchema.parse({
			filePath: fileBody.filePath,
			content: fileBody.body,
			...(fileBody.updatedAt ? { updatedAt: fileBody.updatedAt } : {})
		});
	}

	public async ensureTerminal(payload: unknown, context: EntityExecutionContext) {
		const input = MissionLocatorSchema.parse(payload);
		const missionId = this.assertResolvedMissionId(input.missionId);
		const { ensureMissionTerminalState } = await import('../../daemon/MissionTerminal.js');
		const state = await ensureMissionTerminalState({
			surfacePath: context.surfacePath,
			selector: { missionId }
		});
		if (!state) {
			throw new Error(`Mission terminal for '${missionId}' is not available.`);
		}
		return Mission.parseTerminalSnapshot(missionId, state);
	}

	public async sendTerminalInput(payload: unknown, context: EntityExecutionContext) {
		const input = MissionSendTerminalInputSchema.parse(payload);
		const missionId = this.assertResolvedMissionId(input.missionId);
		const { sendMissionTerminalInput, readMissionTerminalState } = await import('../../daemon/MissionTerminal.js');
		const state = await sendMissionTerminalInput({
			surfacePath: context.surfacePath,
			selector: { missionId },
			terminalInput: {
				...(input.data !== undefined ? { data: input.data } : {}),
				...(input.literal !== undefined ? { literal: input.literal } : {}),
				...(input.cols !== undefined ? { cols: input.cols } : {}),
				...(input.rows !== undefined ? { rows: input.rows } : {})
			}
		});
		if (!state) {
			const fallbackState = await readMissionTerminalState({ surfacePath: context.surfacePath, selector: { missionId } });
			if (!fallbackState) {
				throw new Error(`Mission terminal for '${missionId}' is not available.`);
			}
			return Mission.parseTerminalSnapshot(missionId, fallbackState);
		}
		return Mission.parseTerminalSnapshot(missionId, state);
	}

	private static async loadMissionRegistry(context: EntityExecutionContext) {
		const { requireMissionRegistry } = await import('../../daemon/MissionRegistry.js');
		return requireMissionRegistry(context);
	}

	private static buildCommandAcknowledgement(
		payload: MissionLocatorType,
		method: MissionCommandAcknowledgementType['method'],
		identifiers: {
			taskId?: string;
			sessionId?: string;
			actionId?: string;
		} = {}
	): MissionCommandAcknowledgementType {
		return MissionCommandAcknowledgementSchema.parse({
			ok: true,
			entity: 'Mission',
			method,
			id: payload.missionId,
			missionId: payload.missionId,
			...identifiers
		});
	}

	private static parseTerminalSnapshot(missionId: string, state: MissionTerminalSnapshotType) {
		return MissionTerminalSnapshotSchema.parse({
			missionId,
			connected: state.connected,
			dead: state.dead,
			exitCode: state.dead ? state.exitCode : null,
			screen: state.screen,
			...(state.chunk ? { chunk: state.chunk } : {}),
			...(state.truncated ? { truncated: true } : {}),
			...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
		});
	}

	private readonly agentConsoleEventEmitter = new MissionAgentEventEmitter<MissionAgentConsoleEvent>();
	private readonly agentEventEmitter = new MissionAgentEventEmitter<MissionAgentEvent>();
	private readonly agentRunners = new Map<string, AgentRunner>();
	private readonly consoleStates = new Map<string, MissionAgentConsoleState>();
	private descriptor: MissionDossierDescriptor;
	private sessionRecords: AgentSessionRecord[] = [];
	private lastKnownStatus: OperatorStatus | undefined;
	private lastKnownCommandSnapshot: MissionCommandViewSnapshotType | undefined;
	private readonly workflowRequestExecutor: MissionWorkflowRequestExecutor;
	private readonly workflowController: MissionWorkflowController;
	private readonly workflowResolver: () => WorkflowDefinition;
	private readonly sessionLogWriter: AgentSessionLogWriter;
	private readonly agentSessionEventSubscription: MissionAgentDisposable;
	private agentSessionLifecycleIngestionQueue: Promise<void> = Promise.resolve();
	private workflowEventApplicationQueue: Promise<void> = Promise.resolve();

	public readonly onDidAgentConsoleEvent = this.agentConsoleEventEmitter.event;
	public readonly onDidAgentEvent = this.agentEventEmitter.event;

	public constructor(
		private readonly adapter: MissionDossierFilesystem,
		private readonly missionDir: string,
		descriptor: MissionDossierDescriptor,
		workflowBindings: MissionWorkflowBindings,
		initialData?: MissionDataType
	) {
		super(Mission.cloneData(initialData ?? Mission.createDataFromDescriptor(adapter, missionDir, descriptor)));
		this.descriptor = descriptor;
		this.workflowResolver = workflowBindings.resolveWorkflow ?? (() => workflowBindings.workflow);
		for (const [runnerId, runner] of workflowBindings.taskRunners) {
			this.agentRunners.set(runnerId, runner);
		}
		this.sessionLogWriter = new AgentSessionLogWriter(this.adapter, this.missionDir, this.descriptor.missionId);
		this.workflowRequestExecutor = new MissionWorkflowRequestExecutor({
			adapter: this.adapter,
			runners: workflowBindings.taskRunners,
			...(workflowBindings.instructionsPath
				? { instructionsPath: workflowBindings.instructionsPath }
				: {}),
			...(workflowBindings.skillsPath ? { skillsPath: workflowBindings.skillsPath } : {}),
			...(workflowBindings.defaultModel ? { defaultModel: workflowBindings.defaultModel } : {}),
			...(workflowBindings.defaultReasoningEffort
				? { defaultReasoningEffort: workflowBindings.defaultReasoningEffort }
				: {}),
			...(workflowBindings.defaultMode ? { defaultMode: workflowBindings.defaultMode } : {})
		});
		this.agentSessionEventSubscription = this.workflowRequestExecutor.onDidRuntimeEvent((event) => {
			this.handleAgentSessionRuntimeEvent(event);
			if (event.type === 'session.completed' || event.type === 'session.failed') {
				this.enqueueAgentSessionLifecycleIngestion();
			}
		});
		this.workflowController = new MissionWorkflowController({
			adapter: this.adapter,
			descriptor,
			workflow: workflowBindings.workflow,
			resolveWorkflow: this.workflowResolver,
			requestExecutor: this.workflowRequestExecutor,
			...(workflowBindings.logger ? { logger: workflowBindings.logger } : {})
		});
	}

	public static async create(
		adapter: MissionDossierFilesystem,
		input: {
			brief: MissionBrief;
			branchRef: string;
		},
		workflowBindings: MissionWorkflowBindings
	): Promise<Mission> {
		const existing = await adapter.resolveMission({
			...(input.brief.issueId !== undefined ? { issueId: input.brief.issueId } : {}),
			branchRef: input.branchRef
		});
		if (existing) {
			const mission = new Mission(adapter, existing.missionDir, existing.descriptor, workflowBindings);
			await mission.refresh();
			return mission;
		}

		const missionId = adapter.createMissionId(input.brief);
		const missionDir = adapter.getMissionDir(missionId);
		const missionWorktreePath = adapter.getMissionWorktreePath(missionId);
		const createdAt = new Date().toISOString();
		const branchRef = await adapter.materializeMissionWorktree(missionWorktreePath, input.branchRef);
		const descriptor: MissionDossierDescriptor = {
			missionId,
			missionDir,
			brief: input.brief,
			branchRef,
			createdAt
		};

		const mission = new Mission(adapter, missionDir, descriptor, workflowBindings);
		return mission.initialize();
	}

	public static async load(
		adapter: MissionDossierFilesystem,
		selector: MissionSelector = {},
		workflowBindings: MissionWorkflowBindings
	): Promise<Mission | undefined> {
		const resolved = await adapter.resolveKnownMission(selector);
		if (!resolved) {
			return undefined;
		}

		const mission = new Mission(adapter, resolved.missionDir, resolved.descriptor, workflowBindings);
		await mission.refresh();
		return mission;
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
		this.lastKnownCommandSnapshot = undefined;
		this.lastKnownStatus = await this.buildStatus(document);
		return this;
	}

	public async status(): Promise<OperatorStatus> {
		await this.agentSessionLifecycleIngestionQueue;
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
		this.lastKnownCommandSnapshot = undefined;
		this.lastKnownStatus = await this.buildStatus(document);
		return this.lastKnownStatus;
	}

	public async toEntity(): Promise<Mission> {
		this.data = Mission.createDataFromStatus(await this.status());
		return this;
	}

	public async listAvailableCommands(): Promise<MissionOwnedCommandDescriptorType[]> {
		return (await this.listAvailableCommandSnapshot()).commands;
	}

	public async listAvailableCommandSnapshot(): Promise<MissionCommandViewSnapshotType> {
		await this.agentSessionLifecycleIngestionQueue;
		if (
			this.lastKnownCommandSnapshot
			&& this.lastKnownStatus?.workflow?.lifecycle !== 'draft'
			&& !this.hasActiveAgentSessions()
		) {
			return this.lastKnownCommandSnapshot;
		}

		const document = await this.readLiveWorkflowDocument({
			reconcileSessions: this.hasActiveAgentSessions()
		});
		this.syncAgentSessions(document);
		this.lastKnownStatus = await this.buildStatus(document);
		const snapshot = {
			commands: await this.buildCommandList(document),
			revision: this.buildCommandRevision(document)
		};
		this.lastKnownCommandSnapshot = snapshot;
		return snapshot;
	}

	public async buildMissionSnapshot() {
		const missionId = this.descriptor.missionId;
		const entity = await this.toEntity();
		const commandView = await this.listAvailableCommandSnapshot();
		return buildMissionSnapshot({
			missionId,
			mission: MissionSnapshotSchema.shape.mission.parse(entity.toData()),
			commandView
		});
	}

	public async buildMissionControlViewSnapshot() {
		const snapshot = await this.buildMissionSnapshot();
		return buildMissionControlViewSnapshot({
			snapshot
		});
	}

	private assertResolvedMissionId(missionId: string): string {
		if (missionId !== this.descriptor.missionId) {
			throw new Error(
				`Mission payload '${missionId}' does not match resolved Mission instance '${this.descriptor.missionId}'.`
			);
		}

		return this.descriptor.missionId;
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

	public getAgentSessions(): AgentSessionRecord[] {
		return this.sessionRecords.map((record) => AgentSession.cloneRecord(record));
	}

	public getAgentSession(sessionId: string): AgentSessionRecord | undefined {
		const record = this.sessionRecords.find((candidate) => candidate.sessionId === sessionId);
		return record ? AgentSession.cloneRecord(record) : undefined;
	}

	public getAgentSessionByTerminalSessionName(
		terminalSessionName: string,
	): AgentSessionRecord | undefined {
		const record = this.sessionRecords.find(
			(candidate) => candidate.terminalHandle?.sessionName === terminalSessionName,
		);
		return record ? AgentSession.cloneRecord(record) : undefined;
	}

	public getAgentConsoleState(sessionId: string): MissionAgentConsoleState | undefined {
		const state = this.consoleStates.get(sessionId);
		return state ? Mission.cloneAgentConsoleState(state) : undefined;
	}

	public async launchAgentSession(
		request: AgentSessionLaunchRequest
	): Promise<AgentSessionRecord> {
		if (!request.taskId) {
			throw new Error('Mission task sessions require an explicit taskId.');
		}

		await this.status();

		const existingSession = this.sessionRecords.find(
			(candidate) => candidate.taskId === request.taskId && Mission.isActiveAgentSession(candidate.lifecycleState)
		);
		if (existingSession) {
			if (!(await AgentSession.isCompatibleForLaunch({
				session: existingSession,
				request,
				resolveLiveSession: () => this.resolveLiveAgentSession(existingSession)
			}))) {
				await this.terminateAgentSession(existingSession.sessionId, 'replaced stale task session before relaunch');
				await this.status();
			} else {
				return AgentSession.cloneRecord(existingSession);
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
	): Promise<AgentSessionRecord> {
		const session = this.requireAgentSession(sessionId);
		return (await session.cancel(reason)).toRecord();
	}

	public async sendAgentSessionPrompt(
		sessionId: string,
		prompt: AgentPrompt
	): Promise<AgentSessionRecord> {
		const session = this.requireAgentSession(sessionId);
		return (await session.sendPrompt(prompt)).toRecord();
	}

	public async sendAgentSessionCommand(
		sessionId: string,
		command: AgentCommand
	): Promise<AgentSessionRecord> {
		const session = this.requireAgentSession(sessionId);
		return (await session.sendCommand(command)).toRecord();
	}

	public async completeAgentSession(
		sessionId: string
	): Promise<AgentSessionRecord> {
		const session = this.requireAgentSession(sessionId);
		return (await session.done()).toRecord();
	}

	public async terminateAgentSession(
		sessionId: string,
		reason?: string
	): Promise<AgentSessionRecord> {
		const session = this.requireAgentSession(sessionId);
		return (await session.terminate(reason)).toRecord();
	}

	public dispose(): void {
		this.consoleStates.clear();
		this.agentSessionEventSubscription.dispose();
		this.sessionLogWriter.dispose();
		this.workflowRequestExecutor.dispose();
		this.agentConsoleEventEmitter.dispose();
		this.agentEventEmitter.dispose();
	}

	public getRuntimeSessionSnapshot(sessionId: string): AgentSessionSnapshot | undefined {
		return this.workflowController.getRuntimeSession(sessionId);
	}

	public applyRuntimeSessionSignalDecision(
		sessionId: string,
		_observation: AgentSessionObservation,
		decision: Exclude<AgentSessionSignalDecision, { action: 'reject' }>
	): AgentSessionSnapshot | undefined {
		return this.workflowController.applyRuntimeSessionSignalDecision(sessionId, decision);
	}

	private async resolveLiveAgentSession(session: AgentSessionRecord): Promise<AgentSessionSnapshot | undefined> {
		return this.workflowController.getRuntimeSession(session.sessionId)
			?? await this.workflowController.attachRuntimeSession({
				runnerId: session.runnerId,
				sessionId: session.sessionId,
				...(session.transportId === 'terminal' || session.terminalHandle
					? {
						transport: {
							kind: 'terminal',
							terminalSessionName: session.terminalHandle?.sessionName ?? session.sessionId,
							...(session.terminalHandle?.paneId ? { paneId: session.terminalHandle.paneId } : {})
						}
					}
					: {})
			});
	}

	public async evaluateGate(intent: GateIntent): Promise<MissionGateResult> {
		const status = await this.status();
		const errors: string[] = [];
		const warnings: string[] = [];
		const currentBranch = this.adapter.getCurrentBranch(this.adapter.getMissionWorkspacePath(this.missionDir));
		const gateIntent = intent === 'commit' ? 'implement' : intent;
		const gate = status.workflow?.gates.find((candidate: { intent: GateIntent }) => candidate.intent === gateIntent);

		if (Stage.isMissionDelivered(status.stages ?? [])) {
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

	public async restartLaunchQueue(): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('mission.launch-queue.restarted', {}));
		await this.status();
	}

	public async startTask(taskId: string, options: { agentRunner?: string; model?: string; reasoningEffort?: string; terminalSessionName?: string } = {}): Promise<void> {
		await (await this.requireTask(taskId)).startFromMissionControl({
			missionWorkspacePath: this.adapter.getMissionWorkspacePath(this.missionDir),
			runners: this.agentRunners,
			...(options.agentRunner?.trim() ? { runnerId: options.agentRunner.trim() } : {}),
			...(options.model?.trim() ? { model: options.model.trim() } : {}),
			...(options.reasoningEffort?.trim() ? { reasoningEffort: options.reasoningEffort.trim() } : {}),
			...(options.terminalSessionName?.trim() ? { terminalSessionName: options.terminalSessionName.trim() } : {})
		});
	}

	public async configureTask(taskId: string, input: TaskConfigureOptions): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.configured', {
			taskId,
			...(input.agentRunner?.trim() ? { agentRunner: input.agentRunner.trim() } : {}),
			...(Object.prototype.hasOwnProperty.call(input, 'model') ? { model: input.model?.trim() || null } : {}),
			...(Object.prototype.hasOwnProperty.call(input, 'reasoningEffort') ? { reasoningEffort: input.reasoningEffort ?? null } : {}),
			...(typeof input.autostart === 'boolean' ? { autostart: input.autostart } : {}),
			...(input.context ? { context: input.context.map((contextArtifact) => ({ ...contextArtifact })) } : {})
		}));
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
		const eligibleStageId = resolveCurrentMissionStage(document);
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

	private async buildStatus(document?: MissionStateData): Promise<OperatorStatus> {
		const persistedDocument = document ?? await this.workflowController.getPersistedDocument();
		return buildMissionStatusView({
			adapter: this.adapter,
			missionDir: this.missionDir,
			descriptor: this.descriptor,
			workflow: this.workflowResolver(),
			...(persistedDocument ? { document: persistedDocument } : {}),
			sessions: this.getAgentSessions(),
			hydrateRuntimeTasksForActions: (tasks) => this.hydrateRuntimeTasksForActions(tasks)
		});
	}

	private async buildCommandList(document?: MissionStateData): Promise<MissionOwnedCommandDescriptorType[]> {
		if (!document) {
			const workflow = this.workflowResolver();
			const configuration = createMissionWorkflowConfigurationSnapshot({
				createdAt: this.descriptor.createdAt,
				workflowVersion: DEFAULT_WORKFLOW_VERSION,
				workflow
			});
			const runtime = createDraftMissionWorkflowRuntimeState(configuration, this.descriptor.createdAt);
			return this.buildAvailableCommands(configuration, runtime, []);
		}

		return this.buildAvailableCommands(
			document.configuration,
			document.runtime,
			this.getAgentSessions()
		);
	}

	private buildCommandRevision(document?: MissionStateData): string {
		const runtimeUpdatedAt = document?.runtime.updatedAt?.trim();
		if (runtimeUpdatedAt) {
			return `mission:${this.descriptor.missionId}:${runtimeUpdatedAt}`;
		}
		return `mission:${this.descriptor.missionId}:${this.descriptor.createdAt}`;
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

	private async buildAvailableCommands(
		configuration: MissionStateData['configuration'],
		runtime: MissionStateData['runtime'],
		sessions: AgentSessionRecord[]
	): Promise<MissionOwnedCommandDescriptorType[]> {
		const runtimeTasksForActions = await this.hydrateRuntimeTasksForActions(runtime.tasks);
		return buildMissionAvailableCommands({
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
		tasks: MissionStateData['runtime']['tasks']
	): Promise<MissionStateData['runtime']['tasks']> {
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

	private async requireTask(taskId: string): Promise<Task> {
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

	private async startTaskAgentSession(
		task: MissionTaskState,
		runner: AgentRunner,
		request: AgentSessionLaunchRequest
	): Promise<AgentSessionSnapshot> {
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
				text: request.prompt,
				...(request.title ? { title: request.title } : task.subject ? { title: task.subject } : {})
			},
			...(request.terminalSessionName?.trim()
				? { metadata: { terminalSessionName: request.terminalSessionName.trim() } }
				: {})
		});
	}

	private async recordStartedTaskSession(snapshot: AgentSessionSnapshot): Promise<AgentSession> {
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
			...(snapshot.transport?.kind === 'terminal'
				? {
					terminalHandle: {
						sessionName: snapshot.transport.terminalSessionName,
						paneId: snapshot.transport.paneId ?? snapshot.transport.terminalSessionName
					}
				}
				: {})
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

	private requireAgentSessionRecord(sessionId: string): AgentSessionRecord {
		const record = this.sessionRecords.find((candidate) => candidate.sessionId === sessionId);
		if (!record) {
			throw new Error(`Mission agent session '${sessionId}' is not recorded in mission state.`);
		}
		return AgentSession.cloneRecord(record);
	}

	private requireAgentSession(sessionId: string): AgentSession {
		return this.createSession(this.requireAgentSessionRecord(sessionId));
	}

	private async cancelSessionRecord(
		sessionId: string,
		reason?: string
	): Promise<AgentSessionRecord> {
		const record = this.requireAgentSessionRecord(sessionId);
		await this.ensureAgentSessionAttached(sessionId);
		const document = await this.workflowController.cancelRuntimeSession(sessionId, reason, record.taskId);
		await this.ensureSessionLifecycleRecorded(document, record, 'cancelled');
		await this.refresh();
		return this.requireAgentSessionRecord(sessionId);
	}

	private async sendSessionPrompt(
		sessionId: string,
		prompt: AgentPrompt
	): Promise<AgentSessionRecord> {
		await this.ensureAgentSessionAttached(sessionId);
		await this.workflowController.promptRuntimeSession(sessionId, prompt);
		await this.refresh();
		return this.requireAgentSessionRecord(sessionId);
	}

	private async sendSessionCommand(
		sessionId: string,
		command: AgentCommand
	): Promise<AgentSessionRecord> {
		await this.ensureAgentSessionAttached(sessionId);
		await this.workflowController.commandRuntimeSession(sessionId, command);
		await this.refresh();
		return this.requireAgentSessionRecord(sessionId);
	}

	private async completeSessionRecord(
		sessionId: string
	): Promise<AgentSessionRecord> {
		const record = this.requireAgentSessionRecord(sessionId);
		await this.ensureAgentSessionAttached(sessionId);
		await this.workflowController.completeRuntimeSession(sessionId, record.taskId);
		await this.refresh();
		return this.requireAgentSessionRecord(sessionId);
	}

	private async terminateSessionRecord(
		sessionId: string,
		reason?: string
	): Promise<AgentSessionRecord> {
		const record = this.requireAgentSessionRecord(sessionId);
		await this.ensureAgentSessionAttached(sessionId);
		const document = await this.workflowController.terminateRuntimeSession(sessionId, reason, record.taskId);
		await this.ensureSessionLifecycleRecorded(document, record, 'terminated');
		await this.refresh();
		return this.requireAgentSessionRecord(sessionId);
	}

	private async ensureSessionLifecycleRecorded(
		document: MissionStateData,
		record: AgentSessionRecord,
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
				AgentSession.lifecycleEventType(lifecycle),
				{
					sessionId: record.sessionId,
					taskId: record.taskId,
				},
			),
		);
	}

	private createTask(task: MissionTaskState): Task {
		return new Task({
			missionId: this.descriptor.missionId,
			isMissionDelivered: () => Stage.isMissionDelivered(this.lastKnownStatus?.stages ?? []),
			refreshTaskState: (taskId) => this.requireTaskState(taskId),
			configureTask: (taskId, input) => this.configureTask(taskId, input),
			queueTask: (taskId, options) => this.queueTask(taskId, options),
			completeTask: (taskId) => this.completeTaskExecution(taskId),
			reopenTask: (taskId) => this.reopenTaskExecution(taskId),
			reworkTask: (taskId, input) => this.reworkTaskExecution(taskId, input),
			updateTaskLaunchPolicy: (taskId, launchPolicy) =>
				this.updateTaskLaunchPolicy(taskId, launchPolicy),
			requireAgentRunner: (runnerId) => this.requireAgentRunner(runnerId),
			startTaskAgentSession: (taskState, runner, request) =>
				this.startTaskAgentSession(taskState, runner, request),
			recordStartedTaskSession: (snapshot) => this.recordStartedTaskSession(snapshot),
			recordTaskSessionLaunchFailure: (taskId, error) =>
				this.recordTaskSessionLaunchFailure(taskId, error)
		}, task);
	}

	private createSession(record: AgentSessionRecord): AgentSession {
		return new AgentSession({
			completeSessionRecord: (sessionId) => this.completeSessionRecord(sessionId),
			sendSessionPrompt: (sessionId, prompt) => this.sendSessionPrompt(sessionId, prompt),
			sendSessionCommand: (sessionId, command) => this.sendSessionCommand(sessionId, command),
			cancelSessionRecord: (sessionId, reason) => this.cancelSessionRecord(sessionId, reason),
			terminateSessionRecord: (sessionId, reason) => this.terminateSessionRecord(sessionId, reason)
		}, record);
	}

	private async ensureAgentSessionAttached(sessionId: string): Promise<void> {
		if (this.workflowController.getRuntimeSession(sessionId)) {
			return;
		}
		const record = this.requireAgentSessionRecord(sessionId);
		await this.workflowController.attachRuntimeSession({
			runnerId: record.runnerId,
			sessionId: record.sessionId,
			...(record.transportId === 'terminal' || record.terminalHandle
				? {
					transport: {
						kind: 'terminal',
						terminalSessionName: record.terminalHandle?.sessionName ?? record.sessionId,
						...(record.terminalHandle?.paneId ? { paneId: record.terminalHandle.paneId } : {})
					}
				}
				: {})
		});
	}

	private syncAgentSessions(document: MissionStateData | undefined): void {
		if (!document) {
			this.sessionRecords = [];
			this.consoleStates.clear();
			return;
		}
		const agentSessionSnapshots = new Map(
			this.workflowController.listRuntimeSessions().map((snapshot) => [snapshot.sessionId, snapshot] as const)
		);
		const tasksById = new Map(
			document.runtime.tasks.map((task, index) => [
				task.taskId,
				Task.fromWorkflowState({
					task,
					index,
					missionDir: this.missionDir
				})
			] as const)
		);

		this.sessionRecords = document.runtime.sessions.map((session) => {
			const runtimeSnapshot = agentSessionSnapshots.get(session.sessionId);
			const task = tasksById.get(session.taskId);
			return AgentSession.createRecordFromLaunch({
				launch: session,
				runnerLabel: this.agentRunners.get(session.runnerId)?.displayName ?? session.runnerId,
				...(runtimeSnapshot ? { snapshot: runtimeSnapshot } : {}),
				...(task ? { task } : {}),
				missionId: this.descriptor.missionId,
				missionDir: this.adapter.getMissionWorkspacePath(this.missionDir)
			});
		});
		this.sessionLogWriter.reconcile(this.sessionRecords);

		const activeSessionIds = new Set(this.sessionRecords.map((session) => session.sessionId));
		for (const record of this.sessionRecords) {
			if (!this.consoleStates.has(record.sessionId)) {
				this.consoleStates.set(record.sessionId, Mission.createEmptyAgentConsoleState({
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
			: AgentSession.createStateFromSnapshot({
				snapshot,
				runnerLabel: this.agentRunners.get(snapshot.runnerId)?.displayName ?? snapshot.runnerId
			});
		this.agentEventEmitter.fire({
			type: 'session-started',
			state
		});
	}

	private handleAgentSessionRuntimeEvent(event: AgentSessionEvent): void {
		const session = this.getAgentSession(event.snapshot.sessionId);
		const state = session
			? this.createSession(session).toState(event.snapshot)
			: AgentSession.createStateFromSnapshot({
				snapshot: event.snapshot,
				runnerLabel:
					this.agentRunners.get(event.snapshot.runnerId)?.displayName ?? event.snapshot.runnerId
			});
		const currentConsole = this.consoleStates.get(event.snapshot.sessionId) ?? Mission.createEmptyAgentConsoleState({
			awaitingInput: state.lifecycleState === 'awaiting-input',
			runnerId: state.runnerId,
			runnerLabel: state.runnerLabel,
			sessionId: state.sessionId,
			...(state.currentTurnTitle ? { title: state.currentTurnTitle } : {})
		});
		if (session) {
			this.sessionLogWriter.update(session);
		}

		switch (event.type) {
			case 'session.started':
			case 'session.attached':
			case 'session.updated': {
				const nextState = Mission.cloneAgentConsoleState({
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
				const nextState = Mission.cloneAgentConsoleState({
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
				const nextState = Mission.cloneAgentConsoleState({
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

	private enqueueAgentSessionLifecycleIngestion(): void {
		this.agentSessionLifecycleIngestionQueue = this.agentSessionLifecycleIngestionQueue
			.then(async () => {
				await this.ingestAgentSessionLifecycleEvents();
			})
			.catch(() => undefined);
	}

	private async ingestAgentSessionLifecycleEvents(): Promise<void> {
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
	): Promise<MissionStateData | undefined> {
		const currentDocument = await this.workflowController.getPersistedDocument();
		if (!currentDocument) {
			return undefined;
		}
		if (!options.reconcileSessions) {
			return currentDocument;
		}
		try {
			return await Mission.promiseWithTimeout(
				this.workflowController.reconcileSessions(),
				Mission.SESSION_RECONCILE_TIMEOUT_MS
			);
		} catch {
			return currentDocument;
		}
	}

	private hasActiveAgentSessions(): boolean {
		return this.sessionRecords.some((session) => Mission.isActiveAgentSession(session.lifecycleState));
	}

	private invalidateCachedMissionSnapshots(): void {
		this.lastKnownStatus = undefined;
		this.lastKnownCommandSnapshot = undefined;
	}

	private async queueTask(taskId: string, options: { runnerId?: string; prompt?: string; workingDirectory?: string; model?: string; reasoningEffort?: string; terminalSessionName?: string } = {}): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.queued', {
			taskId,
			...(options.runnerId?.trim() ? { runnerId: options.runnerId.trim() } : {}),
			...(options.prompt?.trim() ? { prompt: options.prompt.trim() } : {}),
			...(options.workingDirectory?.trim() ? { workingDirectory: options.workingDirectory.trim() } : {}),
			...(options.model?.trim() ? { model: options.model.trim() } : {}),
			...(options.reasoningEffort?.trim() ? { reasoningEffort: options.reasoningEffort.trim() } : {}),
			...(options.terminalSessionName?.trim() ? { terminalSessionName: options.terminalSessionName.trim() } : {})
		}));
	}

	private async completeTaskExecution(taskId: string): Promise<void> {
		const activeSessions = this.sessionRecords.filter(
			(candidate) => candidate.taskId === taskId && Mission.isActiveAgentSession(candidate.lifecycleState)
		);
		for (const session of activeSessions) {
			await this.ensureAgentSessionAttached(session.sessionId);
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
		artifactRefs?: MissionTaskArtifactReference[];
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
		const sourceTask = await this.requireTaskState(sourceTaskId);
		const verificationArtifact = await this.adapter.readArtifactRecord(this.missionDir, 'verify');
		return Task.buildVerificationReworkRequest({
			sourceTaskId,
			sourceWorkflowTask,
			workflowTasks: status.workflow?.tasks ?? [],
			sourceTask,
			...(verificationArtifact ? { verificationArtifact } : {})
		});
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

	public static async readStateData(
		adapter: MissionDossierFilesystem,
		missionDir: string
	): Promise<MissionStateData | undefined> {
		const rawData = await adapter.readMissionStateDataFile(missionDir);
		return rawData === undefined ? undefined : MissionStateDataSchema.parse(rawData);
	}

	public static async writeStateData(
		adapter: MissionDossierFilesystem,
		missionDir: string,
		data: MissionStateData
	): Promise<void> {
		await adapter.writeMissionStateDataFile(missionDir, MissionStateDataSchema.parse(data));
	}

	public static async appendEventRecord(
		adapter: MissionDossierFilesystem,
		missionDir: string,
		eventRecord: MissionWorkflowEventRecord
	): Promise<void> {
		await adapter.appendMissionEventRecordFile(
			missionDir,
			Mission.parseEventRecord(eventRecord)
		);
	}

	public static async readEventLog(
		adapter: MissionDossierFilesystem,
		missionDir: string
	): Promise<MissionWorkflowEventRecord[]> {
		return MissionWorkflowEventRecordSchema.array()
			.parse(await adapter.readMissionEventLogFile(missionDir))
			.map(Mission.parseEventRecord);
	}

	public static async initializeStateData(input: {
		adapter: MissionDossierFilesystem;
		missionDir: string;
		missionId: string;
		configuration: MissionWorkflowConfigurationSnapshot;
		createdAt?: string;
	}): Promise<MissionStateData> {
		const data = createMissionStateData({
			missionId: input.missionId,
			configuration: input.configuration,
			...(input.createdAt ? { createdAt: input.createdAt } : {})
		});
		await Mission.writeStateData(input.adapter, input.missionDir, data);
		return data;
	}

	public get id(): string {
		return this.data.id;
	}

	public get missionId(): string {
		return this.data.missionId;
	}

	public get title(): string | undefined {
		return this.data.title;
	}

	public get issueId(): number | undefined {
		return this.data.issueId;
	}

	public get type(): MissionType | undefined {
		return this.data.type;
	}

	public get operationalMode(): string | undefined {
		return this.data.operationalMode;
	}

	public get branchRef(): string | undefined {
		return this.data.branchRef;
	}

	public get missionRootDir(): string | undefined {
		return this.data.missionRootDir;
	}

	public get lifecycle(): MissionDataType['lifecycle'] {
		return this.data.lifecycle;
	}

	public get updatedAt(): string | undefined {
		return this.data.updatedAt;
	}

	public get currentStageId(): MissionDataType['currentStageId'] {
		return this.data.currentStageId;
	}

	public get artifacts(): MissionDataType['artifacts'] {
		return this.data.artifacts.map((artifact) => structuredClone(artifact));
	}

	public get stages(): MissionDataType['stages'] {
		return this.data.stages.map((stage) => structuredClone(stage));
	}

	public get agentSessions(): MissionDataType['agentSessions'] {
		return this.data.agentSessions.map((session) => structuredClone(session));
	}

	public get recommendedAction(): string | undefined {
		return this.data.recommendedAction;
	}

	public findStage(stageId: MissionStageId): MissionDataType['stages'][number] | undefined {
		const stage = this.data.stages.find((candidate) => candidate.stageId === stageId);
		return stage ? structuredClone(stage) : undefined;
	}

	public findArtifact(id: string): MissionDataType['artifacts'][number] | undefined {
		const artifact = this.data.artifacts.find((candidate) => candidate.id === id);
		return artifact ? structuredClone(artifact) : undefined;
	}

	public findTask(taskId: string): MissionDataType['stages'][number]['tasks'][number] | undefined {
		for (const stage of this.data.stages) {
			const task = stage.tasks.find((candidate) => candidate.taskId === taskId);
			if (task) {
				return structuredClone(task);
			}
		}
		return undefined;
	}

	public hasStage(stageId: MissionStageId): boolean {
		return this.data.stages.some((candidate) => candidate.stageId === stageId);
	}

	public isStageCurrent(stageId: MissionStageId): boolean {
		return this.currentStageId === stageId;
	}

	private static createDataFromStatus(status: OperatorStatus): MissionDataType {
		const missionId = status.missionId?.trim();
		if (!missionId) {
			throw new Error('Mission entity construction requires an OperatorStatus with missionId.');
		}

		const missionRootDir = Mission.requireTrimmedString(status.missionRootDir, 'Mission status missionRootDir');
		const productFiles = status.productFiles ?? {};
		const currentStageId = Mission.requireTrimmedString(status.workflow?.currentStageId, 'Mission status workflow.currentStageId') as MissionStageId;
		const artifacts: ArtifactDataType[] = [];

		for (const artifactKey of MISSION_ARTIFACT_KEYS) {
			const filePath = productFiles[artifactKey];
			if (!filePath) {
				continue;
			}

			artifacts.push(Artifact.createMissionArtifact({
				missionId,
				artifactKey,
				filePath,
				...(missionRootDir ? { missionRootDir } : {})
			}));
		}

		const stages: StageDataType[] = Mission.requireArray(status.stages, 'Mission status stages').map((stage) => {
			const stageArtifacts = getMissionStageDefinition(stage.stage).artifacts
				.map((artifactKey) => productFiles[artifactKey]
					? Artifact.createMissionArtifact({
						missionId,
						artifactKey,
						filePath: productFiles[artifactKey],
						stageId: stage.stage,
						...(missionRootDir ? { missionRootDir } : {})
					})
					: undefined)
				.filter((artifact): artifact is ArtifactDataType => artifact !== undefined);
			const tasks: TaskDataType[] = stage.tasks.map((task) => {
				const entity = Task.toDataFromState(task, missionId);
				if (task.filePath) {
					artifacts.push(Artifact.createTaskArtifact({
						missionId,
						taskId: task.taskId,
						stageId: task.stage,
						fileName: task.fileName,
						filePath: task.filePath,
						relativePath: task.relativePath
					}));
				}
				return entity;
			});
			return Stage.create({
				id: Stage.createEntityId(missionId, stage.stage),
				stageId: stage.stage,
				lifecycle: stage.status,
				isCurrentStage: currentStageId === stage.stage,
				artifacts: stageArtifacts,
				tasks
			});
		});

		return MissionDataSchema.parse({
			id: createEntityId('mission', missionId),
			missionId,
			title: Mission.requireTrimmedString(status.title, 'Mission status title'),
			...(status.issueId !== undefined ? { issueId: status.issueId } : {}),
			type: Mission.parseEntityTypeFromStatus(status.type),
			...(status.operationalMode ? { operationalMode: status.operationalMode } : {}),
			branchRef: Mission.requireTrimmedString(status.branchRef, 'Mission status branchRef'),
			missionDir: Mission.requireTrimmedString(status.missionDir, 'Mission status missionDir'),
			missionRootDir: Mission.requireTrimmedString(status.missionRootDir, 'Mission status missionRootDir'),
			...(status.workflow?.lifecycle ? { lifecycle: status.workflow.lifecycle } : {}),
			...(status.workflow?.updatedAt ? { updatedAt: status.workflow.updatedAt } : {}),
			...(currentStageId ? { currentStageId } : {}),
			artifacts,
			stages,
			agentSessions: Mission.requireArray(status.agentSessions, 'Mission status agentSessions').map((session) => AgentSession.toDataFromRecord(session)),
			...(status.recommendedAction ? { recommendedAction: status.recommendedAction } : {})
		});
	}

	private static cloneData(data: MissionDataType): MissionDataType {
		return MissionDataSchema.parse({
			...data,
			artifacts: data.artifacts.map((artifact) => structuredClone(artifact)),
			stages: data.stages.map((stage) => structuredClone(stage)),
			agentSessions: data.agentSessions.map((session) => structuredClone(session))
		});
	}

	private static createDataFromDescriptor(
		adapter: MissionDossierFilesystem,
		missionDir: string,
		descriptor: MissionDossierDescriptor
	): MissionDataType {
		return MissionDataSchema.parse({
			id: createEntityId('mission', descriptor.missionId),
			missionId: descriptor.missionId,
			title: descriptor.brief.title,
			...(descriptor.brief.issueId !== undefined ? { issueId: descriptor.brief.issueId } : {}),
			type: descriptor.brief.type,
			branchRef: descriptor.branchRef,
			missionDir: adapter.getMissionWorkspacePath(missionDir),
			missionRootDir: missionDir,
			artifacts: [],
			stages: [],
			agentSessions: []
		});
	}

	private static parseEventRecord(value: unknown): MissionWorkflowEventRecord {
		const parsed = MissionWorkflowEventRecordSchema.parse(value);
		return {
			eventId: parsed.eventId,
			type: parsed.type,
			occurredAt: parsed.occurredAt,
			source: parsed.source,
			...(parsed.causedByRequestId ? { causedByRequestId: parsed.causedByRequestId } : {}),
			payload: parsed.payload
		};
	}

	private static cloneAgentConsoleState(
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

	private static createEmptyAgentConsoleState(
		overrides: Partial<MissionAgentConsoleState> = {}
	): MissionAgentConsoleState {
		return {
			...Mission.cloneAgentConsoleState({
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

	private static promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
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

	private static isActiveAgentSession(lifecycleState: MissionAgentLifecycleState): boolean {
		return lifecycleState === 'starting'
			|| lifecycleState === 'running'
			|| lifecycleState === 'awaiting-input';
	}

	private static isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	private static requireTrimmedString(value: string | undefined, fieldName: string): string {
		const normalized = value?.trim();
		if (!normalized) {
			throw new Error(`${fieldName} is required.`);
		}
		return normalized;
	}

	private static requireArray<T>(value: T[] | undefined, fieldName: string): T[] {
		if (!value) {
			throw new Error(`${fieldName} is required.`);
		}
		return value;
	}

	private static parseEntityTypeFromStatus(value: MissionType | undefined): MissionType {
		return MissionEntityTypeSchema.parse(value);
	}
}
