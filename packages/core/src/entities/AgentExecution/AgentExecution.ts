import { randomUUID } from 'node:crypto';
import type {
	AgentCapabilities,
	AgentCommand,
	AgentExecutionEvent,
	AgentExecutionId,
	AgentExecutionReference,
	AgentExecutionScope,
	AgentLaunchConfig,
	AgentPrompt,
	AgentExecutionSnapshot
} from './AgentExecutionProtocolTypes.js';
import {
	deriveAgentExecutionInteractionCapabilities,
	describeAgentExecutionScope
} from './AgentExecutionProtocolTypes.js';
import type { AgentExecutionSignalDecision } from '../../daemon/runtime/agent/signals/AgentExecutionSignal.js';
import { createEntityId, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import type { MissionTaskState } from '../Mission/MissionSchema.js';
import { Repository } from '../Repository/Repository.js';
import type {
	MissionAgentModelInfo,
	MissionAgentScope,
	AgentExecutionLaunchRequest,
	AgentExecutionRecord,
	AgentExecutionState,
	MissionAgentTelemetrySnapshot
} from './AgentExecutionSchema.js';
import {
	AgentExecutionCommandAcknowledgementSchema,
	AgentExecutionCommandInputSchema,
	AgentExecutionContextSchema,
	AgentExecutionMessageDescriptorSchema,
	AgentExecutionLocatorSchema,
	AgentExecutionPromptSchema,
	AgentExecutionCommandSchema,
	AgentExecutionSendTerminalInputSchema,
	AgentExecutionTerminalSnapshotSchema,
	AgentExecutionDataSchema,
	AgentExecutionCommandIds,
	agentExecutionEntityName,
	type AgentExecutionCommandType,
	type AgentExecutionMessageDescriptorType,
	type AgentExecutionContextType,
	type AgentExecutionInteractionCapabilitiesType,
	type AgentExecutionPromptType,
	type AgentExecutionTerminalHandleType,
	type AgentExecutionDataType
} from './AgentExecutionSchema.js';
import type { MissionSnapshotType } from '../Mission/MissionSchema.js';
import { MissionDossierFilesystem } from '../Mission/MissionDossierFilesystem.js';
import { Terminal } from '../Terminal/Terminal.js';

export type AgentExecutionOwner = {
	completeSessionRecord(sessionId: string): Promise<AgentExecutionRecord>;
	cancelSessionRecord(sessionId: string, reason?: string): Promise<AgentExecutionRecord>;
	terminateSessionRecord(sessionId: string, reason?: string): Promise<AgentExecutionRecord>;
	sendSessionPrompt(sessionId: string, prompt: AgentPrompt): Promise<AgentExecutionRecord>;
	sendSessionCommand(sessionId: string, command: AgentCommand): Promise<AgentExecutionRecord>;
};

const agentExecutionDataCache = new Map<string, { data: AgentExecutionDataType; timestamp: number }>();
const SESSION_DATA_CACHE_TTL_MS = 5_000;

type AgentExecutionLaunchRecord = {
	sessionId: string;
	agentId: string;
	transportId?: string | undefined;
	sessionLogPath?: string | undefined;
	terminalHandle?: AgentExecutionTerminalHandleType | undefined;
	taskId: string;
	lifecycle: AgentExecutionRecord['lifecycleState'];
	launchedAt: string;
	updatedAt: string;
};

type SnapshotOverrides = Omit<Partial<AgentExecutionSnapshot>, 'failureMessage'> & {
	failureMessage?: string | undefined;
};

type AgentExecutionTerminalUpdate = {
	terminalName: string;
	chunk?: string;
	dead: boolean;
	exitCode: number | null;
};

type AgentExecutionTerminalUpdateSource = {
	onDidTerminalUpdate(listener: (update: AgentExecutionTerminalUpdate) => void): { dispose(): void };
};

export class AgentExecution extends Entity<AgentExecutionDataType, string> {
	public static override readonly entityName = agentExecutionEntityName;

	public static createEntityId(missionId: string, sessionId: string): string {
		return createEntityId('agent_execution', `${missionId}/${sessionId}`);
	}

	public static capabilities(): AgentCapabilities {
		return {
			acceptsPromptSubmission: true,
			acceptsCommands: true,
			supportsInterrupt: true,
			supportsResumeByReference: true,
			supportsCheckpoint: true,
			shareModes: ['terminal']
		};
	}

	public static createFreshExecutionId(config: AgentLaunchConfig, agentId: string): AgentExecutionId {
		return buildFreshAgentExecutionId(config.scope, agentId);
	}

	public static toDataFromRecord(record: AgentExecutionRecord): AgentExecutionDataType {
		const missionId = AgentExecution.requireRecordMissionId(record);
		return AgentExecutionDataSchema.parse({
			id: AgentExecution.createEntityId(missionId, record.sessionId),
			sessionId: record.sessionId,
			agentId: record.agentId,
			...(record.transportId ? { transportId: record.transportId } : {}),
			...(record.sessionLogPath ? { sessionLogPath: record.sessionLogPath } : {}),
			adapterLabel: record.adapterLabel,
			lifecycleState: record.lifecycleState,
			...(record.terminalHandle ? { terminalHandle: { ...record.terminalHandle } } : {}),
			...(record.taskId ? { taskId: record.taskId } : {}),
			...(record.assignmentLabel ? { assignmentLabel: record.assignmentLabel } : {}),
			...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
			...(record.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
			interactionCapabilities: { ...record.interactionCapabilities },
			context: AgentExecution.createContext(record),
			runtimeMessages: AgentExecution.cloneRuntimeMessages(record.runtimeMessages),
			...(record.scope ? { scope: record.scope } : {}),
			...(record.telemetry ? { telemetry: record.telemetry } : {}),
			createdAt: record.createdAt,
			lastUpdatedAt: record.lastUpdatedAt,
			...(record.failureMessage ? { failureMessage: record.failureMessage } : {})
		});
	}

	public static async read(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionLocatorSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return AgentExecution.requireData(await mission.buildMissionSnapshot(), input.sessionId);
		} finally {
			mission.dispose();
		}
	}

	public static requireData(snapshot: MissionSnapshotType, sessionId: string) {
		const session = snapshot.agentExecutions.find((candidate) => candidate.sessionId === sessionId);
		if (!session) {
			throw new Error(`AgentExecution '${sessionId}' could not be resolved in Mission '${snapshot.mission.missionId}'.`);
		}
		return AgentExecutionDataSchema.parse(session);
	}

	public static async resolve(payload: unknown, context: EntityExecutionContext): Promise<AgentExecution> {
		const input = AgentExecutionCommandInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			return new AgentExecution(AgentExecution.requireData(await mission.buildMissionSnapshot(), input.sessionId));
		} finally {
			mission.dispose();
		}
	}

	public static async readTerminal(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionLocatorSchema.parse(payload);
		const data = await AgentExecution.requireDataForLocator(input, context);
		return AgentExecution.readTerminalData(context.surfacePath, input.missionId, data);
	}


	public async command(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionCommandInputSchema.parse(payload);
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			AgentExecution.requireData(await mission.buildMissionSnapshot(), input.sessionId);
			switch (input.commandId) {
				case AgentExecutionCommandIds.complete:
					await mission.completeAgentExecution(input.sessionId);
					break;
				case AgentExecutionCommandIds.cancel:
					await mission.cancelAgentExecution(input.sessionId, AgentExecution.getReason(input.input));
					break;
				case AgentExecutionCommandIds.sendPrompt:
					await mission.sendAgentExecutionPrompt(
						input.sessionId,
						AgentExecution.normalizeAgentPrompt(AgentExecutionPromptSchema.parse(input.input))
					);
					break;
				case AgentExecutionCommandIds.sendRuntimeMessage:
					await mission.sendAgentExecutionCommand(
						input.sessionId,
						AgentExecution.normalizeAgentCommand(AgentExecutionCommandSchema.parse(input.input))
					);
					break;
				default:
					throw new Error(`AgentExecution command '${input.commandId}' is not implemented in the daemon.`);
			}
			return AgentExecutionCommandAcknowledgementSchema.parse({
				ok: true,
				entity: agentExecutionEntityName,
				method: 'command',
				id: input.sessionId,
				missionId: input.missionId,
				sessionId: input.sessionId,
				commandId: input.commandId
			});
		} finally {
			mission.dispose();
		}
	}

	public static async sendTerminalInput(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionSendTerminalInputSchema.parse(payload);
		const data = await AgentExecution.requireDataForLocator(input, context);
		const terminalHandle = AgentExecution.requireTerminalHandle(data);
		Terminal.sendInput({
			terminalName: terminalHandle.terminalName,
			terminalPaneId: terminalHandle.terminalPaneId,
			...(input.data !== undefined ? { data: input.data } : {}),
			...(input.literal !== undefined ? { literal: input.literal } : {}),
			...(input.cols !== undefined ? { cols: input.cols } : {}),
			...(input.rows !== undefined ? { rows: input.rows } : {})
		}, context);
		return AgentExecution.readTerminalData(context.surfacePath, input.missionId, data);
	}

	public static async isCompatibleForLaunch(input: {
		session: AgentExecutionRecord;
		request: AgentExecutionLaunchRequest;
		resolveLiveSession(): Promise<AgentExecutionSnapshot | undefined>;
	}): Promise<boolean> {
		try {
			const liveSession = await input.resolveLiveSession();
			if (!liveSession || AgentExecution.isTerminalFinalStatus(liveSession.status)) {
				return false;
			}
			if (liveSession.taskId !== input.request.taskId) {
				return false;
			}
			if (liveSession.workingDirectory && liveSession.workingDirectory !== input.request.workingDirectory) {
				return false;
			}
			return true;
		} catch {
			return true;
		}
	}

	private static isRecord(input: unknown): input is Record<string, unknown> {
		return typeof input === 'object' && input !== null && !Array.isArray(input);
	}

	private static getReason(input: unknown): string | undefined {
		if (!AgentExecution.isRecord(input) || typeof input['reason'] !== 'string') {
			return undefined;
		}
		const reason = input['reason'].trim();
		return reason.length > 0 ? reason : undefined;
	}

	private static normalizeAgentPrompt(input: AgentExecutionPromptType): AgentPrompt {
		return {
			source: input.source,
			text: input.text,
			...(input.title ? { title: input.title } : {}),
			...(input.metadata ? { metadata: input.metadata } : {})
		};
	}

	private static normalizeAgentCommand(input: AgentExecutionCommandType): AgentCommand {
		return {
			type: input.type,
			...(input.reason ? { reason: input.reason } : {}),
			...(input.metadata ? { metadata: input.metadata } : {})
		};
	}

	public static isTerminalFinalStatus(status: AgentExecutionSnapshot['status']): boolean {
		return status === 'completed'
			|| status === 'failed'
			|| status === 'cancelled'
			|| status === 'terminated';
	}

	public static createContext(record: AgentExecutionRecord): AgentExecutionContextType {
		return AgentExecutionContextSchema.parse({
			artifacts: record.assignmentLabel
				? [{ id: record.assignmentLabel, role: 'instruction', order: 0, title: record.currentTurnTitle ?? record.assignmentLabel }]
				: [],
			instructions: record.currentTurnTitle
				? [{ instructionId: `${record.sessionId}:turn-title`, text: record.currentTurnTitle, order: 0 }]
				: []
		});
	}

	public static createRuntimeMessageDescriptors(): AgentExecutionMessageDescriptorType[] {
		return AgentExecution.createRuntimeMessageDescriptorsForCommands(['interrupt', 'checkpoint', 'nudge', 'resume']);
	}

	public static createRuntimeMessageDescriptorsForCommands(
		commandTypes: AgentCommand['type'][]
	): AgentExecutionMessageDescriptorType[] {
		return AgentExecutionMessageDescriptorSchema.array().parse([
			{ type: 'interrupt', label: 'Interrupt', delivery: 'best-effort', mutatesContext: false },
			{ type: 'checkpoint', label: 'Checkpoint', delivery: 'best-effort', mutatesContext: false },
			{ type: 'nudge', label: 'Nudge', delivery: 'best-effort', mutatesContext: false },
			{ type: 'resume', label: 'Resume', delivery: 'best-effort', mutatesContext: false }
		].filter((descriptor) => commandTypes.includes(descriptor.type as AgentCommand['type'])));
	}

	public static buildTaskScope(
		task: MissionTaskState,
		missionId?: string,
		missionDir?: string
	): MissionAgentScope {
		return {
			kind: 'slice',
			sliceTitle: task.subject,
			verificationTargets: [],
			requiredSkills: [],
			dependsOn: [...task.dependsOn],
			...(missionId ? { missionId } : {}),
			...(missionDir ? { missionDir } : {}),
			...(task.stage ? { stage: task.stage } : {}),
			...(task.taskId ? { taskId: task.taskId } : {}),
			...(task.subject ? { taskTitle: task.subject } : {}),
			...(task.subject ? { taskSummary: task.subject } : {}),
			...(task.instruction ? { taskInstruction: task.instruction } : {})
		};
	}

	public static createRecordFromLaunch(input: {
		launch: AgentExecutionLaunchRecord;
		adapterLabel: string;
		snapshot?: AgentExecutionSnapshot;
		task?: MissionTaskState;
		missionId?: string;
		missionDir?: string;
	}): AgentExecutionRecord {
		const scope = input.task
			? AgentExecution.buildTaskScope(input.task, input.missionId, input.missionDir)
			: undefined;
		const terminalFields = getTerminalFields(input.snapshot);

		return AgentExecution.cloneRecord({
			sessionId: input.launch.sessionId,
			agentId: input.launch.agentId,
			...(terminalFields.transportId ? { transportId: terminalFields.transportId } : input.launch.transportId ? { transportId: input.launch.transportId } : {}),
			...(input.launch.sessionLogPath ? { sessionLogPath: input.launch.sessionLogPath } : {}),
			...(terminalFields.terminalHandle
				? { terminalHandle: terminalFields.terminalHandle }
				: input.launch.terminalHandle
					? { terminalHandle: { ...input.launch.terminalHandle } }
					: {}),
			adapterLabel: input.adapterLabel,
			lifecycleState: input.snapshot?.status ?? input.launch.lifecycle,
			createdAt: input.launch.launchedAt,
			lastUpdatedAt: input.snapshot?.updatedAt ?? input.launch.updatedAt,
			...(input.launch.taskId ? { taskId: input.launch.taskId } : {}),
			...(input.task?.relativePath ? { assignmentLabel: input.task.relativePath } : {}),
			...(input.snapshot?.workingDirectory ? { workingDirectory: input.snapshot.workingDirectory } : {}),
			...(input.task?.subject ? { currentTurnTitle: input.task.subject } : {}),
			interactionCapabilities: AgentExecution.resolveInteractionCapabilities({
				lifecycleState: input.snapshot?.status ?? input.launch.lifecycle,
				transport: input.snapshot?.transport
					?? (terminalFields.terminalHandle
						? {
							kind: 'terminal',
							terminalName: terminalFields.terminalHandle.terminalName,
							terminalPaneId: terminalFields.terminalHandle.terminalPaneId
						}
						: undefined),
				...(input.snapshot?.acceptsPrompts !== undefined
					? { acceptsPrompts: input.snapshot.acceptsPrompts }
					: {}),
				...(input.snapshot?.acceptedCommands
					? { acceptedCommands: input.snapshot.acceptedCommands }
					: {})
			}),
			runtimeMessages: AgentExecution.resolveRuntimeMessages({
				lifecycleState: input.snapshot?.status ?? input.launch.lifecycle,
				...(input.snapshot?.acceptsPrompts !== undefined
					? { acceptsPrompts: input.snapshot.acceptsPrompts }
					: {}),
				...(input.snapshot?.acceptedCommands
					? { acceptedCommands: input.snapshot.acceptedCommands }
					: {})
			}),
			...(scope ? { scope } : {}),
			...(input.snapshot?.failureMessage ? { failureMessage: input.snapshot.failureMessage } : {})
		});
	}

	public static createStateFromSnapshot(input: {
		snapshot: AgentExecutionSnapshot;
		adapterLabel: string;
		record?: AgentExecutionRecord;
	}): AgentExecutionState {
		const { snapshot, adapterLabel, record } = input;
		const terminalFields = getTerminalFields(snapshot);
		return AgentExecution.cloneState({
			agentId: snapshot.agentId,
			...(terminalFields.transportId ? { transportId: terminalFields.transportId } : {}),
			adapterLabel,
			sessionId: snapshot.sessionId,
			...(record?.sessionLogPath ? { sessionLogPath: record.sessionLogPath } : {}),
			...(terminalFields.terminalHandle
				? { terminalHandle: terminalFields.terminalHandle }
				: record?.terminalHandle
					? { terminalHandle: { ...record.terminalHandle } }
					: {}),
			lifecycleState: snapshot.status,
			lastUpdatedAt: snapshot.updatedAt,
			...(snapshot.workingDirectory
				? { workingDirectory: snapshot.workingDirectory }
				: record?.workingDirectory
					? { workingDirectory: record.workingDirectory }
					: {}),
			...(record?.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
			interactionCapabilities: snapshot.interactionCapabilities
				? { ...snapshot.interactionCapabilities }
				: AgentExecution.resolveInteractionCapabilities({
					lifecycleState: snapshot.status,
					...(snapshot.transport ? { transport: snapshot.transport } : {}),
					acceptsPrompts: snapshot.acceptsPrompts,
					acceptedCommands: snapshot.acceptedCommands
				}),
			runtimeMessages: AgentExecution.resolveRuntimeMessages({
				lifecycleState: snapshot.status,
				acceptsPrompts: snapshot.acceptsPrompts,
				acceptedCommands: snapshot.acceptedCommands
			}),
			...(record?.scope ? { scope: record.scope } : {}),
			...(snapshot.failureMessage
				? { failureMessage: snapshot.failureMessage }
				: record?.failureMessage
					? { failureMessage: record.failureMessage }
					: {})
		});
	}

	public static cloneRecord(record: AgentExecutionRecord): AgentExecutionRecord {
		const telemetry = AgentExecution.cloneTelemetry(record.telemetry);
		return {
			sessionId: record.sessionId,
			agentId: record.agentId,
			...(record.transportId ? { transportId: record.transportId } : {}),
			...(record.sessionLogPath ? { sessionLogPath: record.sessionLogPath } : {}),
			...(record.terminalHandle ? { terminalHandle: { ...record.terminalHandle } } : {}),
			adapterLabel: record.adapterLabel,
			lifecycleState: record.lifecycleState,
			createdAt: record.createdAt,
			lastUpdatedAt: record.lastUpdatedAt,
			...(record.taskId ? { taskId: record.taskId } : {}),
			...(record.assignmentLabel ? { assignmentLabel: record.assignmentLabel } : {}),
			...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
			...(record.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
			interactionCapabilities: { ...record.interactionCapabilities },
			runtimeMessages: AgentExecution.cloneRuntimeMessages(record.runtimeMessages),
			...(record.scope ? { scope: AgentExecution.cloneScope(record.scope) } : {}),
			...(telemetry ? { telemetry } : {}),
			...(record.failureMessage ? { failureMessage: record.failureMessage } : {})
		};
	}

	public static cloneState(state: AgentExecutionState): AgentExecutionState {
		const telemetry = AgentExecution.cloneTelemetry(state.telemetry);
		return {
			agentId: state.agentId,
			...(state.transportId ? { transportId: state.transportId } : {}),
			adapterLabel: state.adapterLabel,
			sessionId: state.sessionId,
			...(state.sessionLogPath ? { sessionLogPath: state.sessionLogPath } : {}),
			...(state.terminalHandle ? { terminalHandle: { ...state.terminalHandle } } : {}),
			lifecycleState: state.lifecycleState,
			lastUpdatedAt: state.lastUpdatedAt,
			...(state.workingDirectory ? { workingDirectory: state.workingDirectory } : {}),
			...(state.currentTurnTitle ? { currentTurnTitle: state.currentTurnTitle } : {}),
			interactionCapabilities: { ...state.interactionCapabilities },
			runtimeMessages: AgentExecution.cloneRuntimeMessages(state.runtimeMessages),
			...(state.scope ? { scope: AgentExecution.cloneScope(state.scope) } : {}),
			...(state.awaitingPermission
				? {
					awaitingPermission: {
						...state.awaitingPermission,
						options: [...state.awaitingPermission.options],
						...(state.awaitingPermission.providerDetails
							? { providerDetails: { ...state.awaitingPermission.providerDetails } }
							: {})
					}
				}
				: {}),
			...(telemetry ? { telemetry } : {}),
			...(state.failureMessage ? { failureMessage: state.failureMessage } : {})
		};
	}

	private static cloneRuntimeMessages(
		runtimeMessages: AgentExecutionMessageDescriptorType[]
	): AgentExecutionMessageDescriptorType[] {
		return runtimeMessages.map((descriptor) => ({
			...descriptor,
			...(descriptor.input ? { input: { ...descriptor.input } } : {})
		}));
	}

	private static resolveRuntimeMessages(input: {
		lifecycleState: AgentExecutionRecord['lifecycleState'] | AgentExecutionSnapshot['status'];
		acceptsPrompts?: boolean;
		acceptedCommands?: AgentCommand['type'][];
	}): AgentExecutionMessageDescriptorType[] {
		const acceptedCommands = input.acceptedCommands ?? AgentExecution.deriveAcceptedCommands(input.lifecycleState);
		return AgentExecution.createRuntimeMessageDescriptorsForCommands(acceptedCommands);
	}

	private static resolveInteractionCapabilities(input: {
		lifecycleState: AgentExecutionRecord['lifecycleState'] | AgentExecutionSnapshot['status'];
		transport?: AgentExecutionSnapshot['transport'];
		acceptsPrompts?: boolean;
		acceptedCommands?: AgentCommand['type'][];
	}): AgentExecutionInteractionCapabilitiesType {
		return deriveAgentExecutionInteractionCapabilities({
			status: input.lifecycleState,
			...(input.transport ? { transport: input.transport } : {}),
			acceptsPrompts: input.acceptsPrompts ?? AgentExecution.deriveAcceptsPrompts(input.lifecycleState),
			acceptedCommands: input.acceptedCommands ?? AgentExecution.deriveAcceptedCommands(input.lifecycleState)
		});
	}

	private static deriveAcceptsPrompts(
		lifecycleState: AgentExecutionRecord['lifecycleState'] | AgentExecutionSnapshot['status']
	): boolean {
		return lifecycleState === 'running' || lifecycleState === 'awaiting-input';
	}

	private static deriveAcceptedCommands(
		lifecycleState: AgentExecutionRecord['lifecycleState'] | AgentExecutionSnapshot['status']
	): AgentCommand['type'][] {
		if (lifecycleState === 'awaiting-input') {
			return ['interrupt', 'checkpoint', 'nudge', 'resume'];
		}
		if (lifecycleState === 'starting' || lifecycleState === 'running') {
			return ['interrupt', 'checkpoint', 'nudge'];
		}
		return [];
	}

	private readonly owner: AgentExecutionOwner | undefined;
	private readonly record: AgentExecutionRecord | undefined;
	private readonly listeners = new Set<(event: AgentExecutionEvent) => void>();
	private liveSnapshot: AgentExecutionSnapshot | undefined;
	private disposed = false;

	public static createLive(snapshot: AgentExecutionSnapshot): AgentExecution {
		const execution = new AgentExecution(AgentExecution.toDataFromRuntimeSnapshot(snapshot));
		execution.liveSnapshot = cloneRuntimeSnapshot(snapshot);
		return execution;
	}

	private static toDataFromRuntimeSnapshot(snapshot: AgentExecutionSnapshot): AgentExecutionDataType {
		const runtimeScope = toAgentRuntimeScope(snapshot);
		return AgentExecutionDataSchema.parse({
			id: AgentExecution.createEntityId(getAgentExecutionEntityScopeId(snapshot), snapshot.sessionId),
			sessionId: snapshot.sessionId,
			agentId: snapshot.agentId,
			...(snapshot.transport?.kind === 'terminal' ? { transportId: 'terminal' } : {}),
			adapterLabel: snapshot.agentId,
			lifecycleState: snapshot.status,
			...(snapshot.transport?.kind === 'terminal'
				? {
					terminalHandle: {
						terminalName: snapshot.transport.terminalName,
						terminalPaneId: snapshot.transport.terminalPaneId ?? snapshot.transport.terminalName
					}
				}
				: {}),
			...(snapshot.taskId ? { taskId: snapshot.taskId } : {}),
			workingDirectory: snapshot.workingDirectory,
			interactionCapabilities: snapshot.interactionCapabilities
				? { ...snapshot.interactionCapabilities }
				: AgentExecution.resolveInteractionCapabilities({
					lifecycleState: snapshot.status,
					...(snapshot.transport ? { transport: snapshot.transport } : {}),
					acceptsPrompts: snapshot.acceptsPrompts,
					acceptedCommands: snapshot.acceptedCommands
				}),
			context: AgentExecutionContextSchema.parse({ artifacts: [], instructions: [] }),
			runtimeMessages: AgentExecution.resolveRuntimeMessages({
				lifecycleState: snapshot.status,
				acceptsPrompts: snapshot.acceptsPrompts,
				acceptedCommands: snapshot.acceptedCommands
			}),
			...(runtimeScope ? { scope: runtimeScope } : {}),
			createdAt: snapshot.startedAt,
			lastUpdatedAt: snapshot.updatedAt,
			...(snapshot.failureMessage ? { failureMessage: snapshot.failureMessage } : {})
		});
	}

	public constructor(data: AgentExecutionDataType);
	public constructor(owner: AgentExecutionOwner, record: AgentExecutionRecord);
	public constructor(ownerOrData: AgentExecutionOwner | AgentExecutionDataType, record?: AgentExecutionRecord) {
		if (record) {
			super(AgentExecution.toDataFromRecord(record));
			this.owner = ownerOrData as AgentExecutionOwner;
			this.record = AgentExecution.cloneRecord(record);
			return;
		}

		super(AgentExecutionDataSchema.parse(ownerOrData));
		this.owner = undefined;
		this.record = undefined;
	}

	public get id(): string {
		return this.sessionId;
	}

	public get sessionId(): string {
		return this.record?.sessionId ?? this.toData().sessionId;
	}

	public get reference(): AgentExecutionReference {
		return this.getSnapshot().reference;
	}

	public attachTerminal(input: {
		terminalName: string;
		source: AgentExecutionTerminalUpdateSource;
	}): { dispose(): void } {
		const terminalName = input.terminalName.trim();
		if (!terminalName) {
			throw new Error(`AgentExecution '${this.sessionId}' requires a terminal name before terminal attachment.`);
		}
		return input.source.onDidTerminalUpdate((update) => {
			if (update.terminalName === terminalName) {
				this.applyTerminalUpdate(update);
			}
		});
	}

	public getSnapshot(): AgentExecutionSnapshot {
		if (!this.liveSnapshot) {
			throw new Error(`AgentExecution '${this.sessionId}' is not attached to live runtime state.`);
		}
		return cloneRuntimeSnapshot(this.liveSnapshot);
	}

	public onDidEvent(listener: (event: AgentExecutionEvent) => void): { dispose(): void } {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			}
		};
	}

	public async complete(): Promise<AgentExecutionSnapshot> {
		const endedAt = new Date().toISOString();
		const snapshot = this.updateSnapshot({
			status: 'completed',
			attention: 'none',
			waitingForInput: false,
			acceptsPrompts: false,
			acceptedCommands: [],
			progress: {
				state: 'done',
				updatedAt: endedAt
			},
			endedAt,
			failureMessage: undefined
		});
		this.emitEvent({ type: 'execution.completed', snapshot });
		return snapshot;
	}

	public async submitPrompt(prompt: AgentPrompt): Promise<AgentExecutionSnapshot> {
		this.requireActiveSnapshot('submit a prompt', { requirePromptAcceptance: true });
		const snapshot = this.updateSnapshot({
			status: 'running',
			attention: 'autonomous',
			waitingForInput: false,
			acceptsPrompts: true,
			acceptedCommands: ['interrupt', 'checkpoint', 'nudge'],
			progress: {
				state: 'working',
				updatedAt: new Date().toISOString()
			}
		});
		this.emitEvent({ type: 'execution.updated', snapshot });
		this.emitEvent({
			type: 'execution.message',
			channel: prompt.source === 'operator' || prompt.source === 'system' ? 'system' : 'agent',
			text: prompt.text,
			snapshot
		});
		return snapshot;
	}

	public async submitCommand(command: AgentCommand): Promise<AgentExecutionSnapshot> {
		this.requireActiveSnapshot(`perform '${command.type}'`);
		if (command.type === 'interrupt') {
			const snapshot = this.updateSnapshot({
				status: 'awaiting-input',
				attention: 'awaiting-operator',
				waitingForInput: true,
				acceptsPrompts: true,
				acceptedCommands: ['resume', 'checkpoint', 'nudge', 'interrupt'],
				progress: {
					state: 'waiting-input',
					...(command.reason ? { detail: command.reason } : {}),
					updatedAt: new Date().toISOString()
				}
			});
			this.emitEvent({ type: 'execution.awaiting-input', snapshot });
			return snapshot;
		}
		return this.submitPrompt(buildCommandPrompt(command));
	}

	public async cancelRuntime(reason?: string): Promise<AgentExecutionSnapshot> {
		this.requireActiveSnapshot('cancel');
		const snapshot = this.updateSnapshot({
			status: 'cancelled',
			attention: 'none',
			waitingForInput: false,
			acceptsPrompts: false,
			acceptedCommands: [],
			progress: {
				state: 'failed',
				...(reason ? { detail: reason } : {}),
				updatedAt: new Date().toISOString()
			},
			endedAt: new Date().toISOString(),
			...(reason ? { failureMessage: reason } : {})
		});
		this.emitEvent({ type: 'execution.cancelled', ...(reason ? { reason } : {}), snapshot });
		return snapshot;
	}

	public async terminateRuntime(reason?: string): Promise<AgentExecutionSnapshot> {
		const snapshot = this.updateSnapshot({
			status: 'terminated',
			attention: 'none',
			waitingForInput: false,
			acceptsPrompts: false,
			acceptedCommands: [],
			progress: {
				state: 'failed',
				...(reason ? { detail: reason } : {}),
				updatedAt: new Date().toISOString()
			},
			endedAt: new Date().toISOString(),
			...(reason ? { failureMessage: reason } : {})
		});
		this.emitEvent({ type: 'execution.terminated', ...(reason ? { reason } : {}), snapshot });
		return snapshot;
	}

	public dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.listeners.clear();
	}

	public updateSnapshot(overrides: SnapshotOverrides): AgentExecutionSnapshot {
		const snapshot = this.getSnapshot();
		const nextSnapshot: AgentExecutionSnapshot = {
			...snapshot,
			acceptedCommands: overrides.acceptedCommands
				? [...overrides.acceptedCommands]
				: [...snapshot.acceptedCommands],
			progress: overrides.progress
				? {
					...overrides.progress,
					...(overrides.progress.units ? { units: { ...overrides.progress.units } } : {})
				}
				: {
					...snapshot.progress,
					...(snapshot.progress.units ? { units: { ...snapshot.progress.units } } : {})
				},
			reference: overrides.reference
				? {
					...overrides.reference,
					...(overrides.reference.transport ? { transport: { ...overrides.reference.transport } } : {})
				}
				: {
					...snapshot.reference,
					...(snapshot.reference.transport ? { transport: { ...snapshot.reference.transport } } : {})
				},
			updatedAt: new Date().toISOString()
		};
		for (const key of Object.keys(overrides) as Array<keyof SnapshotOverrides>) {
			const value = overrides[key];
			if (key === 'failureMessage' && value === undefined) {
				continue;
			}
			if (value !== undefined) {
				Object.assign(nextSnapshot, { [key]: value });
			}
		}
		if ('failureMessage' in overrides && overrides.failureMessage === undefined) {
			delete nextSnapshot.failureMessage;
		}
		nextSnapshot.interactionCapabilities = deriveAgentExecutionInteractionCapabilities(nextSnapshot);
		this.liveSnapshot = nextSnapshot;
		return this.getSnapshot();
	}

	public emitEvent(event: AgentExecutionEvent): void {
		if (this.disposed) {
			return;
		}
		this.liveSnapshot = cloneRuntimeSnapshot(event.snapshot);
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	public applySignalDecision(
		decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
	): AgentExecutionSnapshot | void {
		switch (decision.action) {
			case 'emit-message':
				this.emitEvent({
					...decision.event,
					snapshot: this.getSnapshot()
				});
				return this.getSnapshot();
			case 'record-observation-only':
				return this.getSnapshot();
			case 'update-session': {
				const snapshot = this.updateSnapshot(decision.snapshotPatch);
				this.emitEvent(toRuntimeExecutionEvent(decision.eventType, snapshot));
				return snapshot;
			}
		}
	}

	public toRecord(): AgentExecutionRecord {
		return AgentExecution.cloneRecord(this.requireRecord());
	}

	public toEntity(): AgentExecutionDataType {
		return AgentExecution.toDataFromRecord(this.requireRecord());
	}

	public toState(snapshot?: AgentExecutionSnapshot): AgentExecutionState {
		const record = this.requireRecord();
		if (!snapshot) {
			return AgentExecution.cloneState({
				agentId: record.agentId,
				...(record.transportId ? { transportId: record.transportId } : {}),
				adapterLabel: record.adapterLabel,
				sessionId: record.sessionId,
				...(record.terminalHandle ? { terminalHandle: { ...record.terminalHandle } } : {}),
				lifecycleState: record.lifecycleState,
				lastUpdatedAt: record.lastUpdatedAt,
				...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
				...(record.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
				interactionCapabilities: { ...record.interactionCapabilities },
				runtimeMessages: AgentExecution.cloneRuntimeMessages(record.runtimeMessages),
				...(record.scope ? { scope: record.scope } : {}),
				...(record.failureMessage ? { failureMessage: record.failureMessage } : {})
			});
		}

		return AgentExecution.createStateFromSnapshot({
			snapshot,
			adapterLabel: record.adapterLabel,
			record
		});
	}

	public async sendPrompt(prompt: AgentPrompt): Promise<AgentExecution> {
		const nextRecord = await this.requireOwner().sendSessionPrompt(this.sessionId, prompt);
		return new AgentExecution(this.requireOwner(), nextRecord);
	}

	public async sendCommand(command: AgentCommand): Promise<AgentExecution> {
		const nextRecord = await this.requireOwner().sendSessionCommand(this.sessionId, command);
		return new AgentExecution(this.requireOwner(), nextRecord);
	}

	public async done(): Promise<AgentExecution> {
		const nextRecord = await this.requireOwner().completeSessionRecord(this.sessionId);
		return new AgentExecution(this.requireOwner(), nextRecord);
	}

	public async cancel(reason?: string): Promise<AgentExecution> {
		const nextRecord = await this.requireOwner().cancelSessionRecord(this.sessionId, reason);
		return new AgentExecution(this.requireOwner(), nextRecord);
	}

	public async terminate(reason?: string): Promise<AgentExecution> {
		const nextRecord = await this.requireOwner().terminateSessionRecord(this.sessionId, reason);
		return new AgentExecution(this.requireOwner(), nextRecord);
	}

	private requireOwner(): AgentExecutionOwner {
		if (!this.owner) {
			throw new Error(`AgentExecution '${this.sessionId}' is not attached to a Mission owner.`);
		}
		return this.owner;
	}

	private requireRecord(): AgentExecutionRecord {
		if (!this.record) {
			throw new Error(`AgentExecution '${this.sessionId}' is not attached to a Mission session record.`);
		}
		return this.record;
	}

	private requireActiveSnapshot(
		action: string,
		options: { requirePromptAcceptance?: boolean } = {}
	): AgentExecutionSnapshot {
		const snapshot = this.getSnapshot();
		if (AgentExecution.isTerminalFinalStatus(snapshot.status)) {
			throw new Error(`Cannot ${action} for execution '${snapshot.sessionId}' because it is ${snapshot.status}.`);
		}
		if (options.requirePromptAcceptance && !snapshot.acceptsPrompts) {
			throw new Error(`Cannot ${action} for execution '${snapshot.sessionId}' because prompts are disabled.`);
		}
		return snapshot;
	}

	private applyTerminalUpdate(update: AgentExecutionTerminalUpdate): void {
		if (update.chunk) {
			for (const line of splitTerminalLines(update.chunk)) {
				this.emitEvent({
					type: 'execution.message',
					channel: 'stdout',
					text: line,
					snapshot: this.getSnapshot()
				});
			}
		}
		if (!update.dead) {
			return;
		}
		const snapshot = update.exitCode === 0
			? this.updateSnapshot({
				status: 'completed',
				attention: 'none',
				acceptsPrompts: false,
				waitingForInput: false,
				acceptedCommands: [],
				endedAt: new Date().toISOString(),
				progress: {
					state: 'done',
					updatedAt: new Date().toISOString()
				},
				failureMessage: undefined
			})
			: this.updateSnapshot({
				status: 'failed',
				attention: 'none',
				acceptsPrompts: false,
				waitingForInput: false,
				acceptedCommands: [],
				endedAt: new Date().toISOString(),
				progress: {
					state: 'failed',
					updatedAt: new Date().toISOString()
				},
				failureMessage: `terminal command exited with status ${String(update.exitCode)}.`
			});
		this.emitEvent(snapshot.status === 'completed'
			? { type: 'execution.completed', snapshot }
			: { type: 'execution.failed', reason: snapshot.failureMessage ?? 'terminal command failed.', snapshot });
	}

	private static cloneModel(model: MissionAgentModelInfo | undefined): MissionAgentModelInfo | undefined {
		if (!model) {
			return undefined;
		}

		return {
			...(model.id ? { id: model.id } : {}),
			...(model.family ? { family: model.family } : {}),
			...(model.provider ? { provider: model.provider } : {}),
			...(model.displayName ? { displayName: model.displayName } : {})
		};
	}

	private static cloneTelemetry(
		telemetry: MissionAgentTelemetrySnapshot | undefined
	): MissionAgentTelemetrySnapshot | undefined {
		if (!telemetry) {
			return undefined;
		}

		const model = AgentExecution.cloneModel(telemetry.model);

		return {
			...(model ? { model } : {}),
			...(telemetry.providerSessionId ? { providerSessionId: telemetry.providerSessionId } : {}),
			...(telemetry.tokenUsage ? { tokenUsage: { ...telemetry.tokenUsage } } : {}),
			...(telemetry.contextWindow ? { contextWindow: { ...telemetry.contextWindow } } : {}),
			...(telemetry.estimatedCostUsd !== undefined ? { estimatedCostUsd: telemetry.estimatedCostUsd } : {}),
			...(telemetry.activeToolName ? { activeToolName: telemetry.activeToolName } : {}),
			updatedAt: telemetry.updatedAt
		};
	}

	private static cloneScope(scope: MissionAgentScope): MissionAgentScope {
		switch (scope.kind) {
			case 'control':
				return {
					kind: 'control',
					...(scope.workspaceRoot ? { workspaceRoot: scope.workspaceRoot } : {}),
					...(scope.repoName ? { repoName: scope.repoName } : {}),
					...(scope.branch ? { branch: scope.branch } : {})
				};
			case 'mission':
				return {
					kind: 'mission',
					...(scope.missionId ? { missionId: scope.missionId } : {}),
					...(scope.stage ? { stage: scope.stage } : {}),
					...(scope.currentSlice ? { currentSlice: scope.currentSlice } : {}),
					...(scope.readyTaskIds ? { readyTaskIds: [...scope.readyTaskIds] } : {}),
					...(scope.readyTaskTitle ? { readyTaskTitle: scope.readyTaskTitle } : {}),
					...(scope.readyTaskInstruction ? { readyTaskInstruction: scope.readyTaskInstruction } : {})
				};
			case 'artifact':
				return {
					kind: 'artifact',
					artifactKey: scope.artifactKey,
					...(scope.missionId ? { missionId: scope.missionId } : {}),
					...(scope.stage ? { stage: scope.stage } : {}),
					...(scope.artifactPath ? { artifactPath: scope.artifactPath } : {}),
					...(scope.checkpoint ? { checkpoint: scope.checkpoint } : {}),
					...(scope.validation ? { validation: scope.validation } : {})
				};
			case 'slice':
				return {
					kind: 'slice',
					sliceTitle: scope.sliceTitle,
					verificationTargets: [...scope.verificationTargets],
					requiredSkills: [...scope.requiredSkills],
					dependsOn: [...scope.dependsOn],
					...(scope.missionId ? { missionId: scope.missionId } : {}),
					...(scope.missionDir ? { missionDir: scope.missionDir } : {}),
					...(scope.stage ? { stage: scope.stage } : {}),
					...(scope.sliceId ? { sliceId: scope.sliceId } : {}),
					...(scope.taskId ? { taskId: scope.taskId } : {}),
					...(scope.taskTitle ? { taskTitle: scope.taskTitle } : {}),
					...(scope.taskSummary ? { taskSummary: scope.taskSummary } : {}),
					...(scope.taskInstruction ? { taskInstruction: scope.taskInstruction } : {}),
					...(scope.doneWhen ? { doneWhen: [...scope.doneWhen] } : {}),
					...(scope.stopCondition ? { stopCondition: scope.stopCondition } : {})
				};
			case 'gate':
				return {
					kind: 'gate',
					intent: scope.intent,
					...(scope.missionId ? { missionId: scope.missionId } : {}),
					...(scope.stage ? { stage: scope.stage } : {})
				};
		}
	}

	private static requireRecordMissionId(record: AgentExecutionRecord): string {
		const missionId = record.scope && 'missionId' in record.scope && typeof record.scope.missionId === 'string'
			? record.scope.missionId.trim()
			: undefined;
		if (!missionId) {
			throw new Error(`AgentExecution '${record.sessionId}' requires daemon-owned Mission context.`);
		}
		return missionId;
	}

	private static async requireDataForLocator(
		input: { missionId: string; sessionId: string },
		context: EntityExecutionContext
	): Promise<AgentExecutionDataType> {
		const cacheKey = `${input.missionId}:${input.sessionId}`;
		const cached = agentExecutionDataCache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < SESSION_DATA_CACHE_TTL_MS) {
			return cached.data;
		}

		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission(input, context);
		try {
			const data = AgentExecution.requireData(await mission.buildMissionSnapshot(), input.sessionId);
			agentExecutionDataCache.set(cacheKey, { data, timestamp: Date.now() });
			return data;
		} finally {
			mission.dispose();
		}
	}

	private static async readTerminalData(
		workspaceRoot: string,
		missionId: string,
		data: AgentExecutionDataType
	) {
		const terminalHandle = AgentExecution.requireTerminalHandle(data);
		const terminalSnapshot = Terminal.read({
			terminalName: terminalHandle.terminalName,
			terminalPaneId: terminalHandle.terminalPaneId
		});
		let screen = terminalSnapshot.screen;
		if (!terminalSnapshot.connected) {
			const missionDir = AgentExecution.resolveMissionDir(data);
			screen = data.sessionLogPath && missionDir
				? await new MissionDossierFilesystem(workspaceRoot).readMissionSessionLog(missionDir, data.sessionLogPath) ?? ''
				: '';
		}
		return AgentExecutionTerminalSnapshotSchema.parse({
			missionId,
			sessionId: data.sessionId,
			connected: terminalSnapshot.connected,
			dead: terminalSnapshot.dead,
			exitCode: terminalSnapshot.exitCode,
			screen,
			...(typeof terminalSnapshot.chunk === 'string' ? { chunk: terminalSnapshot.chunk } : {}),
			...(terminalSnapshot.truncated ? { truncated: true } : {}),
			terminalHandle: {
				terminalName: terminalHandle.terminalName,
				terminalPaneId: terminalHandle.terminalPaneId,
				...(terminalHandle.sharedTerminalName ? { sharedTerminalName: terminalHandle.sharedTerminalName } : {})
			}
		});
	}

	private static requireTerminalHandle(data: AgentExecutionDataType): AgentExecutionTerminalHandleType {
		if (!data.terminalHandle) {
			throw new Error(`AgentExecution '${data.sessionId}' is not backed by a Terminal.`);
		}
		return data.terminalHandle;
	}

	private static resolveMissionDir(data: AgentExecutionDataType): string | undefined {
		const scope = data.scope;
		if (!scope || typeof scope !== 'object' || !('missionDir' in scope)) {
			return undefined;
		}
		const missionDir = scope.missionDir;
		return typeof missionDir === 'string' && missionDir.trim() ? missionDir.trim() : undefined;
	}

}

