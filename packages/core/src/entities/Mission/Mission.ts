import * as path from 'node:path';
import { Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import {
	MissionAgentEventEmitter,
	type MissionAgentDisposable
} from '../../daemon/runtime/agent/events.js';
import {
	type MissionAgentConsoleEvent,
	type MissionAgentConsoleState,
	type MissionAgentEvent,
	type MissionAgentLifecycleState,
	type MissionAgentTerminalState,
	type AgentSessionLaunchRequest,
	type AgentSessionRecord
} from '../../daemon/protocol/contracts.js';
import type {
	AgentCommand,
	AgentPrompt
} from '../../daemon/runtime/agent/AgentRuntimeTypes.js';
import type { MissionDefaultAgentMode } from '../Repository/RepositorySchema.js';
import { Repository } from '../Repository/Repository.js';
import { AgentSession } from '../AgentSession/AgentSession.js';
import { AgentSessionLogWriter } from '../AgentSession/AgentSessionLogWriter.js';
import {
	MISSION_STAGES,
	type MissionTaskUpdate,
	type GateIntent,
	type MissionBrief,
	type MissionDescriptor as MissionDossierDescriptor,
	type MissionGateResult,
	type MissionRecord,
	type MissionSelector,
	type MissionStageId,
	type MissionTaskState,
	type MissionType,
	type OperatorStatus
} from '../../types.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
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
import { getMissionWorkflowEventValidationErrors } from '../../workflow/engine/validation.js';
import type { AgentRunner } from '../../daemon/runtime/agent/AgentRunner.js';
import type { AgentSessionEvent, AgentSessionSnapshot } from '../../daemon/runtime/agent/AgentRuntimeTypes.js';
import { toAgentSession } from '../AgentSession/AgentSession.js';
import { MISSION_ARTIFACT_KEYS, getMissionStageDefinition } from '../../workflow/mission/manifest.js';
import {
	createMissionArtifact,
	createTaskArtifact
} from '../Artifact/Artifact.js';
import { Task, toTask } from '../Task/Task.js';
import type { ArtifactDataType } from '../Artifact/ArtifactSchema.js';
import type { TaskDataType } from '../Task/TaskSchema.js';
import { TaskCommandIds } from '../Task/TaskSchema.js';
import {
	createStage,
	isMissionDelivered,
} from '../Stage/Stage.js';
import type { StageDataType } from '../Stage/StageSchema.js';
import { StageCommandIds } from '../Stage/StageSchema.js';
import { AgentSessionCommandIds } from '../AgentSession/AgentSessionSchema.js';
import {
	MissionAgentSessionCommandInputSchema,
	MissionCommandAcknowledgementSchema,
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
	MissionTaskCommandInputSchema,
	MissionTerminalSnapshotSchema,
	MissionWorktreeSnapshotSchema,
	MissionWriteDocumentInputSchema,
	type MissionCommandAcknowledgementType,
	type MissionDataType,
	type MissionLocatorType
} from './MissionSchema.js';
import {
	MissionWorkflowEventRecordSchema,
	MissionStateDataSchema
} from '../../workflow/engine/types.js';
import {
	MissionCommandIds,
	missionCommand,
	ownedAgentSessionCommand,
	ownedMissionCommand,
	ownedStageCommand,
	ownedTaskCommand,
	type MissionAvailableCommandSnapshot,
	type MissionOwnedCommandDescriptor
} from './MissionCommandDescriptors.js';
import {
	buildMissionProjectionSnapshot,
	buildMissionSnapshot
} from './MissionProjection.js';
import {
	buildMissionStatusProjection,
	resolveCurrentMissionStage
} from './MissionStatusProjection.js';

export type MissionWorkflowBindings = {
	workflow: WorkflowDefinition;
	resolveWorkflow?: () => WorkflowDefinition;
	taskRunners: Map<string, AgentRunner>;
	instructionsPath?: string;
	skillsPath?: string;
	defaultModel?: string;
	defaultMode?: MissionDefaultAgentMode;
};

export class Mission extends Entity<MissionDataType, string> {
	public static override readonly entityName = missionEntityName;
	private static readonly SESSION_RECONCILE_TIMEOUT_MS = 1_000;

	public static async find(payload: unknown, context: EntityExecutionContext) {
		const input = MissionFindSchema.parse(payload);
		const repositoryRootPath = input.repositoryRootPath ?? context.surfacePath;
		const store = new FilesystemAdapter(repositoryRootPath);
		const missions = await store.listMissions().catch(() => []);

		return MissionCatalogEntrySchema.array().parse(missions.map(({ descriptor }) => ({
			missionId: descriptor.missionId,
			title: descriptor.brief.title,
			branchRef: descriptor.branchRef,
			createdAt: descriptor.createdAt,
			...(descriptor.brief.issueId !== undefined ? { issueId: descriptor.brief.issueId } : {})
		})));
	}

	public static async resolve(payload: unknown, context?: EntityExecutionContext): Promise<Mission> {
		if (!context) {
			throw new Error('Mission entity resolution requires a daemon context.');
		}
		const inputRecord = isRecord(payload) ? payload : {};
		const input = MissionLocatorSchema.parse({
			missionId: inputRecord['missionId'],
			...(typeof inputRecord['repositoryRootPath'] === 'string' ? { repositoryRootPath: inputRecord['repositoryRootPath'] } : {})
		});
		const service = await Mission.loadMissionRegistry(context);
		return await service.loadRequiredMission(input, context) as Mission;
	}

	public async read(payload: unknown, _context: EntityExecutionContext) {
		const input = MissionLocatorSchema.parse(payload);
		this.assertResolvedMissionId(input.missionId);
		return this.buildMissionSnapshot();
	}

	public async readProjection(payload: unknown, _context: EntityExecutionContext) {
		const input = MissionLocatorSchema.parse(payload);
		this.assertResolvedMissionId(input.missionId);
		return this.buildMissionProjectionSnapshot();
	}

	public async readDocument(payload: unknown, context: EntityExecutionContext) {
		const input = MissionReadDocumentInputSchema.parse(payload);
		const service = await Mission.loadMissionRegistry(context);
		await service.assertMissionDocumentPath(input.path, 'read', service.resolveControlRoot(input, context));
		return MissionDocumentSnapshotSchema.parse(await service.readMissionDocument(input.path));
	}

	public async readWorktree(payload: unknown, context: EntityExecutionContext) {
		const input = MissionLocatorSchema.parse(payload);
		const missionId = this.assertResolvedMissionId(input.missionId);
		const service = await Mission.loadMissionRegistry(context);
		const rootPath = path.join(Repository.getMissionWorktreesPath(service.resolveControlRoot(input, context)), missionId);
		return MissionWorktreeSnapshotSchema.parse({
			rootPath,
			fetchedAt: new Date().toISOString(),
			tree: await service.readDirectoryTree(rootPath, rootPath)
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
			case MissionCommandIds.panic:
				await this.panicStopMission();
				break;
			case MissionCommandIds.clearPanic:
				await this.clearMissionPanic();
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

	public async taskCommand(payload: unknown, _context: EntityExecutionContext) {
		const input = MissionTaskCommandInputSchema.parse(payload);
		this.assertResolvedMissionId(input.missionId);
		switch (input.commandId) {
			case TaskCommandIds.start:
				const terminalSessionName = getCommandStringInput(input.input, 'terminalSessionName');
				await this.startTask(
					input.taskId,
					terminalSessionName
						? { terminalSessionName }
						: {}
				);
				break;
			case TaskCommandIds.complete:
				await this.completeTask(input.taskId);
				break;
			case TaskCommandIds.reopen:
				await this.reopenTask(input.taskId);
				break;
			case TaskCommandIds.rework:
				await this.reworkTask(input.taskId, {
					actor: 'human',
					reasonCode: 'manual.instruction',
					summary: requireCommandTextInput(input.input, input.commandId),
					artifactRefs: []
				});
				break;
			case TaskCommandIds.reworkFromVerification:
				await this.reworkTaskFromVerification(input.taskId);
				break;
			case TaskCommandIds.enableAutostart:
				await this.setTaskAutostart(input.taskId, true);
				break;
			case TaskCommandIds.disableAutostart:
				await this.setTaskAutostart(input.taskId, false);
				break;
			default:
				throw new Error(`Task command '${input.commandId}' is not implemented in the daemon.`);
		}
		return Mission.buildCommandAcknowledgement(input, 'taskCommand', { taskId: input.taskId });
	}

	public async sessionCommand(payload: unknown, context: EntityExecutionContext) {
		const input = MissionAgentSessionCommandInputSchema.parse(payload);
		this.assertResolvedMissionId(input.missionId);
		const service = await Mission.loadMissionRegistry(context);
		switch (input.commandId) {
			case AgentSessionCommandIds.complete:
				await this.completeAgentSession(input.sessionId);
				break;
			case AgentSessionCommandIds.cancel:
				await this.cancelAgentSession(input.sessionId, service.getReason(input.input));
				break;
			case AgentSessionCommandIds.terminate:
				await this.terminateAgentSession(input.sessionId, service.getReason(input.input));
				break;
			default:
				throw new Error(`AgentSession command '${input.commandId}' is not implemented in the daemon.`);
		}
		return Mission.buildCommandAcknowledgement(input, 'sessionCommand', { sessionId: input.sessionId });
	}

	public async writeDocument(payload: unknown, context: EntityExecutionContext) {
		const input = MissionWriteDocumentInputSchema.parse(payload);
		this.assertResolvedMissionId(input.missionId);
		const service = await Mission.loadMissionRegistry(context);
		await service.assertMissionDocumentPath(input.path, 'write', service.resolveControlRoot(input, context));
		return MissionDocumentSnapshotSchema.parse(await service.writeMissionDocument(input.path, input.content));
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
		const { sendMissionTerminalInput } = await import('../../daemon/MissionTerminal.js');
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
			throw new Error(`Mission terminal for '${missionId}' is not available.`);
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

	private static parseTerminalSnapshot(missionId: string, state: MissionAgentTerminalState) {
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
	private lastKnownCommandSnapshot: MissionAvailableCommandSnapshot | undefined;
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
		private readonly adapter: FilesystemAdapter,
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
			requestExecutor: this.workflowRequestExecutor
		});
	}

	public static async create(
		adapter: FilesystemAdapter,
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
		adapter: FilesystemAdapter,
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
		const missionWorktreeRoot = this.adapter.getMissionWorkspacePath(this.missionDir);
		await Repository.initializeScaffolding(missionWorktreeRoot);
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

	public async listAvailableCommands(): Promise<MissionOwnedCommandDescriptor[]> {
		return (await this.listAvailableCommandSnapshot()).commands;
	}

	public async listAvailableCommandSnapshot(): Promise<MissionAvailableCommandSnapshot> {
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
		const commands = (await this.listAvailableCommandSnapshot()).commands;
		return buildMissionSnapshot({
			missionId,
			mission: MissionSnapshotSchema.shape.mission.parse(entity.toData()),
			commands
		});
	}

	public async buildMissionProjectionSnapshot() {
		const snapshot = await this.buildMissionSnapshot();
		return buildMissionProjectionSnapshot({
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
			(candidate) => candidate.terminalSessionName === terminalSessionName,
		);
		return record ? AgentSession.cloneRecord(record) : undefined;
	}

	public getAgentConsoleState(sessionId: string): MissionAgentConsoleState | undefined {
		const state = this.consoleStates.get(sessionId);
		return state ? cloneMissionAgentConsoleState(state) : undefined;
	}

	public async launchAgentSession(
		request: AgentSessionLaunchRequest
	): Promise<AgentSessionRecord> {
		if (!request.taskId) {
			throw new Error('Mission task sessions require an explicit taskId.');
		}

		await this.status();

		const existingSession = this.sessionRecords.find(
			(candidate) => candidate.taskId === request.taskId && isActiveAgentSession(candidate.lifecycleState)
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

	private async resolveLiveAgentSession(session: AgentSessionRecord): Promise<AgentSessionSnapshot | undefined> {
		return this.workflowController.getRuntimeSession(session.sessionId)
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
	}

	public async evaluateGate(intent: GateIntent): Promise<MissionGateResult> {
		const status = await this.status();
		const errors: string[] = [];
		const warnings: string[] = [];
		const currentBranch = this.adapter.getCurrentBranch(this.adapter.getMissionWorkspacePath(this.missionDir));
		const gateIntent = intent === 'commit' ? 'implement' : intent;
		const gate = status.workflow?.gates.find((candidate: { intent: GateIntent }) => candidate.intent === gateIntent);

		if (isMissionDelivered(status.stages ?? [])) {
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
		await (await this.requireTask(taskId)).startFromMissionControl({
			missionWorkspacePath: this.adapter.getMissionWorkspacePath(this.missionDir),
			runners: this.agentRunners,
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
		return buildMissionStatusProjection({
			adapter: this.adapter,
			missionDir: this.missionDir,
			descriptor: this.descriptor,
			workflow: this.workflowResolver(),
			...(persistedDocument ? { document: persistedDocument } : {}),
			sessions: this.getAgentSessions(),
			hydrateRuntimeTasksForActions: (tasks) => this.hydrateRuntimeTasksForActions(tasks)
		});
	}

	private async buildCommandList(document?: MissionStateData): Promise<MissionOwnedCommandDescriptor[]> {
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
	): Promise<MissionOwnedCommandDescriptor[]> {
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
			isMissionDelivered: () => isMissionDelivered(this.lastKnownStatus?.stages ?? []),
			refreshTaskState: (taskId) => this.requireTaskState(taskId),
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
		const currentConsole = this.consoleStates.get(event.snapshot.sessionId) ?? createEmptyMissionAgentConsoleState({
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
			return await promiseWithTimeout(
				this.workflowController.reconcileSessions(),
				Mission.SESSION_RECONCILE_TIMEOUT_MS
			);
		} catch {
			return currentDocument;
		}
	}

	private hasActiveAgentSessions(): boolean {
		return this.sessionRecords.some((session) => isActiveAgentSession(session.lifecycleState));
	}

	private invalidateCachedMissionSnapshots(): void {
		this.lastKnownStatus = undefined;
		this.lastKnownCommandSnapshot = undefined;
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
		const activeSessions = this.sessionRecords.filter(
			(candidate) => candidate.taskId === taskId && isActiveAgentSession(candidate.lifecycleState)
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
		adapter: FilesystemAdapter,
		missionDir: string
	): Promise<MissionStateData | undefined> {
		const rawData = await adapter.readMissionStateDataFile(missionDir);
		return rawData === undefined ? undefined : MissionStateDataSchema.parse(rawData);
	}

	public static async writeStateData(
		adapter: FilesystemAdapter,
		missionDir: string,
		data: MissionStateData
	): Promise<void> {
		await adapter.writeMissionStateDataFile(missionDir, MissionStateDataSchema.parse(data));
	}

	public static async appendEventRecord(
		adapter: FilesystemAdapter,
		missionDir: string,
		eventRecord: MissionWorkflowEventRecord
	): Promise<void> {
		await adapter.appendMissionEventRecordFile(
			missionDir,
			Mission.parseEventRecord(eventRecord)
		);
	}

	public static async readEventLog(
		adapter: FilesystemAdapter,
		missionDir: string
	): Promise<MissionWorkflowEventRecord[]> {
		return MissionWorkflowEventRecordSchema.array()
			.parse(await adapter.readMissionEventLogFile(missionDir))
			.map(Mission.parseEventRecord);
	}

	public static async initializeStateData(input: {
		adapter: FilesystemAdapter;
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
		return this.missionId;
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

	public findArtifact(artifactId: string): MissionDataType['artifacts'][number] | undefined {
		const artifact = this.data.artifacts.find((candidate) => candidate.artifactId === artifactId);
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

		const missionRootDir = requireTrimmedString(status.missionRootDir, 'Mission status missionRootDir');
		const productFiles = status.productFiles ?? {};
		const currentStageId = requireTrimmedString(status.workflow?.currentStageId, 'Mission status workflow.currentStageId') as MissionStageId;
		const artifacts: ArtifactDataType[] = [];

		for (const artifactKey of MISSION_ARTIFACT_KEYS) {
			const filePath = productFiles[artifactKey];
			if (!filePath) {
				continue;
			}

			artifacts.push(createMissionArtifact({
				artifactKey,
				filePath,
				...(missionRootDir ? { missionRootDir } : {})
			}));
		}

		const stages: StageDataType[] = requireArray(status.stages, 'Mission status stages').map((stage) => {
			const stageArtifacts = getMissionStageDefinition(stage.stage).artifacts
				.map((artifactKey) => productFiles[artifactKey]
					? createMissionArtifact({
						artifactKey,
						filePath: productFiles[artifactKey],
						stageId: stage.stage,
						...(missionRootDir ? { missionRootDir } : {})
					})
					: undefined)
				.filter((artifact): artifact is ArtifactDataType => artifact !== undefined);
			const tasks: TaskDataType[] = stage.tasks.map((task) => {
				const entity = toTask(task);
				if (task.filePath) {
					artifacts.push(createTaskArtifact({
						taskId: task.taskId,
						stageId: task.stage,
						fileName: task.fileName,
						filePath: task.filePath,
						relativePath: task.relativePath
					}));
				}
				return entity;
			});
			return createStage({
				stageId: stage.stage,
				lifecycle: stage.status,
				isCurrentStage: currentStageId === stage.stage,
				artifacts: stageArtifacts,
				tasks
			});
		});

		return MissionDataSchema.parse({
			missionId,
			title: requireTrimmedString(status.title, 'Mission status title'),
			...(status.issueId !== undefined ? { issueId: status.issueId } : {}),
			type: missionEntityTypeSchemaFromStatus(status.type),
			...(status.operationalMode ? { operationalMode: status.operationalMode } : {}),
			branchRef: requireTrimmedString(status.branchRef, 'Mission status branchRef'),
			missionDir: requireTrimmedString(status.missionDir, 'Mission status missionDir'),
			missionRootDir: requireTrimmedString(status.missionRootDir, 'Mission status missionRootDir'),
			...(status.workflow?.lifecycle ? { lifecycle: status.workflow.lifecycle } : {}),
			...(status.workflow?.updatedAt ? { updatedAt: status.workflow.updatedAt } : {}),
			...(currentStageId ? { currentStageId } : {}),
			artifacts,
			stages,
			agentSessions: requireArray(status.agentSessions, 'Mission status agentSessions').map((session) => toAgentSession(session)),
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
		adapter: FilesystemAdapter,
		missionDir: string,
		descriptor: MissionDossierDescriptor
	): MissionDataType {
		return MissionDataSchema.parse({
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
}


type MissionAvailableCommandsInput = {
	missionId: string;
	configuration: MissionStateData['configuration'];
	runtime: MissionStateData['runtime'];
	sessions: AgentSessionRecord[];
};


function buildMissionAvailableCommands(input: MissionAvailableCommandsInput): MissionOwnedCommandDescriptor[] {
	const eligibleStageId = resolveEligibleStageId(input);
	const commands: MissionOwnedCommandDescriptor[] = [
		buildPauseMissionCommand(input),
		buildResumeMissionCommand(input),
		buildPanicStopCommand(input),
		buildClearPanicCommand(input),
		buildRestartLaunchQueueCommand(input),
		buildDeliverMissionCommand(input)
	];

	if (eligibleStageId) {
		const generationCommand = buildGenerationCommand(input, eligibleStageId);
		if (generationCommand) {
			commands.push(generationCommand);
		}
	}

	for (const task of getOrderedTasks(input)) {
		commands.push(buildTaskStartCommand(input, task));
		commands.push(buildTaskDoneCommand(input, task));
		commands.push(buildTaskReopenCommand(input, task));
		commands.push(buildTaskReworkCommand(input, task));
		commands.push(...buildTaskLaunchPolicyCommands(input, task));
	}

	for (const session of getOrderedSessions(input)) {
		commands.push(buildSessionCancelCommand(session));
		commands.push(buildSessionTerminateCommand(session));
	}

	return commands;
}

function buildAvailability(
	enabled: boolean,
	reason?: string
): { disabled: boolean; disabledReason?: string; description?: string } {
	if (enabled) {
		return { disabled: false };
	}
	const disabledReason = reason ?? 'Command is unavailable.';
	return { disabled: true, disabledReason, description: disabledReason };
}

function buildPauseMissionCommand(input: MissionAvailableCommandsInput): MissionOwnedCommandDescriptor {
	const enabled = input.runtime.lifecycle === 'running';
	return ownedMissionCommand(missionCommand({
		commandId: MissionCommandIds.pause,
		label: 'Pause Mission',
		...buildAvailability(enabled, describePauseUnavailable(input)),
		requiresConfirmation: false
	}));
}

function buildResumeMissionCommand(input: MissionAvailableCommandsInput): MissionOwnedCommandDescriptor {
	const errors = getValidationErrors(input, { type: 'mission.resumed' });
	const enabled = input.runtime.lifecycle === 'paused' && !input.runtime.panic.active && errors.length === 0;
	return ownedMissionCommand(missionCommand({
		commandId: MissionCommandIds.resume,
		label: 'Resume Mission',
		...buildAvailability(enabled, describeResumeUnavailable(input, errors)),
		requiresConfirmation: false
	}));
}

function buildPanicStopCommand(input: MissionAvailableCommandsInput): MissionOwnedCommandDescriptor {
	const errors = getValidationErrors(input, { type: 'mission.panic.requested' });
	const enabled =
		input.runtime.lifecycle !== 'draft'
		&& input.runtime.lifecycle !== 'completed'
		&& input.runtime.lifecycle !== 'delivered'
		&& !input.runtime.panic.active
		&& errors.length === 0;
	return ownedMissionCommand(missionCommand({
		commandId: MissionCommandIds.panic,
		label: 'Panic Stop',
		...buildAvailability(enabled, describePanicUnavailable(input, errors)),
		requiresConfirmation: true,
		confirmationPrompt: 'Stop all active mission work immediately?',
		variant: 'destructive'
	}));
}

function buildClearPanicCommand(input: MissionAvailableCommandsInput): MissionOwnedCommandDescriptor {
	const errors = getValidationErrors(input, { type: 'mission.panic.cleared' });
	const enabled = input.runtime.panic.active && input.runtime.lifecycle === 'panicked' && errors.length === 0;
	return ownedMissionCommand(missionCommand({
		commandId: MissionCommandIds.clearPanic,
		label: 'Clear Panic',
		...buildAvailability(enabled, describeClearPanicUnavailable(input, errors)),
		requiresConfirmation: true,
		confirmationPrompt: 'Clear the mission panic state?'
	}));
}

function buildRestartLaunchQueueCommand(input: MissionAvailableCommandsInput): MissionOwnedCommandDescriptor {
	const errors = getValidationErrors(input, { type: 'mission.launch-queue.restarted' });
	const enabled = errors.length === 0;
	return ownedMissionCommand(missionCommand({
		commandId: MissionCommandIds.restartQueue,
		label: 'Restart Launch Queue',
		...buildAvailability(enabled, describeRestartLaunchQueueUnavailable(input, errors)),
		requiresConfirmation: true,
		confirmationPrompt: 'Clear stale launch requests and retry queued tasks now?'
	}));
}

function buildDeliverMissionCommand(input: MissionAvailableCommandsInput): MissionOwnedCommandDescriptor {
	const errors = getValidationErrors(input, { type: 'mission.delivered' });
	const delivered = isRuntimeDelivered(input.runtime);
	return ownedMissionCommand(missionCommand({
		commandId: MissionCommandIds.deliver,
		label: 'Deliver Mission',
		...buildAvailability(!delivered && errors.length === 0, delivered ? 'Mission already delivered.' : errors[0]),
		requiresConfirmation: true,
		confirmationPrompt: 'Deliver this mission now?'
	}));
}

function buildGenerationCommand(
	input: MissionAvailableCommandsInput,
	stageId: MissionStageId
): MissionOwnedCommandDescriptor | undefined {
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
	return ownedStageCommand(stageId, missionCommand({
		commandId: StageCommandIds.generateTasks,
		label: `Generate ${displayName} Tasks`,
		...buildAvailability(true),
		requiresConfirmation: false
	}));
}

function buildTaskStartCommand(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number]): MissionOwnedCommandDescriptor {
	const errors = getValidationErrors(input, { type: 'task.queued', taskId: task.taskId });
	const enabled = task.lifecycle === 'ready' && errors.length === 0;
	return ownedTaskCommand(task.taskId, missionCommand({
		commandId: TaskCommandIds.start,
		label: 'Start Ready Task',
		...buildAvailability(enabled, describeTaskStartUnavailable(input, task, errors)),
		requiresConfirmation: false
	}));
}

function buildTaskDoneCommand(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number]): MissionOwnedCommandDescriptor {
	const errors = getValidationErrors(input, { type: 'task.completed', taskId: task.taskId });
	return ownedTaskCommand(task.taskId, missionCommand({
		commandId: TaskCommandIds.complete,
		label: 'Mark Task Done',
		...buildAvailability(errors.length === 0, errors[0]),
		requiresConfirmation: true,
		confirmationPrompt: 'Mark this task done?'
	}));
}

function buildTaskReopenCommand(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number]): MissionOwnedCommandDescriptor {
	const errors = getValidationErrors(input, { type: 'task.reopened', taskId: task.taskId });
	return ownedTaskCommand(task.taskId, missionCommand({
		commandId: TaskCommandIds.reopen,
		label: 'Reopen Task',
		...buildAvailability(errors.length === 0, errors[0]),
		requiresConfirmation: true,
		confirmationPrompt: 'Reopen this task and invalidate downstream stage progress?'
	}));
}

function buildTaskReworkCommand(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number]): MissionOwnedCommandDescriptor {
	const verificationCommand = buildVerificationDerivedTaskReworkCommand(input, task);
	if (verificationCommand) {
		return verificationCommand;
	}

	const errors = getValidationErrors(input, {
		type: 'task.reworked',
		taskId: task.taskId,
		actor: 'human',
		reasonCode: 'manual.rework',
		summary: 'Manual corrective rework requested.',
		artifactRefs: []
	});
	return ownedTaskCommand(task.taskId, missionCommand({
		commandId: TaskCommandIds.rework,
		label: 'Instruct',
		...buildAvailability(errors.length === 0, errors[0]),
		requiresConfirmation: true,
		confirmationPrompt: 'Restart this task with corrective guidance?',
		input: {
			kind: 'text',
			label: 'Instruction',
			placeholder: 'Explain what was wrong and how the next attempt should correct it.',
			required: true,
			multiline: true
		}
	}));
}

function buildVerificationDerivedTaskReworkCommand(
	input: MissionAvailableCommandsInput,
	task: MissionStateData['runtime']['tasks'][number]
): MissionOwnedCommandDescriptor | undefined {
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

	return ownedTaskCommand(task.taskId, missionCommand({
		commandId: TaskCommandIds.reworkFromVerification,
		label: 'Send Back',
		...buildAvailability(errors.length === 0, errors[0]),
		requiresConfirmation: true,
		confirmationPrompt: `Send '${targetTask.title}' back for fixes using the evidence captured by verification task '${task.title}'?`
	}));
}

function buildTaskLaunchPolicyCommands(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number]): MissionOwnedCommandDescriptor[] {
	const commands: MissionOwnedCommandDescriptor[] = [];
	const changeErrors = (autostart: boolean) => getValidationErrors(input, {
		type: 'task.launch-policy.changed',
		taskId: task.taskId,
		autostart
	});

	if (task.runtime.autostart) {
		const errors = changeErrors(false);
		commands.push(ownedTaskCommand(task.taskId, missionCommand({
			commandId: TaskCommandIds.disableAutostart,
			label: 'Disable Autostart',
			...buildAvailability(errors.length === 0, errors[0]),
			requiresConfirmation: false
		})));
	} else {
		const errors = changeErrors(true);
		commands.push(ownedTaskCommand(task.taskId, missionCommand({
			commandId: TaskCommandIds.enableAutostart,
			label: 'Enable Autostart',
			...buildAvailability(errors.length === 0, errors[0]),
			requiresConfirmation: false
		})));
	}

	return commands;
}

function buildSessionCancelCommand(session: AgentSessionRecord): MissionOwnedCommandDescriptor {
	const enabled = session.lifecycleState === 'starting' || session.lifecycleState === 'running' || session.lifecycleState === 'awaiting-input';
	return ownedAgentSessionCommand(session.sessionId, missionCommand({
		commandId: AgentSessionCommandIds.cancel,
		label: 'Stop Running Agent',
		...buildAvailability(enabled, 'Session is not active.'),
		requiresConfirmation: true,
		confirmationPrompt: 'Stop the running agent session?'
	}));
}

function buildSessionTerminateCommand(session: AgentSessionRecord): MissionOwnedCommandDescriptor {
	const enabled = session.lifecycleState === 'starting' || session.lifecycleState === 'running' || session.lifecycleState === 'awaiting-input';
	return ownedAgentSessionCommand(session.sessionId, missionCommand({
		commandId: AgentSessionCommandIds.terminate,
		label: 'Force Stop Agent',
		...buildAvailability(enabled, 'Session is not active.'),
		requiresConfirmation: true,
		confirmationPrompt: 'Force stop this agent session?',
		variant: 'destructive'
	}));
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

function resolveVerificationReworkTargetTask(
	tasks: Array<{ taskId: string; stageId: string; title: string; taskKind?: 'implementation' | 'verification' | undefined; pairedTaskId?: string | undefined }>,
	task: { taskId: string; stageId: string; title: string; taskKind?: 'implementation' | 'verification' | undefined; pairedTaskId?: string | undefined }
) {
	if (task.taskKind !== 'verification' || !task.pairedTaskId) {
		return undefined;
	}

	return tasks.find((candidate) => candidate.taskId === task.pairedTaskId && candidate.taskKind === 'implementation');
}

function describePauseUnavailable(input: MissionAvailableCommandsInput): string {
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

function describeResumeUnavailable(input: MissionAvailableCommandsInput, errors: string[]): string {
	if (input.runtime.panic.active) {
		return 'Clear panic before resuming the mission.';
	}
	if (input.runtime.lifecycle !== 'paused') {
		return 'Mission is not paused.';
	}
	return errors[0] ?? 'Mission cannot be resumed.';
}

function describePanicUnavailable(input: MissionAvailableCommandsInput, errors: string[]): string {
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

function describeClearPanicUnavailable(input: MissionAvailableCommandsInput, errors: string[]): string {
	if (!input.runtime.panic.active) {
		return 'Mission is not panicked.';
	}
	return errors[0] ?? 'Panic cannot be cleared right now.';
}

function describeRestartLaunchQueueUnavailable(input: MissionAvailableCommandsInput, errors: string[]): string {
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

function describeTaskStartUnavailable(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number], errors: string[]): string {
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

function isActiveAgentSession(lifecycleState: MissionAgentLifecycleState): boolean {
	return lifecycleState === 'starting'
		|| lifecycleState === 'running'
		|| lifecycleState === 'awaiting-input';
}

function getValidationErrors(
	input: MissionAvailableCommandsInput,
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
		{ eventId: `${input.missionId}:command`, occurredAt: input.runtime.updatedAt, source: 'human', ...event } as MissionWorkflowEvent,
		input.configuration
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getCommandStringInput(input: unknown, key: string): string | undefined {
	if (!isRecord(input) || typeof input[key] !== 'string') {
		return undefined;
	}
	const value = input[key].trim();
	return value.length > 0 ? value : undefined;
}

function requireCommandTextInput(input: unknown, commandId: string): string {
	if (typeof input !== 'string' || !input.trim()) {
		throw new Error(`Mission command '${commandId}' requires non-empty text input.`);
	}
	return input.trim();
}

function requireTrimmedString(value: string | undefined, fieldName: string): string {
	const normalized = value?.trim();
	if (!normalized) {
		throw new Error(`${fieldName} is required.`);
	}
	return normalized;
}

function requireArray<T>(value: T[] | undefined, fieldName: string): T[] {
	if (!value) {
		throw new Error(`${fieldName} is required.`);
	}
	return value;
}

function missionEntityTypeSchemaFromStatus(value: MissionType | undefined): MissionType {
	return MissionEntityTypeSchema.parse(value);
}

function getOrderedTasks(input: MissionAvailableCommandsInput) {
	return [...input.runtime.tasks].sort((left, right) => {
		const leftStageIndex = input.configuration.workflow.stageOrder.indexOf(left.stageId);
		const rightStageIndex = input.configuration.workflow.stageOrder.indexOf(right.stageId);
		if (leftStageIndex !== rightStageIndex) {
			return leftStageIndex - rightStageIndex;
		}
		return left.taskId.localeCompare(right.taskId);
	});
}

function getOrderedSessions(input: MissionAvailableCommandsInput) {
	return [...input.sessions].sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

function resolveEligibleStageId(input: MissionAvailableCommandsInput): MissionStageId | undefined {
	for (const stageId of input.configuration.workflow.stageOrder) {
		const stageTasks = input.runtime.tasks.filter((task) => task.stageId === stageId);
		const completed = stageTasks.length > 0 && stageTasks.every((task) => task.lifecycle === 'completed');
		if (!completed) {
			return stageId as MissionStageId;
		}
	}
	return input.configuration.workflow.stageOrder[input.configuration.workflow.stageOrder.length - 1] as MissionStageId | undefined;
}

function isRuntimeDelivered(runtime: MissionStateData['runtime']): boolean {
	return runtime.stages.some((stage) => stage.stageId === 'delivery' && stage.lifecycle === 'completed');
}

