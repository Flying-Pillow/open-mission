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
	AgentExecutionSnapshot,
	AgentExecutionObservation
} from './AgentExecutionProtocolTypes.js';
import {
	deriveAgentExecutionInteractionCapabilities,
	describeAgentExecutionScope,
	type AgentExecutionSignalDecision
} from './AgentExecutionProtocolTypes.js';
import { createAgentExecutionProtocolDescriptor } from './AgentExecutionProtocolDescriptor.js';
import { createEntityId, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import type { MissionTaskState } from '../Mission/MissionSchema.js';
import { Repository } from '../Repository/Repository.js';
import type {
	AgentExecutionLaunchRequest,
	AgentExecutionRecord,
	AgentExecutionState
} from './AgentExecutionSchema.js';
import {
	AgentExecutionCommandAcknowledgementSchema,
	AgentExecutionCommandInputSchema,
	AgentExecutionContextSchema,
	AgentExecutionChatMessageSchema,
	AgentExecutionMessageDescriptorSchema,
	AgentExecutionLocatorSchema,
	AgentExecutionPromptSchema,
	AgentExecutionCommandSchema,
	AgentExecutionSendTerminalInputSchema,
	AgentExecutionTerminalRecordingSchema,
	AgentExecutionTerminalSnapshotSchema,
	AgentExecutionDataSchema,
	AgentExecutionCommandIds,
	agentExecutionEntityName,
	type AgentDeclaredSignalInputChoiceType,
	type AgentExecutionChatMessageType,
	type AgentExecutionCommandType,
	type AgentExecutionMessageDescriptorType,
	type AgentExecutionProtocolDescriptorType,
	type AgentExecutionContextType,
	type AgentExecutionInteractionCapabilitiesType,
	type AgentExecutionPromptType,
	type AgentExecutionTerminalHandleType,
	type AgentExecutionDataType
} from './AgentExecutionSchema.js';
import type { MissionSnapshotType } from '../Mission/MissionSchema.js';
import { MissionDossierFilesystem } from '../Mission/MissionDossierFilesystem.js';
import { Terminal } from '../Terminal/Terminal.js';

type LocatedAgentExecutionData = {
	data: AgentExecutionDataType;
	missionDir: string;
};

const agentExecutionDataCache = new Map<string, { located: LocatedAgentExecutionData; timestamp: number }>();
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

	public static createEntityId(scopeId: string, sessionId: string): string {
		return createEntityId('agent_execution', `${scopeId}/${sessionId}`);
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
		const scopeId = AgentExecution.requireRecordScopeId(record);
		return AgentExecutionDataSchema.parse({
			id: AgentExecution.createEntityId(scopeId, record.sessionId),
			ownerId: AgentExecution.requireRecordOwnerId(record),
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
			...(record.protocolDescriptor ? { protocolDescriptor: AgentExecution.cloneProtocolDescriptor(record.protocolDescriptor) } : {}),
			...(record.scope ? { scope: record.scope } : {}),
			...(record.telemetry ? { telemetry: record.telemetry } : {}),
			createdAt: record.createdAt,
			lastUpdatedAt: record.lastUpdatedAt,
			...(record.failureMessage ? { failureMessage: record.failureMessage } : {})
		});
	}

	public static async read(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionLocatorSchema.parse(payload);
		return (await AgentExecution.requireDataForOwner(input, context)).data;
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
		return new AgentExecution((await AgentExecution.requireDataForOwner(input, context)).data);
	}

	public static async readTerminal(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionLocatorSchema.parse(payload);
		const located = await AgentExecution.requireDataForOwner(input, context);
		return AgentExecution.readTerminalData(input.ownerId, located.missionDir, located.data);
	}


	public async command(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionCommandInputSchema.parse(payload);
		const liveRegistryData = AgentExecution.readRegistryExecution(input, context);
		if (liveRegistryData) {
			await AgentExecution.requireRegistry(context).commandExecution(input.sessionId, {
				commandId: input.commandId,
				...(input.input !== undefined ? { input: input.input } : {})
			});
			return AgentExecutionCommandAcknowledgementSchema.parse({
				ok: true,
				entity: agentExecutionEntityName,
				method: 'command',
				id: input.sessionId,
				ownerId: input.ownerId,
				sessionId: input.sessionId,
				commandId: input.commandId
			});
		}
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission({ missionId: input.ownerId }, context);
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
				ownerId: input.ownerId,
				sessionId: input.sessionId,
				commandId: input.commandId
			});
		} finally {
			mission.dispose();
		}
	}

	public static async sendTerminalInput(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionSendTerminalInputSchema.parse(payload);
		const located = await AgentExecution.requireDataForOwner(input, context);
		const terminalHandle = AgentExecution.requireTerminalHandle(located.data);
		Terminal.sendInput({
			terminalName: terminalHandle.terminalName,
			terminalPaneId: terminalHandle.terminalPaneId,
			...(input.data !== undefined ? { data: input.data } : {}),
			...(input.literal !== undefined ? { literal: input.literal } : {}),
			...(input.cols !== undefined ? { cols: input.cols } : {}),
			...(input.rows !== undefined ? { rows: input.rows } : {})
		}, context);
		return AgentExecution.readTerminalData(input.ownerId, located.missionDir, located.data);
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
			{ type: 'interrupt', label: 'Interrupt', icon: 'lucide:pause', tone: 'attention', delivery: 'best-effort', mutatesContext: false },
			{ type: 'checkpoint', label: 'Checkpoint', icon: 'lucide:milestone', tone: 'neutral', delivery: 'best-effort', mutatesContext: false },
			{ type: 'nudge', label: 'Nudge', icon: 'lucide:message-circle-more', tone: 'progress', delivery: 'best-effort', mutatesContext: false },
			{ type: 'resume', label: 'Resume', icon: 'lucide:play', tone: 'success', delivery: 'best-effort', mutatesContext: false }
		].filter((descriptor) => commandTypes.includes(descriptor.type as AgentCommand['type'])));
	}

	public static createProtocolDescriptorForSnapshot(snapshot: AgentExecutionSnapshot): AgentExecutionProtocolDescriptorType {
		return createAgentExecutionProtocolDescriptor({
			scope: snapshot.scope,
			messages: AgentExecution.resolveRuntimeMessages({
				lifecycleState: snapshot.status,
				acceptsPrompts: snapshot.acceptsPrompts,
				acceptedCommands: snapshot.acceptedCommands
			})
		});
	}

	public static buildTaskScope(
		task: MissionTaskState,
		missionId?: string
	): AgentExecutionScope {
		if (missionId && task.taskId) {
			return {
				kind: 'task',
				missionId,
				taskId: task.taskId,
				...(task.stage ? { stageId: task.stage } : {})
			};
		}
		if (missionId) {
			return { kind: 'mission', missionId };
		}
		return { kind: 'system', ...(task.subject ? { label: task.subject } : {}) };
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
			? AgentExecution.buildTaskScope(input.task, input.missionId)
			: undefined;
		const terminalFields = getTerminalFields(input.snapshot);
		const protocolDescriptor = input.snapshot
			? AgentExecution.createProtocolDescriptorForSnapshot(input.snapshot)
			: undefined;

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
			...(protocolDescriptor ? { protocolDescriptor } : {}),
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
		const protocolDescriptor = AgentExecution.createProtocolDescriptorForSnapshot(snapshot);
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
			protocolDescriptor,
			...(record?.scope ? { scope: record.scope } : {}),
			...(snapshot.failureMessage
				? { failureMessage: snapshot.failureMessage }
				: record?.failureMessage
					? { failureMessage: record.failureMessage }
					: {})
		});
	}

	public static cloneRecord(record: AgentExecutionRecord): AgentExecutionRecord {
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
			...(record.protocolDescriptor ? { protocolDescriptor: AgentExecution.cloneProtocolDescriptor(record.protocolDescriptor) } : {}),
			...(record.scope ? { scope: { ...record.scope } } : {}),
			...(record.telemetry ? { telemetry: cloneStructured(record.telemetry) } : {}),
			...(record.failureMessage ? { failureMessage: record.failureMessage } : {})
		};
	}

	public static cloneState(state: AgentExecutionState): AgentExecutionState {
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
			...(state.protocolDescriptor ? { protocolDescriptor: AgentExecution.cloneProtocolDescriptor(state.protocolDescriptor) } : {}),
			...(state.scope ? { scope: { ...state.scope } } : {}),
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
			...(state.telemetry ? { telemetry: cloneStructured(state.telemetry) } : {}),
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

	private static cloneProtocolDescriptor(
		protocolDescriptor: AgentExecutionProtocolDescriptorType
	): AgentExecutionProtocolDescriptorType {
		return {
			version: protocolDescriptor.version,
			owner: { ...protocolDescriptor.owner },
			scope: { ...protocolDescriptor.scope },
			messages: AgentExecution.cloneRuntimeMessages(protocolDescriptor.messages),
			signals: protocolDescriptor.signals.map((descriptor) => ({
				...descriptor,
				outcomes: [...descriptor.outcomes]
			}))
		};
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

	private readonly listeners = new Set<(event: AgentExecutionEvent) => void>();
	private readonly dataChangeListeners = new Set<(data: AgentExecutionDataType) => void>();
	private chatMessages: AgentExecutionChatMessageType[] = [];
	private liveSnapshot: AgentExecutionSnapshot | undefined;
	private disposed = false;

	public static createLive(snapshot: AgentExecutionSnapshot): AgentExecution {
		const execution = new AgentExecution(AgentExecution.toDataFromRuntimeSnapshot(snapshot));
		execution.liveSnapshot = cloneRuntimeSnapshot(snapshot);
		return execution;
	}

	private static toDataFromRuntimeSnapshot(snapshot: AgentExecutionSnapshot): AgentExecutionDataType {
		return AgentExecutionDataSchema.parse({
			id: AgentExecution.createEntityId(getAgentExecutionEntityScopeId(snapshot), snapshot.sessionId),
			ownerId: getAgentExecutionOwnerId(snapshot.scope),
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
			protocolDescriptor: AgentExecution.createProtocolDescriptorForSnapshot(snapshot),
			scope: { ...snapshot.scope },
			createdAt: snapshot.startedAt,
			lastUpdatedAt: snapshot.updatedAt,
			...(snapshot.failureMessage ? { failureMessage: snapshot.failureMessage } : {})
		});
	}

	public constructor(data: AgentExecutionDataType) {
		super(AgentExecutionDataSchema.parse(data));
		this.chatMessages = cloneChatMessages(this.data.chatMessages);
	}

	public override updateFromData(data: AgentExecutionDataType): this {
		super.updateFromData(data);
		this.chatMessages = cloneChatMessages(this.data.chatMessages);
		return this;
	}

	public override toData(): AgentExecutionDataType {
		return AgentExecutionDataSchema.parse({
			...super.toData(),
			chatMessages: cloneChatMessages(this.chatMessages)
		});
	}

	public get id(): string {
		return this.sessionId;
	}

	public get sessionId(): string {
		return this.toData().sessionId;
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

	public onDidDataChange(listener: (data: AgentExecutionDataType) => void): { dispose(): void } {
		this.dataChangeListeners.add(listener);
		return {
			dispose: () => {
				this.dataChangeListeners.delete(listener);
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
		if (prompt.source === 'operator') {
			this.appendChatMessage({
				id: createChatMessageId(snapshot.sessionId, snapshot.updatedAt, 'operator', prompt.text),
				role: 'operator',
				kind: 'message',
				tone: 'neutral',
				text: prompt.text,
				at: snapshot.updatedAt
			});
		}
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
		this.appendChatMessageFromEvent(event);
		this.liveSnapshot = cloneRuntimeSnapshot(event.snapshot);
		for (const listener of this.listeners) {
			listener(event);
		}
		this.notifyDataChanged();
	}

	public applySignalObservation(
		observation: AgentExecutionObservation,
		decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
	): AgentExecutionSnapshot | void {
		const appendedChatMessage = this.appendChatMessageFromObservation(observation, decision);
		const snapshot = this.applySignalDecision(decision);
		if (appendedChatMessage && decision.action === 'record-observation-only') {
			this.notifyDataChanged();
		}
		return snapshot;
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

	private appendChatMessageFromObservation(
		observation: AgentExecutionObservation,
		decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
	): boolean {
		const signal = observation.signal;
		if (signal.type === 'diagnostic' || signal.type === 'usage' || signal.type === 'message' || decision.action === 'emit-message') {
			return false;
		}

		const base = {
			id: observation.observationId,
			role: 'agent' as const,
			signalType: signal.type,
			at: observation.observedAt
		};

		switch (signal.type) {
			case 'progress':
				return this.appendChatMessage({ ...base, kind: 'progress', tone: 'progress', title: 'Progress', text: signal.summary, ...(signal.detail ? { detail: signal.detail } : {}) });
			case 'needs_input':
				return this.appendChatMessage({ ...base, kind: 'needs-input', tone: 'attention', title: 'Needs input', text: signal.question, choices: cloneInputChoices(signal.choices) });
			case 'blocked':
				return this.appendChatMessage({ ...base, kind: 'blocked', tone: 'danger', title: 'Blocked', text: signal.reason });
			case 'ready_for_verification':
				return this.appendChatMessage({ ...base, kind: 'claim', tone: 'success', title: 'Ready for verification', text: signal.summary });
			case 'completed_claim':
				return this.appendChatMessage({ ...base, kind: 'claim', tone: 'success', title: 'Completed claim', text: signal.summary });
			case 'failed_claim':
				return this.appendChatMessage({ ...base, kind: 'failure', tone: 'danger', title: 'Failed claim', text: signal.reason });
		}
		return false;
	}

	private appendChatMessageFromEvent(event: AgentExecutionEvent): boolean {
		if (event.type === 'execution.message' && event.channel === 'agent') {
			return this.appendChatMessage({
				id: createChatMessageId(event.snapshot.sessionId, event.snapshot.updatedAt, event.channel, event.text),
				role: 'agent',
				kind: 'message',
				tone: 'neutral',
				text: event.text,
				at: event.snapshot.updatedAt
			});
		}
		if (event.type === 'execution.completed' && event.snapshot.progress.summary) {
			return this.appendChatMessage({
				id: createChatMessageId(event.snapshot.sessionId, event.snapshot.updatedAt, 'completed'),
				role: 'system',
				kind: 'status',
				tone: 'success',
				title: 'Completed',
				text: event.snapshot.progress.summary,
				at: event.snapshot.updatedAt
			});
		}
		if (event.type === 'execution.failed') {
			return this.appendChatMessage({
				id: createChatMessageId(event.snapshot.sessionId, event.snapshot.updatedAt, 'failed'),
				role: 'system',
				kind: 'failure',
				tone: 'danger',
				title: 'Failed',
				text: event.reason,
				at: event.snapshot.updatedAt
			});
		}
		return false;
	}

	private appendChatMessage(message: AgentExecutionChatMessageType): boolean {
		const parsed = AgentExecutionChatMessageSchema.parse(message);
		if (this.chatMessages.some((existing) => existing.id === parsed.id)) {
			return false;
		}
		this.chatMessages = [...this.chatMessages, parsed];
		this.data = AgentExecutionDataSchema.parse({
			...super.toData(),
			chatMessages: cloneChatMessages(this.chatMessages),
			lastUpdatedAt: parsed.at
		});
		return true;
	}

	private notifyDataChanged(): void {
		if (this.disposed) {
			return;
		}
		const data = this.toData();
		for (const listener of this.dataChangeListeners) {
			listener(data);
		}
	}

	public toRecord(): AgentExecutionRecord {
		const data = this.toData();
		return AgentExecution.cloneRecord({
			sessionId: data.sessionId,
			agentId: data.agentId,
			...(data.transportId ? { transportId: data.transportId } : {}),
			...(data.sessionLogPath ? { sessionLogPath: data.sessionLogPath } : {}),
			...(data.terminalHandle ? { terminalHandle: { ...data.terminalHandle } } : {}),
			adapterLabel: data.adapterLabel,
			lifecycleState: data.lifecycleState,
			...(data.taskId ? { taskId: data.taskId } : {}),
			...(data.assignmentLabel ? { assignmentLabel: data.assignmentLabel } : {}),
			...(data.workingDirectory ? { workingDirectory: data.workingDirectory } : {}),
			...(data.currentTurnTitle ? { currentTurnTitle: data.currentTurnTitle } : {}),
			interactionCapabilities: { ...data.interactionCapabilities },
			runtimeMessages: AgentExecution.cloneRuntimeMessages(data.runtimeMessages),
			...(data.protocolDescriptor ? { protocolDescriptor: AgentExecution.cloneProtocolDescriptor(data.protocolDescriptor) } : {}),
			...(data.scope ? { scope: { ...data.scope } } : {}),
			...(data.telemetry ? { telemetry: cloneStructured(data.telemetry) } : {}),
			...(data.failureMessage ? { failureMessage: data.failureMessage } : {}),
			createdAt: data.createdAt ?? data.lastUpdatedAt ?? new Date().toISOString(),
			lastUpdatedAt: data.lastUpdatedAt ?? data.createdAt ?? new Date().toISOString()
		});
	}

	public toEntity(): AgentExecutionDataType {
		return AgentExecutionDataSchema.parse(this.toData());
	}

	public toState(snapshot?: AgentExecutionSnapshot): AgentExecutionState {
		const record = this.toRecord();
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
				...(record.protocolDescriptor ? { protocolDescriptor: AgentExecution.cloneProtocolDescriptor(record.protocolDescriptor) } : {}),
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

	private static requireRegistry(context: EntityExecutionContext) {
		if (!context.agentExecutionRegistry) {
			throw new Error('AgentExecutionRegistry is not available in the daemon execution context.');
		}
		return context.agentExecutionRegistry;
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

	private static requireRecordScopeId(record: AgentExecutionRecord): string {
		if (record.scope?.kind === 'repository') {
			return Repository.slugIdentitySegment(record.scope.repositoryRootPath) || record.scope.repositoryRootPath;
		}
		if (record.scope?.kind === 'mission' || record.scope?.kind === 'task') {
			return record.scope.missionId;
		}
		if (record.scope?.kind === 'artifact') {
			return record.scope.artifactId;
		}
		if (record.scope?.kind === 'system') {
			return record.scope.label ?? 'system';
		}
		throw new Error(`AgentExecution '${record.sessionId}' requires an AgentExecutionScope.`);
	}

	private static requireRecordOwnerId(record: AgentExecutionRecord): string {
		if (record.scope?.kind === 'repository') {
			return record.scope.repositoryRootPath;
		}
		if (record.scope?.kind === 'mission' || record.scope?.kind === 'task') {
			return record.scope.missionId;
		}
		if (record.scope?.kind === 'artifact') {
			return record.scope.artifactId;
		}
		if (record.scope?.kind === 'system') {
			return record.scope.label ?? 'system';
		}
		throw new Error(`AgentExecution '${record.sessionId}' requires an AgentExecutionScope.`);
	}

	private static readRegistryExecution(
		input: { ownerId: string; sessionId: string },
		context: EntityExecutionContext
	): AgentExecutionDataType | undefined {
		if (!context.agentExecutionRegistry?.hasExecution(input.sessionId)) {
			return undefined;
		}
		const data = context.agentExecutionRegistry.readExecution(input.sessionId);
		AgentExecution.assertOwnerMatches(input, data);
		return data;
	}

	private static async requireDataForOwner(
		input: { ownerId: string; sessionId: string },
		context: EntityExecutionContext
	): Promise<LocatedAgentExecutionData> {
		const registryData = AgentExecution.readRegistryExecution(input, context);
		if (registryData) {
			return { data: registryData, missionDir: context.surfacePath };
		}

		const cacheKey = `${input.ownerId}:${input.sessionId}`;
		const cached = agentExecutionDataCache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < SESSION_DATA_CACHE_TTL_MS) {
			return cached.located;
		}

		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission({ missionId: input.ownerId }, context);
		try {
			const data = AgentExecution.requireData(await mission.buildMissionSnapshot(), input.sessionId);
			AgentExecution.assertOwnerMatches(input, data);
			const located = {
				data,
				missionDir: mission.getMissionDir()
			};
			agentExecutionDataCache.set(cacheKey, { located, timestamp: Date.now() });
			return located;
		} finally {
			mission.dispose();
		}
	}

	private static assertOwnerMatches(input: { ownerId: string; sessionId: string }, data: AgentExecutionDataType): void {
		if (data.ownerId !== input.ownerId) {
			throw new Error(`AgentExecution '${input.sessionId}' belongs to owner '${data.ownerId}', not '${input.ownerId}'.`);
		}
	}

	private static async readTerminalData(
		ownerId: string,
		missionDir: string | undefined,
		data: AgentExecutionDataType
	) {
		const terminalHandle = AgentExecution.requireTerminalHandle(data);
		const terminalSnapshot = Terminal.read({
			terminalName: terminalHandle.terminalName,
			terminalPaneId: terminalHandle.terminalPaneId
		});
		let screen = terminalSnapshot.screen;
		let recording: unknown;
		if (!terminalSnapshot.connected && missionDir) {
			const dossierFilesystem = new MissionDossierFilesystem(Repository.getRepositoryRootFromMissionDir(missionDir));
			const events = data.sessionLogPath && missionDir
				? await dossierFilesystem.readMissionSessionLogEvents(missionDir, data.sessionLogPath) ?? []
				: [];
			recording = events.length > 0
				? AgentExecutionTerminalRecordingSchema.parse({ version: 1, events })
				: undefined;
			screen = '';
		}
		return AgentExecutionTerminalSnapshotSchema.parse({
			ownerId,
			sessionId: data.sessionId,
			connected: terminalSnapshot.connected,
			dead: terminalSnapshot.dead,
			exitCode: terminalSnapshot.exitCode,
			...(terminalSnapshot.cols ? { cols: terminalSnapshot.cols } : {}),
			...(terminalSnapshot.rows ? { rows: terminalSnapshot.rows } : {}),
			screen,
			...(typeof terminalSnapshot.chunk === 'string' ? { chunk: terminalSnapshot.chunk } : {}),
			...(terminalSnapshot.truncated ? { truncated: true } : {}),
			...(recording ? { recording } : {}),
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

function getAgentExecutionOwnerId(scope: AgentExecutionScope): string {
	switch (scope.kind) {
		case 'system':
			return scope.label?.trim() || 'system';
		case 'repository':
			return scope.repositoryRootPath;
		case 'mission':
		case 'task':
			return scope.missionId;
		case 'artifact':
			return scope.artifactId;
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

function cloneStructured<T>(input: T): T {
	return JSON.parse(JSON.stringify(input)) as T;
}

function cloneChatMessages(messages: AgentExecutionChatMessageType[]): AgentExecutionChatMessageType[] {
	return messages.map((message) => AgentExecutionChatMessageSchema.parse({
		...message,
		...(message.choices ? { choices: cloneInputChoices(message.choices) } : {})
	}));
}

function cloneInputChoices(choices: AgentDeclaredSignalInputChoiceType[]): AgentDeclaredSignalInputChoiceType[] {
	return choices.map((choice) => ({ ...choice }));
}

function createChatMessageId(sessionId: string, at: string, kind: string, text = ''): string {
	const normalizedText = Repository.slugIdentitySegment(text).slice(0, 32);
	return [sessionId, at, kind, normalizedText].filter(Boolean).join(':');
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