function getTerminalFields(snapshot: AgentExecutionSnapshot | undefined): {
	transportId?: string;
	terminalHandle?: AgentExecutionTerminalHandleType;
} {
	if (snapshot?.transport?.kind !== 'terminal') {
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

function cloneRuntimeSnapshot(snapshot: AgentExecutionSnapshot): AgentExecutionSnapshot {
	return {
		...snapshot,
		acceptedCommands: [...snapshot.acceptedCommands],
		...(snapshot.interactionCapabilities ? { interactionCapabilities: { ...snapshot.interactionCapabilities } } : {}),
		progress: {
			...snapshot.progress,
			...(snapshot.progress.units ? { units: { ...snapshot.progress.units } } : {})
		},
		reference: {
			...snapshot.reference,
			...(snapshot.reference.transport ? { transport: { ...snapshot.reference.transport } } : {})
		},
		...(snapshot.transport ? { transport: { ...snapshot.transport } } : {})
	};
}

function getAgentExecutionEntityScopeId(snapshot: AgentExecutionSnapshot): string {
	const raw = snapshot.missionId
		?? (snapshot.scope.kind === 'repository' ? snapshot.scope.repositoryRootPath : undefined)
		?? `${snapshot.scope.kind}:${describeAgentExecutionScope(snapshot.scope)}`;
	return Repository.slugIdentitySegment(raw) || snapshot.scope.kind;
}

function toAgentRuntimeScope(snapshot: AgentExecutionSnapshot): MissionAgentScope | undefined {
	switch (snapshot.scope.kind) {
		case 'system':
			return {
				kind: 'control',
				workspaceRoot: snapshot.workingDirectory
			};
		case 'repository':
			return {
				kind: 'control',
				workspaceRoot: snapshot.scope.repositoryRootPath
			};
		case 'mission':
			return {
				kind: 'mission',
				missionId: snapshot.scope.missionId,
				...(snapshot.stageId ? { stage: snapshot.stageId } : {})
			};
		case 'task':
			return {
				kind: 'slice',
				missionId: snapshot.scope.missionId,
				...(snapshot.stageId ? { stage: snapshot.stageId } : {}),
				taskId: snapshot.scope.taskId,
				sliceTitle: snapshot.taskId ?? snapshot.scope.taskId,
				verificationTargets: [],
				requiredSkills: [],
				dependsOn: []
			};
		case 'artifact':
			return {
				kind: 'artifact',
				artifactKey: snapshot.scope.artifactId,
				...(snapshot.scope.missionId ? { missionId: snapshot.scope.missionId } : {}),
				...(snapshot.stageId ? { stage: snapshot.stageId } : {})
			};
	}
}

function buildFreshAgentExecutionId(scope: AgentExecutionScope, agentId: string): string {
	const scopeSegment = describeAgentExecutionScope(scope).split('/').at(-1)?.trim() || describeAgentExecutionScope(scope).trim();
	const normalizedScopeSegment = Repository.slugIdentitySegment(scopeSegment);
	const normalizedAgentId = Repository.slugIdentitySegment(agentId);
	const suffix = randomUUID().slice(0, 8);
	if (!normalizedScopeSegment) {
		return normalizedAgentId ? `${normalizedAgentId}-${suffix}` : `mission-agent-${suffix}`;
	}
	return normalizedAgentId
		? `${normalizedScopeSegment}-${normalizedAgentId}-${suffix}`
		: `${normalizedScopeSegment}-${suffix}`;
}

function toRuntimeExecutionEvent(
	eventType: 'execution.updated' | 'execution.awaiting-input' | 'execution.completed' | 'execution.failed',
	snapshot: AgentExecutionSnapshot
): AgentExecutionEvent {
	switch (eventType) {
		case 'execution.updated':
			return { type: 'execution.updated', snapshot };
		case 'execution.awaiting-input':
			return { type: 'execution.awaiting-input', snapshot };
		case 'execution.completed':
			return { type: 'execution.completed', snapshot };
		case 'execution.failed':
			return {
				type: 'execution.failed',
				reason: snapshot.failureMessage ?? snapshot.progress.detail ?? 'Agent execution failed.',
				snapshot
			};
	}
}

function buildCommandPrompt(command: Exclude<AgentCommand, { type: 'interrupt' }>): AgentPrompt {
	switch (command.type) {
		case 'resume':
			return { source: 'system', text: command.reason?.trim() || 'Resume execution.' };
		case 'checkpoint':
			return {
				source: 'system',
				text: command.reason?.trim() || 'Provide a concise checkpoint, then continue with the task.'
			};
		case 'nudge':
			return { source: 'system', text: command.reason?.trim() || 'Continue with the assigned task.' };
	}
}

function splitTerminalLines(text: string): string[] {
	return text
		.split('\n')
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);
}

async function loadMissionRegistry(context: EntityExecutionContext) {
	const { requireMissionRegistry } = await import('../../daemon/MissionRegistry.js');
	return requireMissionRegistry(context);
}
