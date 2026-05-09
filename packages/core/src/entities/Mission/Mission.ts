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
	AgentExecutionLifecycleStateType,
	AgentExecutionLaunchRequest,
	AgentExecutionRecord
} from '../AgentExecution/AgentExecutionSchema.js';
import type {
	AgentCommand,
	AgentPrompt
} from '../AgentExecution/AgentExecutionProtocolTypes.js';
import { AgentExecution } from '../AgentExecution/AgentExecution.js';
import { AgentExecutionTerminalRecordingWriter } from '../AgentExecution/AgentExecutionTerminalRecordingWriter.js';
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
import type { AgentAdapter } from '../../daemon/runtime/agent/AgentAdapter.js';
import type {
	AgentExecutionEvent,
	AgentExecutionSnapshot,
	AgentExecutionObservation,
	AgentExecutionSignalDecision
} from '../AgentExecution/AgentExecutionProtocolTypes.js';
import { MISSION_ARTIFACT_KEYS, getMissionStageDefinition } from '../../workflow/mission/manifest.js';
import { Artifact } from '../Artifact/Artifact.js';
import { Task, type TaskConfigureOptions } from '../Task/Task.js';
import { AgentRegistry } from '../Agent/AgentRegistry.js';
import { Repository } from '../Repository/Repository.js';
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
	agentRegistry: AgentRegistry;
	logger?: {
		debug?(message: string, metadata?: Record<string, unknown>): void;
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
	private static readonly AGENT_EXECUTION_RECONCILE_TIMEOUT_MS = 1_000;

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
			agentExecutionId?: string;
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
	private readonly agentRegistry: AgentRegistry;
	private readonly consoleStates = new Map<string, MissionAgentConsoleState>();
	private descriptor: MissionDossierDescriptor;
	private agentExecutionRecords: AgentExecutionRecord[] = [];
	private lastKnownStatus: OperatorStatus | undefined;
	private lastKnownCommandSnapshot: MissionCommandViewSnapshotType | undefined;
	private readonly workflowRequestExecutor: MissionWorkflowRequestExecutor;
	private readonly workflowController: MissionWorkflowController;
	private readonly workflowResolver: () => WorkflowDefinition;
	private readonly terminalRecordingWriter: AgentExecutionTerminalRecordingWriter;
	private readonly agentExecutionEventSubscription: MissionAgentDisposable;
	private agentExecutionLifecycleIngestionQueue: Promise<void> = Promise.resolve();
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
		this.agentRegistry = workflowBindings.agentRegistry;
		this.terminalRecordingWriter = new AgentExecutionTerminalRecordingWriter(this.adapter, this.missionDir, this.descriptor.missionId);
		this.workflowRequestExecutor = new MissionWorkflowRequestExecutor({
			adapter: this.adapter,
			agentRegistry: workflowBindings.agentRegistry,
			...(workflowBindings.instructionsPath
				? { instructionsPath: workflowBindings.instructionsPath }
				: {}),
			...(workflowBindings.skillsPath ? { skillsPath: workflowBindings.skillsPath } : {}),
			...(workflowBindings.defaultModel ? { defaultModel: workflowBindings.defaultModel } : {}),
			...(workflowBindings.defaultReasoningEffort
				? { defaultReasoningEffort: workflowBindings.defaultReasoningEffort }
				: {}),
			...(workflowBindings.defaultMode ? { defaultMode: workflowBindings.defaultMode } : {}),
			...(workflowBindings.logger?.debug ? { logger: { debug: workflowBindings.logger.debug } } : {})
		});
		this.agentExecutionEventSubscription = this.workflowRequestExecutor.onDidRuntimeEvent((event) => {
			this.handleAgentExecutionRuntimeEvent(event);
			if (event.type === 'execution.completed' || event.type === 'execution.failed') {
				this.enqueueAgentExecutionLifecycleIngestion();
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
			agentExecutions: this.getAgentExecutions()
		};
	}

	public async refresh(): Promise<this> {
		const nextDescriptor = await this.adapter.readMissionDescriptor(this.missionDir);
		if (!nextDescriptor) {
			throw new Error(`Mission state is missing at '${this.missionDir}'.`);
		}

		this.descriptor = nextDescriptor;
		const document = await this.workflowController.refresh();
		this.syncAgentExecutions(document);
		this.lastKnownCommandSnapshot = undefined;
		this.lastKnownStatus = await this.buildStatus(document);
		return this;
	}

	public async status(): Promise<OperatorStatus> {
		await this.agentExecutionLifecycleIngestionQueue;
		if (
			this.lastKnownStatus
			&& this.lastKnownStatus.workflow?.lifecycle !== 'draft'
			&& !this.hasActiveAgentExecutions()
		) {
			return this.lastKnownStatus;
		}

		const document = await this.readLiveWorkflowDocument({
			reconcileExecutions: this.hasActiveAgentExecutions()
		});
		this.syncAgentExecutions(document);
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
		await this.agentExecutionLifecycleIngestionQueue;
		if (
			this.lastKnownCommandSnapshot
			&& this.lastKnownStatus?.workflow?.lifecycle !== 'draft'
			&& !this.hasActiveAgentExecutions()
		) {
			return this.lastKnownCommandSnapshot;
		}

		const document = await this.readLiveWorkflowDocument({
			reconcileExecutions: this.hasActiveAgentExecutions()
		});
		this.syncAgentExecutions(document);
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
		this.syncAgentExecutions(document);
		this.lastKnownStatus = await this.buildStatus(document);
		return this.lastKnownStatus;
	}

	public getAgentExecutions(): AgentExecutionRecord[] {
		return this.agentExecutionRecords.map((record) => AgentExecution.cloneRecord(record));
	}

	public getAgentExecution(agentExecutionId: string): AgentExecutionRecord | undefined {
		const record = this.agentExecutionRecords.find((candidate) => candidate.agentExecutionId === agentExecutionId);
		return record ? AgentExecution.cloneRecord(record) : undefined;
	}

	public getAgentExecutionByTerminalName(
		terminalName: string,
	): AgentExecutionRecord | undefined {
		const record = this.agentExecutionRecords.find(
			(candidate) => candidate.terminalHandle?.terminalName === terminalName,
		);
		return record ? AgentExecution.cloneRecord(record) : undefined;
	}

	public getAgentConsoleState(agentExecutionId: string): MissionAgentConsoleState | undefined {
		const state = this.consoleStates.get(agentExecutionId);
		return state ? Mission.cloneAgentConsoleState(state) : undefined;
	}

	public async launchAgentExecution(
		request: AgentExecutionLaunchRequest
	): Promise<AgentExecutionRecord> {
		if (!request.taskId) {
			throw new Error('Mission task agentExecutions require an explicit taskId.');
		}

		await this.status();

		const existingAgentExecution = this.findActiveTaskAgentExecution(request.taskId);
		if (existingAgentExecution) {
			if (!(await AgentExecution.isCompatibleForLaunch({
				AgentExecution: existingAgentExecution,
				request,
				resolveLiveAgentExecution: () => this.resolveLiveAgentExecution(existingAgentExecution)
			}))) {
				await this.terminateAgentExecution(existingAgentExecution.agentExecutionId, 'replaced stale task AgentExecution before relaunch');
				await this.status();
			} else {
				return AgentExecution.cloneRecord(existingAgentExecution);
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
		const execution = await task.launchAgentExecution(request);
		return execution.toRecord();
	}

	public async cancelAgentExecution(
		agentExecutionId: string,
		reason?: string
	): Promise<AgentExecutionRecord> {
		return this.cancelAgentExecutionRecord(agentExecutionId, reason);
	}

	public async sendAgentExecutionPrompt(
		agentExecutionId: string,
		prompt: AgentPrompt
	): Promise<AgentExecutionRecord> {
		return this.sendAgentExecutionPromptRecord(agentExecutionId, prompt);
	}

	public async sendAgentExecutionCommand(
		agentExecutionId: string,
		command: AgentCommand
	): Promise<AgentExecutionRecord> {
		return this.sendAgentExecutionCommandRecord(agentExecutionId, command);
	}

	public async completeAgentExecution(
		agentExecutionId: string
	): Promise<AgentExecutionRecord> {
		return this.completeAgentExecutionRecord(agentExecutionId);
	}

	public async terminateAgentExecution(
		agentExecutionId: string,
		reason?: string
	): Promise<AgentExecutionRecord> {
		return this.terminateAgentExecutionRecord(agentExecutionId, reason);
	}

	public dispose(): void {
		this.consoleStates.clear();
		this.agentExecutionEventSubscription.dispose();
		this.terminalRecordingWriter.dispose();
		this.workflowRequestExecutor.dispose();
		this.agentConsoleEventEmitter.dispose();
		this.agentEventEmitter.dispose();
	}

	public getRuntimeAgentExecutionSnapshot(agentExecutionId: string): AgentExecutionSnapshot | undefined {
		return this.workflowController.getRuntimeAgentExecution(agentExecutionId);
	}

	public applyRuntimeAgentExecutionSignalDecision(
		agentExecutionId: string,
		_observation: AgentExecutionObservation,
		decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
	): AgentExecutionSnapshot | undefined {
		return this.workflowController.applyRuntimeAgentExecutionSignalDecision(agentExecutionId, decision);
	}

	private async resolveLiveAgentExecution(execution: AgentExecutionRecord): Promise<AgentExecutionSnapshot | undefined> {
		return this.workflowController.getRuntimeAgentExecution(execution.agentExecutionId)
			?? await this.workflowController.attachRuntimeAgentExecution({
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

	public async startTask(taskId: string, options: { agentAdapter?: string; model?: string; reasoningEffort?: string; terminalName?: string } = {}): Promise<void> {
		await (await this.requireTask(taskId)).startFromMissionControl({
			missionWorkspacePath: this.adapter.getMissionWorkspacePath(this.missionDir),
			agentRegistry: this.agentRegistry,
			...(options.agentAdapter?.trim() ? { agentId: options.agentAdapter.trim() } : {}),
			...(options.model?.trim() ? { model: options.model.trim() } : {}),
			...(options.reasoningEffort?.trim() ? { reasoningEffort: options.reasoningEffort.trim() } : {}),
			...(options.terminalName?.trim() ? { terminalName: options.terminalName.trim() } : {})
		});
	}

	public async configureTask(taskId: string, input: TaskConfigureOptions): Promise<void> {
		const requestedAgentAdapter = input.agentAdapter?.trim();
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.configured', {
			taskId,
			...(requestedAgentAdapter ? { agentAdapter: requestedAgentAdapter } : {}),
			...(Object.prototype.hasOwnProperty.call(input, 'model') ? { model: input.model?.trim() || null } : {}),
			...(Object.prototype.hasOwnProperty.call(input, 'reasoningEffort') ? { reasoningEffort: input.reasoningEffort ?? null } : {}),
			...(typeof input.autostart === 'boolean' ? { autostart: input.autostart } : {}),
			...(input.context ? { context: input.context.map((contextArtifact) => ({ ...contextArtifact })) } : {})
		}));
		if (requestedAgentAdapter) {
			await this.replaceActiveTaskAgentExecutionForAdapter(taskId, requestedAgentAdapter);
		}
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
		sourceAgentExecutionId?: string;
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
			agentExecutions: this.getAgentExecutions(),
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
			this.getAgentExecutions()
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
		agentExecutions: AgentExecutionRecord[]
	): Promise<MissionOwnedCommandDescriptorType[]> {
		const runtimeTasksForActions = await this.hydrateRuntimeTasksForActions(runtime.tasks);
		return buildMissionAvailableCommands({
			missionId: this.descriptor.missionId,
			configuration,
			runtime: {
				...runtime,
				tasks: runtimeTasksForActions
			},
			agentExecutions
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

	private findActiveTaskAgentExecution(taskId: string): AgentExecutionRecord | undefined {
		return this.agentExecutionRecords.find(
			(candidate) => candidate.taskId === taskId && Mission.isActiveAgentExecution(candidate.lifecycleState)
		);
	}

	private async replaceActiveTaskAgentExecutionForAdapter(
		taskId: string,
		agentAdapter: string
	): Promise<void> {
		const activeAgentExecution = this.findActiveTaskAgentExecution(taskId);
		if (!activeAgentExecution) {
			return;
		}
		const agentId = this.agentRegistry.requireAgent(agentAdapter).agentId;
		if (activeAgentExecution.agentId === agentId) {
			return;
		}

		await this.terminateAgentExecution(
			activeAgentExecution.agentExecutionId,
			`replaced by ${agentId} Agent adapter`
		);
		await this.startTask(taskId, { agentAdapter: agentId });
	}

	private requireAgentAdapter(agentId: string): AgentAdapter {
		return this.agentRegistry.requireAgentAdapter(agentId);
	}

	private async startTaskAgentExecution(
		task: MissionTaskState,
		adapter: AgentAdapter,
		request: AgentExecutionLaunchRequest
	): Promise<AgentExecutionSnapshot> {
		return this.workflowController.startRuntimeAgentExecution({
			scope: {
				kind: 'task',
				missionId: this.descriptor.missionId,
				taskId: task.taskId,
				stageId: task.stage,
				repositoryRootPath: Repository.getRepositoryRootFromMissionDir(this.descriptor.missionDir)
			},
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
			requestedAdapterId: adapter.id,
			resume: { mode: 'new' },
			initialPrompt: {
				source: 'operator',
				text: request.prompt,
				...(request.title ? { title: request.title } : task.subject ? { title: task.subject } : {})
			},
			...(request.terminalName?.trim()
				? { metadata: { terminalName: request.terminalName.trim() } }
				: {})
		});
	}

	private async recordStartedTaskAgentExecution(snapshot: AgentExecutionSnapshot): Promise<AgentExecution> {
		if (!snapshot.taskId) {
			throw new Error(`AgentExecution '${snapshot.agentExecutionId}' requires a task scope before it can be recorded on a Mission task.`);
		}
		await this.applyWorkflowEvent({
			eventId: `${this.descriptor.missionId}:agent-execution-started:${snapshot.agentExecutionId}`,
			type: 'execution.started',
			occurredAt: snapshot.updatedAt,
			source: 'daemon',
			agentExecutionId: snapshot.agentExecutionId,
			taskId: snapshot.taskId,
			agentId: snapshot.agentId,
			agentJournalPath: this.adapter.getMissionAgentJournalRelativePath(snapshot.agentExecutionId),
			terminalRecordingPath: this.adapter.getMissionTerminalRecordingRelativePath(snapshot.agentExecutionId),
			...(snapshot.transport?.kind === 'terminal' ? { transportId: 'terminal' } : {}),
			...(snapshot.transport?.kind === 'terminal'
				? {
					terminalHandle: {
						terminalName: snapshot.transport.terminalName,
						terminalPaneId: snapshot.transport.terminalPaneId ?? snapshot.transport.terminalName
					}
				}
				: {})
		});
		await this.refresh();
		this.emitSyntheticAgentExecutionStart(snapshot);
		return this.requireAgentExecution(snapshot.agentExecutionId);
	}

	private async recordTaskAgentExecutionLaunchFailure(taskId: string, error: unknown): Promise<void> {
		const failureEventNonce = Date.now().toString(36);
		await this.applyWorkflowEvent({
			eventId: `${this.descriptor.missionId}:agent-execution-launch-failed:${taskId}:${failureEventNonce}`,
			type: 'execution.launch-failed',
			occurredAt: new Date().toISOString(),
			source: 'daemon',
			taskId,
			reason: error instanceof Error ? error.message : String(error)
		});
		await this.refresh();
	}

	private requireAgentExecutionRecord(agentExecutionId: string): AgentExecutionRecord {
		const record = this.agentExecutionRecords.find((candidate) => candidate.agentExecutionId === agentExecutionId);
		if (!record) {
			throw new Error(`Mission agent execution '${agentExecutionId}' is not recorded in mission state.`);
		}
		return AgentExecution.cloneRecord(record);
	}

	private requireAgentExecution(agentExecutionId: string): AgentExecution {
		return new AgentExecution(AgentExecution.toDataFromRecord(this.requireAgentExecutionRecord(agentExecutionId)));
	}

	private async cancelAgentExecutionRecord(
		agentExecutionId: string,
		reason?: string
	): Promise<AgentExecutionRecord> {
		const record = this.requireAgentExecutionRecord(agentExecutionId);
		await this.ensureAgentExecutionAttached(agentExecutionId);
		const document = await this.workflowController.cancelRuntimeAgentExecution(agentExecutionId, reason, record.taskId);
		await this.ensureAgentExecutionLifecycleRecorded(document, record, 'cancelled');
		await this.refresh();
		return this.requireAgentExecutionRecord(agentExecutionId);
	}

	private async sendAgentExecutionPromptRecord(
		agentExecutionId: string,
		prompt: AgentPrompt
	): Promise<AgentExecutionRecord> {
		await this.ensureAgentExecutionAttached(agentExecutionId);
		await this.workflowController.promptRuntimeAgentExecution(agentExecutionId, prompt);
		await this.refresh();
		return this.requireAgentExecutionRecord(agentExecutionId);
	}

	private async sendAgentExecutionCommandRecord(
		agentExecutionId: string,
		command: AgentCommand
	): Promise<AgentExecutionRecord> {
		await this.ensureAgentExecutionAttached(agentExecutionId);
		await this.workflowController.commandRuntimeAgentExecution(agentExecutionId, command);
		await this.refresh();
		return this.requireAgentExecutionRecord(agentExecutionId);
	}

	private async completeAgentExecutionRecord(
		agentExecutionId: string
	): Promise<AgentExecutionRecord> {
		const record = this.requireAgentExecutionRecord(agentExecutionId);
		await this.ensureAgentExecutionAttached(agentExecutionId);
		await this.workflowController.completeRuntimeAgentExecution(agentExecutionId, record.taskId);
		await this.refresh();
		return this.requireAgentExecutionRecord(agentExecutionId);
	}

	private async terminateAgentExecutionRecord(
		agentExecutionId: string,
		reason?: string
	): Promise<AgentExecutionRecord> {
		const record = this.requireAgentExecutionRecord(agentExecutionId);
		await this.ensureAgentExecutionAttached(agentExecutionId);
		const document = await this.workflowController.terminateRuntimeAgentExecution(agentExecutionId, reason, record.taskId);
		await this.ensureAgentExecutionLifecycleRecorded(document, record, 'terminated');
		await this.refresh();
		return this.requireAgentExecutionRecord(agentExecutionId);
	}

	private async ensureAgentExecutionLifecycleRecorded(
		document: MissionStateData,
		record: AgentExecutionRecord,
		lifecycle: 'cancelled' | 'terminated'
	): Promise<void> {
		const persistedAgentExecution = document.runtime.agentExecutions.find(
			(candidate) => candidate.agentExecutionId === record.agentExecutionId,
		);
		if (persistedAgentExecution?.lifecycle === lifecycle) {
			return;
		}
		const eventType = lifecycle === 'cancelled' ? 'execution.cancelled' : 'execution.terminated';
		await this.applyWorkflowEvent(
			this.createWorkflowEvent(
				eventType,
				{
					agentExecutionId: record.agentExecutionId,
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
			requireAgentAdapter: (agentId) => this.requireAgentAdapter(agentId),
			startTaskAgentExecution: (taskState, adapter, request) =>
				this.startTaskAgentExecution(taskState, adapter, request),
			recordStartedTaskAgentExecution: (snapshot) => this.recordStartedTaskAgentExecution(snapshot),
			recordTaskAgentExecutionLaunchFailure: (taskId, error) =>
				this.recordTaskAgentExecutionLaunchFailure(taskId, error)
		}, task);
	}

	private async ensureAgentExecutionAttached(agentExecutionId: string): Promise<void> {
		if (this.workflowController.getRuntimeAgentExecution(agentExecutionId)) {
			return;
		}
		const record = this.requireAgentExecutionRecord(agentExecutionId);
		await this.workflowController.attachRuntimeAgentExecution({
			agentId: record.agentId,
			agentExecutionId: record.agentExecutionId,
			...(record.transportId === 'terminal' || record.terminalHandle
				? {
					transport: {
						kind: 'terminal',
						terminalName: record.terminalHandle?.terminalName ?? record.agentExecutionId,
						...(record.terminalHandle?.terminalPaneId ? { terminalPaneId: record.terminalHandle.terminalPaneId } : {})
					}
				}
				: {})
		});
	}

	private syncAgentExecutions(document: MissionStateData | undefined): void {
		if (!document) {
			this.agentExecutionRecords = [];
			this.consoleStates.clear();
			return;
		}
		const agentExecutionSnapshots = new Map(
			this.workflowController.listRuntimeAgentExecutions().map((snapshot) => [snapshot.agentExecutionId, snapshot] as const)
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

		this.agentExecutionRecords = document.runtime.agentExecutions.map((execution) => {
			const runtimeSnapshot = agentExecutionSnapshots.get(execution.agentExecutionId);
			const task = tasksById.get(execution.taskId);
			return AgentExecution.createRecordFromLaunch({
				launch: execution,
				adapterLabel: this.agentRegistry.resolveAgent(execution.agentId)?.displayName ?? execution.agentId,
				...(runtimeSnapshot ? { snapshot: runtimeSnapshot } : {}),
				...(task ? { task } : {}),
				missionId: this.descriptor.missionId,
				missionDir: this.adapter.getMissionWorkspacePath(this.missionDir)
			});
		});
		this.terminalRecordingWriter.reconcile(this.agentExecutionRecords);

		const activeAgentExecutionIds = new Set(this.agentExecutionRecords.map((execution) => execution.agentExecutionId));
		for (const record of this.agentExecutionRecords) {
			if (!this.consoleStates.has(record.agentExecutionId)) {
				this.consoleStates.set(record.agentExecutionId, Mission.createEmptyAgentConsoleState({
					awaitingInput: Mission.hasSemanticInputRequest(record),
					agentId: record.agentId,
					adapterLabel: record.adapterLabel,
					agentExecutionId: record.agentExecutionId,
					...(record.currentTurnTitle ? { title: record.currentTurnTitle } : {})
				}));
			}
		}
		for (const agentExecutionId of [...this.consoleStates.keys()]) {
			if (!activeAgentExecutionIds.has(agentExecutionId)) {
				this.consoleStates.delete(agentExecutionId);
			}
		}
	}

	private emitSyntheticAgentExecutionStart(snapshot: AgentExecutionSnapshot): void {
		const agentExecutionRecord = this.getAgentExecution(snapshot.agentExecutionId);
		const state = agentExecutionRecord
			? AgentExecution.createStateFromSnapshot({
				snapshot,
				adapterLabel: agentExecutionRecord.adapterLabel,
				record: agentExecutionRecord
			})
			: AgentExecution.createStateFromSnapshot({
				snapshot,
				adapterLabel: this.agentRegistry.resolveAgent(snapshot.agentId)?.displayName ?? snapshot.agentId
			});
		this.agentEventEmitter.fire({
			type: 'agent-execution-started',
			state
		});
	}

	private handleAgentExecutionRuntimeEvent(event: AgentExecutionEvent): void {
		const agentExecutionRecord = this.getAgentExecution(event.snapshot.agentExecutionId);
		const state = agentExecutionRecord
			? AgentExecution.createStateFromSnapshot({
				snapshot: event.snapshot,
				adapterLabel: agentExecutionRecord.adapterLabel,
				record: agentExecutionRecord
			})
			: AgentExecution.createStateFromSnapshot({
				snapshot: event.snapshot,
				adapterLabel:
					this.agentRegistry.resolveAgent(event.snapshot.agentId)?.displayName ?? event.snapshot.agentId
			});
		const currentConsole = this.consoleStates.get(event.snapshot.agentExecutionId) ?? Mission.createEmptyAgentConsoleState({
			awaitingInput: Mission.hasSemanticInputRequest(state),
			agentId: state.agentId,
			adapterLabel: state.adapterLabel,
			agentExecutionId: state.agentExecutionId,
			...(state.currentTurnTitle ? { title: state.currentTurnTitle } : {})
		});
		if (agentExecutionRecord) {
			this.terminalRecordingWriter.update(agentExecutionRecord);
		}

		switch (event.type) {
			case 'execution.started':
			case 'execution.attached':
			case 'execution.updated': {
				const nextState = Mission.cloneAgentConsoleState({
					...currentConsole,
					awaitingInput: Mission.hasSemanticInputRequest(state),
					...(state.currentTurnTitle ? { title: state.currentTurnTitle } : {})
				});
				this.consoleStates.set(state.agentExecutionId, nextState);
				this.agentEventEmitter.fire({
					type: 'agent-execution-state-changed',
					state
				});
				return;
			}
			case 'execution.message': {
				const nextState = Mission.cloneAgentConsoleState({
					...currentConsole,
					lines: [...currentConsole.lines, event.text],
					awaitingInput: Mission.hasSemanticInputRequest(state)
				});
				this.consoleStates.set(state.agentExecutionId, nextState);
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
			case 'execution.awaiting-input': {
				const nextState = Mission.cloneAgentConsoleState({
					...currentConsole,
					awaitingInput: true
				});
				this.consoleStates.set(state.agentExecutionId, nextState);
				this.agentConsoleEventEmitter.fire({
					type: 'prompt',
					state: nextState
				});
				this.agentEventEmitter.fire({
					type: 'agent-execution-state-changed',
					state: {
						...state,
						lifecycleState: 'awaiting-input'
					}
				});
				return;
			}
			case 'execution.completed':
				this.agentEventEmitter.fire({
					type: 'agent-execution-completed',
					exitCode: 0,
					state
				});
				return;
			case 'execution.failed':
				this.agentEventEmitter.fire({
					type: 'agent-execution-failed',
					errorMessage: event.reason,
					state
				});
				return;
			case 'execution.cancelled':
				this.agentEventEmitter.fire({
					type: 'agent-execution-cancelled',
					...(event.reason ? { reason: event.reason } : {}),
					state
				});
				return;
			case 'execution.terminated':
				this.agentEventEmitter.fire({
					type: 'agent-execution-cancelled',
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

	private enqueueAgentExecutionLifecycleIngestion(): void {
		this.agentExecutionLifecycleIngestionQueue = this.agentExecutionLifecycleIngestionQueue
			.then(async () => {
				await this.ingestAgentExecutionLifecycleEvents();
			})
			.catch(() => undefined);
	}

	private async ingestAgentExecutionLifecycleEvents(): Promise<void> {
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
		this.syncAgentExecutions(document);
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
		options: { reconcileExecutions?: boolean } = {}
	): Promise<MissionStateData | undefined> {
		const currentDocument = await this.workflowController.getPersistedDocument();
		if (!currentDocument) {
			return undefined;
		}
		if (!options.reconcileExecutions) {
			return currentDocument;
		}
		try {
			return await Mission.promiseWithTimeout(
				this.workflowController.reconcileExecutions(),
				Mission.AGENT_EXECUTION_RECONCILE_TIMEOUT_MS
			);
		} catch {
			return currentDocument;
		}
	}

	private hasActiveAgentExecutions(): boolean {
		return this.agentExecutionRecords.some((execution) => Mission.isActiveAgentExecution(execution.lifecycleState));
	}

	private invalidateCachedMissionSnapshots(): void {
		this.lastKnownStatus = undefined;
		this.lastKnownCommandSnapshot = undefined;
	}

	private async queueTask(taskId: string, options: { agentId?: string; prompt?: string; workingDirectory?: string; model?: string; reasoningEffort?: string; terminalName?: string } = {}): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.queued', {
			taskId,
			...(options.agentId?.trim() ? { agentId: options.agentId.trim() } : {}),
			...(options.prompt?.trim() ? { prompt: options.prompt.trim() } : {}),
			...(options.workingDirectory?.trim() ? { workingDirectory: options.workingDirectory.trim() } : {}),
			...(options.model?.trim() ? { model: options.model.trim() } : {}),
			...(options.reasoningEffort?.trim() ? { reasoningEffort: options.reasoningEffort.trim() } : {}),
			...(options.terminalName?.trim() ? { terminalName: options.terminalName.trim() } : {})
		}));
	}

	private async completeTaskExecution(taskId: string): Promise<void> {
		const activeAgentExecutions = this.agentExecutionRecords.filter(
			(candidate) => candidate.taskId === taskId && Mission.isActiveAgentExecution(candidate.lifecycleState)
		);
		for (const execution of activeAgentExecutions) {
			await this.ensureAgentExecutionAttached(execution.agentExecutionId);
			await this.workflowController.completeRuntimeAgentExecution(execution.agentExecutionId, taskId);
		}
		if (activeAgentExecutions.length === 0) {
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
		sourceAgentExecutionId?: string;
		artifactRefs?: MissionTaskArtifactReference[];
	}): Promise<void> {
		await this.applyWorkflowEvent(this.createWorkflowEvent('task.reworked', {
			taskId,
			actor: input.actor,
			reasonCode: input.reasonCode,
			summary: input.summary,
			...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
			...(input.sourceAgentExecutionId ? { sourceAgentExecutionId: input.sourceAgentExecutionId } : {}),
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

	public get agentExecutions(): MissionDataType['agentExecutions'] {
		return this.data.agentExecutions.map((AgentExecution) => structuredClone(AgentExecution));
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
			agentExecutions: Mission.requireArray(status.agentExecutions, 'Mission status agentExecutions').map((agentExecution) => AgentExecution.toDataFromRecord(agentExecution)),
			...(status.recommendedAction ? { recommendedAction: status.recommendedAction } : {})
		});
	}

	private static cloneData(data: MissionDataType): MissionDataType {
		return MissionDataSchema.parse({
			...data,
			artifacts: data.artifacts.map((artifact) => structuredClone(artifact)),
			stages: data.stages.map((stage) => structuredClone(stage)),
			agentExecutions: data.agentExecutions.map((AgentExecution) => structuredClone(AgentExecution))
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
			agentExecutions: []
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
			...(state.agentId ? { agentId: state.agentId } : {}),
			...(state.adapterLabel ? { adapterLabel: state.adapterLabel } : {}),
			...(state.agentExecutionId ? { agentExecutionId: state.agentExecutionId } : {})
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
				...(overrides.agentId ? { agentId: overrides.agentId } : {}),
				...(overrides.adapterLabel ? { adapterLabel: overrides.adapterLabel } : {}),
				...(overrides.agentExecutionId ? { agentExecutionId: overrides.agentExecutionId } : {})
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

	private static isActiveAgentExecution(lifecycleState: AgentExecutionLifecycleStateType): boolean {
		return lifecycleState === 'starting'
			|| lifecycleState === 'running'
			|| lifecycleState === 'awaiting-input';
	}

	private static hasSemanticInputRequest(input: {
		lifecycleState: AgentExecutionLifecycleStateType;
		currentInputRequestId?: string | null;
	}): boolean {
		return input.lifecycleState === 'awaiting-input'
			|| input.currentInputRequestId !== undefined && input.currentInputRequestId !== null;
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
