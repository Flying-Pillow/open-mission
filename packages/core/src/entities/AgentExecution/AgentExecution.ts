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
	AgentExecutionObservation,
	AgentExecutionProcess
} from './protocol/AgentExecutionProtocolTypes.js';
import {
	deriveAgentExecutionInteractionCapabilities,
	describeAgentExecutionScope,
	isTerminalFinalStatus as isAgentExecutionTerminalFinalStatus,
	type AgentExecutionSignalDecision
} from './protocol/AgentExecutionProtocolTypes.js';
import { createAgentExecutionProtocolDescriptor } from './protocol/AgentExecutionProtocolDescriptor.js';
import { createEntityId, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import type { TaskDossierRecordType } from '../Task/TaskSchema.js';
import { Repository } from '../Repository/Repository.js';
import type {
	AgentExecutionLaunchRequestType,
	AgentExecutionRecordType,
	AgentExecutionStateType
} from './AgentExecutionSchema.js';
import {
	AgentExecutionCommandAcknowledgementSchema,
	AgentExecutionContextSchema,
	AgentExecutionSchema,
	type AgentExecutionContextType,
	type AgentExecutionType
} from './AgentExecutionSchema.js';
import {
	AgentExecutionCommandInputSchema,
	AgentExecutionMessageShorthandResolutionSchema,
	AgentExecutionMessageDescriptorSchema,
	AgentExecutionLocatorSchema,
	AgentExecutionPromptSchema,
	AgentExecutionResolveMessageShorthandInputSchema,
	AgentExecutionInvokeSemanticOperationInputSchema,
	AgentExecutionCommandSchema,
	AgentExecutionSendTerminalInputSchema,
	AgentExecutionCommandIds,
	agentExecutionEntityName,
	type AgentExecutionMessageDescriptorType,
	type AgentExecutionProtocolDescriptorType,
	type AgentExecutionInteractionCapabilitiesType
} from './protocol/AgentExecutionProtocolSchema.js';
import { AgentExecutionSemanticOperationResultSchema } from './protocol/AgentExecutionSemanticOperationSchema.js';
import {
	AgentExecutionProjectionSchema,
	AgentExecutionTimelineItemSchema,
	type AgentExecutionAttentionProjectionType,
	type AgentExecutionActivityProjectionType,
	type AgentExecutionProjectionType,
	type AgentExecutionTimelineItemType
} from './state/AgentExecutionProjectionSchema.js';
import {
	AgentExecutionTerminalRecordingSchema,
	AgentExecutionTerminalSnapshotSchema,
	type AgentExecutionTerminalHandleType
} from './state/AgentExecutionTransportSchema.js';
import {
	type AgentExecutionTransportStateType,
	type AgentExecutionLiveActivityType,
	type AgentExecutionActivityStateType
} from './state/AgentExecutionStateSchema.js';
import type { MissionType } from '../Mission/MissionSchema.js';
import { MissionDossierFilesystem } from '../Mission/MissionDossierFilesystem.js';
import { Terminal } from '../Terminal/Terminal.js';
import { hydrateAgentExecutionDataFromJournal } from './journal/AgentExecutionJournalReplayer.js';
import { AgentExecutionJournalFileStore } from './journal/AgentExecutionJournalFileStore.js';
import { createAgentExecutionJournalReference } from './journal/AgentExecutionJournalWriter.js';
import { deriveActivityStateFromProgressState } from './state/AgentExecutionActivitySemantics.js';
import { projectAgentExecutionObservationSignalToTimelineItem } from './protocol/AgentExecutionSignalRegistry.js';
import type { AgentExecutionJournalRecordType } from './journal/AgentExecutionJournalSchema.js';
import { resolveAgentExecutionMessageShorthand } from './protocol/AgentExecutionMessageShorthand.js';

type LocatedAgentExecutionData = {
	data: AgentExecutionType;
	missionDir: string;
};

const agentExecutionDataCache = new Map<string, { located: LocatedAgentExecutionData; timestamp: number }>();
const AGENT_EXECUTION_DATA_CACHE_TTL_MS = 5_000;

type AgentExecutionLaunchRecord = {
	agentExecutionId: string;
	agentId: string;
	transportId?: string | undefined;
	agentJournalPath?: string | undefined;
	terminalRecordingPath?: string | undefined;
	terminalHandle?: AgentExecutionTerminalHandleType | undefined;
	taskId: string;
	lifecycle: AgentExecutionRecordType['lifecycleState'];
	launchedAt: string;
	updatedAt: string;
};

type Patch = Omit<Partial<AgentExecutionProcess>, 'failureMessage'> & {
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

export class AgentExecution extends Entity<AgentExecutionType, string> {
	public static override readonly entityName = agentExecutionEntityName;

	public static createEntityId(scopeId: string, agentExecutionId: string): string {
		return createEntityId('agent_execution', `${scopeId}/${agentExecutionId}`);
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

	public static toDataFromRecord(record: AgentExecutionRecordType): AgentExecutionType {
		const scopeId = AgentExecution.requireRecordScopeId(record);
		return AgentExecutionSchema.parse({
			id: AgentExecution.createEntityId(scopeId, record.agentExecutionId),
			ownerId: AgentExecution.requireRecordOwnerId(record),
			agentExecutionId: record.agentExecutionId,
			agentId: record.agentId,
			...(record.transportId ? { transportId: record.transportId } : {}),
			...(record.agentJournalPath ? { agentJournalPath: record.agentJournalPath } : {}),
			...(record.terminalRecordingPath ? { terminalRecordingPath: record.terminalRecordingPath } : {}),
			adapterLabel: record.adapterLabel,
			lifecycleState: record.lifecycleState,
			...(record.attention ? { attention: record.attention } : {}),
			...(record.activityState ? { activityState: record.activityState } : {}),
			...(record.currentInputRequestId !== undefined ? { currentInputRequestId: record.currentInputRequestId } : {}),
			...(record.awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId: record.awaitingResponseToMessageId } : {}),
			...(record.terminalHandle ? { terminalHandle: { ...record.terminalHandle } } : {}),
			...(record.taskId ? { taskId: record.taskId } : {}),
			...(record.assignmentLabel ? { assignmentLabel: record.assignmentLabel } : {}),
			...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
			...(record.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
			interactionCapabilities: { ...record.interactionCapabilities },
			context: AgentExecution.createContext(record),
			supportedMessages: AgentExecution.cloneSupportedMessages(record.supportedMessages),
			...(record.protocolDescriptor ? { protocolDescriptor: AgentExecution.cloneProtocolDescriptor(record.protocolDescriptor) } : {}),
			...(record.transportState ? { transportState: AgentExecution.cloneTransportState(record.transportState) } : {}),
			...(record.scope ? { scope: record.scope } : {}),
			...(record.liveActivity ? { liveActivity: cloneStructured(record.liveActivity) } : {}),
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

	public static requireData(data: MissionType, agentExecutionId: string) {
		const AgentExecution = data.agentExecutions.find((candidate) => candidate.agentExecutionId === agentExecutionId);
		if (!AgentExecution) {
			throw new Error(`AgentExecution '${agentExecutionId}' could not be resolved in Mission '${data.missionId}'.`);
		}
		return AgentExecutionSchema.parse(AgentExecution);
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

	public static async resolveMessageShorthand(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionResolveMessageShorthandInputSchema.parse(payload);
		const located = await AgentExecution.requireDataForOwner(input, context);
		const protocolDescriptor = located.data.protocolDescriptor
			?? (located.data.scope
				? createAgentExecutionProtocolDescriptor({
					scope: located.data.scope,
					messages: located.data.supportedMessages
				})
				: undefined);
		if (!protocolDescriptor) {
			throw new Error(`AgentExecution '${input.agentExecutionId}' does not expose a protocol descriptor for message shorthand resolution.`);
		}
		return AgentExecutionMessageShorthandResolutionSchema.parse(resolveAgentExecutionMessageShorthand({
			text: input.text,
			protocolDescriptor,
			...(input.terminalLane !== undefined ? { terminalLane: input.terminalLane } : {})
		}));
	}

	public static async invokeSemanticOperation(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionInvokeSemanticOperationInputSchema.parse(payload);
		AgentExecution.readRegistryExecution(input, context);
		return AgentExecutionSemanticOperationResultSchema.parse(await AgentExecution.requireRegistry(context).invokeSemanticOperation({
			agentExecutionId: input.agentExecutionId,
			name: input.name,
			input: input.input
		}));
	}


	public async command(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionCommandInputSchema.parse(payload);
		const liveRegistryData = AgentExecution.readRegistryExecution(input, context);
		if (liveRegistryData) {
			await AgentExecution.requireRegistry(context).commandExecution(input.agentExecutionId, {
				commandId: input.commandId,
				...(input.input !== undefined ? { input: input.input } : {})
			});
			return AgentExecutionCommandAcknowledgementSchema.parse({
				ok: true,
				entity: agentExecutionEntityName,
				method: 'command',
				id: input.agentExecutionId,
				ownerId: input.ownerId,
				agentExecutionId: input.agentExecutionId,
				commandId: input.commandId
			});
		}
		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission({ missionId: input.ownerId }, context);
		try {
			AgentExecution.requireData(await mission.buildMission(), input.agentExecutionId);
			switch (input.commandId) {
				case AgentExecutionCommandIds.complete:
					await mission.completeAgentExecution(input.agentExecutionId);
					break;
				case AgentExecutionCommandIds.cancel:
					await mission.cancelAgentExecution(input.agentExecutionId, AgentExecution.getReason(input.input));
					break;
				case AgentExecutionCommandIds.sendPrompt:
					await mission.sendAgentExecutionPrompt(
						input.agentExecutionId,
						AgentExecutionPromptSchema.parse(input.input)
					);
					break;
				case AgentExecutionCommandIds.sendRuntimeMessage:
					await mission.sendAgentExecutionCommand(
						input.agentExecutionId,
						AgentExecutionCommandSchema.parse(input.input)
					);
					break;
				default:
					throw new Error(`AgentExecution command '${input.commandId}' is not implemented in the daemon.`);
			}
			return AgentExecutionCommandAcknowledgementSchema.parse({
				ok: true,
				entity: agentExecutionEntityName,
				method: 'command',
				id: input.agentExecutionId,
				ownerId: input.ownerId,
				agentExecutionId: input.agentExecutionId,
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
		AgentExecution: AgentExecutionRecordType;
		request: AgentExecutionLaunchRequestType;
		resolveLiveAgentExecution(): Promise<AgentExecutionType | undefined>;
	}): Promise<boolean> {
		try {
			const liveAgentExecution = await input.resolveLiveAgentExecution();
			if (!liveAgentExecution || AgentExecution.isTerminalFinalStatus(liveAgentExecution.status)) {
				return false;
			}
			if (liveAgentExecution.taskId !== input.request.taskId) {
				return false;
			}
			if (liveAgentExecution.agentId !== input.request.agentId) {
				return false;
			}
			if (liveAgentExecution.workingDirectory && liveAgentExecution.workingDirectory !== input.request.workingDirectory) {
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

	public static isTerminalFinalStatus(status: AgentExecutionProcess['status']): boolean {
		return isAgentExecutionTerminalFinalStatus(status);
	}

	public static createContext(record: AgentExecutionRecordType): AgentExecutionContextType {
		return AgentExecutionContextSchema.parse({
			artifacts: record.assignmentLabel
				? [{ id: record.assignmentLabel, role: 'instruction', order: 0, title: record.currentTurnTitle ?? record.assignmentLabel }]
				: [],
			instructions: record.currentTurnTitle
				? [{ instructionId: `${record.agentExecutionId}:turn-title`, text: record.currentTurnTitle, order: 0 }]
				: []
		});
	}

	public static createSupportedMessages(): AgentExecutionMessageDescriptorType[] {
		return AgentExecution.createSupportedMessagesForCommands(['interrupt', 'checkpoint', 'nudge', 'resume']);
	}

	public static createSupportedMessagesForCommands(
		commandTypes: AgentCommand['type'][]
	): AgentExecutionMessageDescriptorType[] {
		return AgentExecutionMessageDescriptorSchema.array().parse([
			{ type: 'interrupt', label: 'Interrupt', icon: 'lucide:pause', tone: 'attention', delivery: 'best-effort', mutatesContext: false, portability: 'cross-agent' },
			{ type: 'checkpoint', label: 'Checkpoint', icon: 'lucide:milestone', tone: 'neutral', delivery: 'best-effort', mutatesContext: false, portability: 'cross-agent' },
			{ type: 'nudge', label: 'Nudge', icon: 'lucide:message-circle-more', tone: 'progress', delivery: 'best-effort', mutatesContext: false, portability: 'cross-agent' },
			{ type: 'resume', label: 'Resume', icon: 'lucide:play', tone: 'success', delivery: 'best-effort', mutatesContext: false, portability: 'cross-agent' }
		].filter((descriptor) => commandTypes.includes(descriptor.type as AgentCommand['type'])));
	}

	public static createProtocolDescriptorForExecution(execution: AgentExecutionProcess): AgentExecutionProtocolDescriptorType {
		return createAgentExecutionProtocolDescriptor({
			scope: execution.scope,
			interactionPosture: execution.interactionPosture,
			messages: AgentExecution.resolveSupportedMessages({
				lifecycleState: execution.status,
				acceptsPrompts: execution.acceptsPrompts,
				acceptedCommands: execution.acceptedCommands
			})
		});
	}

	public static buildTaskScope(
		task: TaskDossierRecordType,
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
		execution?: AgentExecutionType;
		task?: TaskDossierRecordType;
		missionId?: string;
		missionDir?: string;
	}): AgentExecutionRecordType {
		const scope = input.task
			? AgentExecution.buildTaskScope(input.task, input.missionId)
			: undefined;
		const terminalFields = getTerminalFields(input.execution);
		const activityState = deriveActivityStateFromProgressState(input.execution?.progress.state);
		const effectiveActivityState = deriveActivityState(activityState, undefined);
		const protocolDescriptor = input.execution
			? AgentExecution.createProtocolDescriptorForExecution(input.execution)
			: undefined;

		return AgentExecution.cloneRecord({
			agentExecutionId: input.launch.agentExecutionId,
			agentId: input.launch.agentId,
			...(terminalFields.transportId ? { transportId: terminalFields.transportId } : input.launch.transportId ? { transportId: input.launch.transportId } : {}),
			...(input.launch.agentJournalPath ? { agentJournalPath: input.launch.agentJournalPath } : {}),
			...(input.launch.terminalRecordingPath ? { terminalRecordingPath: input.launch.terminalRecordingPath } : {}),
			...(terminalFields.terminalHandle
				? { terminalHandle: terminalFields.terminalHandle }
				: input.launch.terminalHandle
					? { terminalHandle: { ...input.launch.terminalHandle } }
					: {}),
			adapterLabel: input.adapterLabel,
			lifecycleState: input.execution?.status ?? input.launch.lifecycle,
			...(input.execution?.attention ? { attention: input.execution.attention } : {}),
			...(effectiveActivityState
				? { activityState: effectiveActivityState }
				: {}),
			createdAt: input.launch.launchedAt,
			lastUpdatedAt: input.execution?.updatedAt ?? input.launch.updatedAt,
			...(input.launch.taskId ? { taskId: input.launch.taskId } : {}),
			...(input.task?.relativePath ? { assignmentLabel: input.task.relativePath } : {}),
			...(input.execution?.workingDirectory ? { workingDirectory: input.execution.workingDirectory } : {}),
			...(input.task?.subject ? { currentTurnTitle: input.task.subject } : {}),
			interactionCapabilities: AgentExecution.resolveInteractionCapabilities({
				lifecycleState: input.execution?.status ?? input.launch.lifecycle,
				transport: input.execution?.transport
					?? (terminalFields.terminalHandle
						? {
							kind: 'terminal',
							terminalName: terminalFields.terminalHandle.terminalName,
							terminalPaneId: terminalFields.terminalHandle.terminalPaneId
						}
						: undefined),
				...(input.execution?.acceptsPrompts !== undefined
					? { acceptsPrompts: input.execution.acceptsPrompts }
					: {}),
				...(input.execution?.acceptedCommands
					? { acceptedCommands: input.execution.acceptedCommands }
					: {})
			}),
			supportedMessages: AgentExecution.resolveSupportedMessages({
				lifecycleState: input.execution?.status ?? input.launch.lifecycle,
				...(input.execution?.acceptsPrompts !== undefined
					? { acceptsPrompts: input.execution.acceptsPrompts }
					: {}),
				...(input.execution?.acceptedCommands
					? { acceptedCommands: input.execution.acceptedCommands }
					: {})
			}),
			...(protocolDescriptor ? { protocolDescriptor } : {}),
			...(scope ? { scope } : {}),
			...(input.execution?.progress
				? {
					liveActivity: createLiveActivityFromProgress(input.execution.progress)
				}
				: {}),
			...(input.execution?.failureMessage ? { failureMessage: input.execution.failureMessage } : {})
		});
	}

	public static createStateFromExecution(input: {
		execution: AgentExecutionType;
		adapterLabel: string;
		record?: AgentExecutionRecordType;
	}): AgentExecutionStateType {
		const { execution, adapterLabel, record } = input;
		const terminalFields = getTerminalFields(execution);
		const activityState = deriveActivityStateFromProgressState(execution.progress.state);
		const awaitingResponseToMessageId = record?.awaitingResponseToMessageId;
		const effectiveActivityState = deriveActivityState(activityState, awaitingResponseToMessageId);
		const protocolDescriptor = AgentExecution.createProtocolDescriptorForExecution(execution);
		return AgentExecution.cloneState({
			agentId: execution.agentId,
			...(terminalFields.transportId ? { transportId: terminalFields.transportId } : {}),
			adapterLabel,
			agentExecutionId: execution.agentExecutionId,
			...(record?.agentJournalPath ? { agentJournalPath: record.agentJournalPath } : {}),
			...(record?.terminalRecordingPath ? { terminalRecordingPath: record.terminalRecordingPath } : {}),
			...(terminalFields.terminalHandle
				? { terminalHandle: terminalFields.terminalHandle }
				: record?.terminalHandle
					? { terminalHandle: { ...record.terminalHandle } }
					: {}),
			lifecycleState: execution.status,
			attention: execution.attention,
			...(effectiveActivityState
				? { activityState: effectiveActivityState }
				: record?.activityState
					? { activityState: record.activityState }
					: {}),
			...(record?.currentInputRequestId !== undefined ? { currentInputRequestId: record.currentInputRequestId } : {}),
			...(awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId } : {}),
			lastUpdatedAt: execution.updatedAt,
			...(execution.workingDirectory
				? { workingDirectory: execution.workingDirectory }
				: record?.workingDirectory
					? { workingDirectory: record.workingDirectory }
					: {}),
			...(record?.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
			interactionCapabilities: execution.interactionCapabilities
				? { ...execution.interactionCapabilities }
				: AgentExecution.resolveInteractionCapabilities({
					lifecycleState: execution.status,
					...(execution.transport ? { transport: execution.transport } : {}),
					acceptsPrompts: execution.acceptsPrompts,
					acceptedCommands: execution.acceptedCommands
				}),
			supportedMessages: AgentExecution.resolveSupportedMessages({
				lifecycleState: execution.status,
				acceptsPrompts: execution.acceptsPrompts,
				acceptedCommands: execution.acceptedCommands
			}),
			protocolDescriptor,
			...(record?.transportState ? { transportState: AgentExecution.cloneTransportState(record.transportState) } : {}),
			...(record?.scope ? { scope: record.scope } : {}),
			...(execution.progress
				? {
					liveActivity: createLiveActivityFromProgress(execution.progress)
				}
				: record?.liveActivity
					? { liveActivity: cloneStructured(record.liveActivity) }
					: {}),
			...(execution.failureMessage
				? { failureMessage: execution.failureMessage }
				: record?.failureMessage
					? { failureMessage: record.failureMessage }
					: {})
		});
	}

	public static cloneRecord(record: AgentExecutionRecordType): AgentExecutionRecordType {
		return {
			agentExecutionId: record.agentExecutionId,
			agentId: record.agentId,
			...(record.transportId ? { transportId: record.transportId } : {}),
			...(record.agentJournalPath ? { agentJournalPath: record.agentJournalPath } : {}),
			...(record.terminalRecordingPath ? { terminalRecordingPath: record.terminalRecordingPath } : {}),
			...(record.terminalHandle ? { terminalHandle: { ...record.terminalHandle } } : {}),
			adapterLabel: record.adapterLabel,
			lifecycleState: record.lifecycleState,
			...(record.attention ? { attention: record.attention } : {}),
			...(record.activityState ? { activityState: record.activityState } : {}),
			...(record.currentInputRequestId !== undefined ? { currentInputRequestId: record.currentInputRequestId } : {}),
			...(record.awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId: record.awaitingResponseToMessageId } : {}),
			createdAt: record.createdAt,
			lastUpdatedAt: record.lastUpdatedAt,
			...(record.taskId ? { taskId: record.taskId } : {}),
			...(record.assignmentLabel ? { assignmentLabel: record.assignmentLabel } : {}),
			...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
			...(record.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
			interactionCapabilities: { ...record.interactionCapabilities },
			supportedMessages: AgentExecution.cloneSupportedMessages(record.supportedMessages),
			...(record.protocolDescriptor ? { protocolDescriptor: AgentExecution.cloneProtocolDescriptor(record.protocolDescriptor) } : {}),
			...(record.transportState ? { transportState: AgentExecution.cloneTransportState(record.transportState) } : {}),
			...(record.scope ? { scope: { ...record.scope } } : {}),
			...(record.liveActivity ? { liveActivity: cloneStructured(record.liveActivity) } : {}),
			...(record.telemetry ? { telemetry: cloneStructured(record.telemetry) } : {}),
			...(record.failureMessage ? { failureMessage: record.failureMessage } : {})
		};
	}

	public static cloneState(state: AgentExecutionStateType): AgentExecutionStateType {
		return {
			agentId: state.agentId,
			...(state.transportId ? { transportId: state.transportId } : {}),
			adapterLabel: state.adapterLabel,
			agentExecutionId: state.agentExecutionId,
			...(state.agentJournalPath ? { agentJournalPath: state.agentJournalPath } : {}),
			...(state.terminalRecordingPath ? { terminalRecordingPath: state.terminalRecordingPath } : {}),
			...(state.terminalHandle ? { terminalHandle: { ...state.terminalHandle } } : {}),
			lifecycleState: state.lifecycleState,
			...(state.attention ? { attention: state.attention } : {}),
			...(state.activityState ? { activityState: state.activityState } : {}),
			...(state.currentInputRequestId !== undefined ? { currentInputRequestId: state.currentInputRequestId } : {}),
			...(state.awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId: state.awaitingResponseToMessageId } : {}),
			lastUpdatedAt: state.lastUpdatedAt,
			...(state.workingDirectory ? { workingDirectory: state.workingDirectory } : {}),
			...(state.currentTurnTitle ? { currentTurnTitle: state.currentTurnTitle } : {}),
			interactionCapabilities: { ...state.interactionCapabilities },
			supportedMessages: AgentExecution.cloneSupportedMessages(state.supportedMessages),
			...(state.protocolDescriptor ? { protocolDescriptor: AgentExecution.cloneProtocolDescriptor(state.protocolDescriptor) } : {}),
			...(state.transportState ? { transportState: AgentExecution.cloneTransportState(state.transportState) } : {}),
			...(state.scope ? { scope: { ...state.scope } } : {}),
			...(state.liveActivity ? { liveActivity: cloneStructured(state.liveActivity) } : {}),
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

	private static cloneSupportedMessages(
		supportedMessages: AgentExecutionMessageDescriptorType[]
	): AgentExecutionMessageDescriptorType[] {
		return supportedMessages.map((descriptor) => ({
			...descriptor,
			...(descriptor.adapterId ? { adapterId: descriptor.adapterId } : {}),
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
			interactionPosture: protocolDescriptor.interactionPosture,
			messages: AgentExecution.cloneSupportedMessages(protocolDescriptor.messages),
			signals: protocolDescriptor.signals.map((descriptor) => ({
				...descriptor,
				deliveries: [...descriptor.deliveries],
				outcomes: [...descriptor.outcomes]
			})),
			...(protocolDescriptor.mcp ? { mcp: { ...protocolDescriptor.mcp } } : {})
		};
	}

	private static cloneTransportState(
		transportState: AgentExecutionTransportStateType
	): AgentExecutionTransportStateType {
		return {
			selected: transportState.selected,
			degraded: false
		};
	}

	private static resolveSupportedMessages(input: {
		lifecycleState: AgentExecutionRecordType['lifecycleState'] | AgentExecutionProcess['status'];
		currentInputRequestId?: string | null;
		acceptsPrompts?: boolean;
		acceptedCommands?: AgentCommand['type'][];
	}): AgentExecutionMessageDescriptorType[] {
		const acceptedCommands = input.acceptedCommands ?? AgentExecution.deriveAcceptedCommands(input.lifecycleState, input.currentInputRequestId);
		return [
			...AgentExecution.createSupportedMessagesForCommands(acceptedCommands),
			...AgentExecution.createNativeTerminalMessageDescriptors(input.lifecycleState)
		];
	}

	private static createNativeTerminalMessageDescriptors(
		lifecycleState: AgentExecutionRecordType['lifecycleState'] | AgentExecutionProcess['status']
	): AgentExecutionMessageDescriptorType[] {
		if (lifecycleState !== 'starting' && lifecycleState !== 'running') {
			return [];
		}
		return AgentExecutionMessageDescriptorSchema.array().parse([{
			type: 'model',
			label: 'Model',
			description: 'Open the running Agent session model selector.',
			icon: 'lucide:brain-circuit',
			delivery: 'best-effort',
			mutatesContext: false,
			portability: 'terminal-only'
		}]);
	}

	private static resolveInteractionCapabilities(input: {
		lifecycleState: AgentExecutionRecordType['lifecycleState'] | AgentExecutionProcess['status'];
		currentInputRequestId?: string | null;
		transport?: AgentExecutionProcess['transport'];
		acceptsPrompts?: boolean;
		acceptedCommands?: AgentCommand['type'][];
	}): AgentExecutionInteractionCapabilitiesType {
		return deriveAgentExecutionInteractionCapabilities({
			status: input.lifecycleState,
			...(input.transport ? { transport: input.transport } : {}),
			acceptsPrompts: input.acceptsPrompts ?? AgentExecution.deriveAcceptsPrompts(input.lifecycleState, input.currentInputRequestId),
			acceptedCommands: input.acceptedCommands ?? AgentExecution.deriveAcceptedCommands(input.lifecycleState, input.currentInputRequestId)
		});
	}

	private static deriveAcceptsPrompts(
		lifecycleState: AgentExecutionRecordType['lifecycleState'] | AgentExecutionProcess['status'],
		currentInputRequestId?: string | null
	): boolean {
		return lifecycleState === 'running'
			|| currentInputRequestId !== undefined && currentInputRequestId !== null;
	}

	private static deriveAcceptedCommands(
		lifecycleState: AgentExecutionRecordType['lifecycleState'] | AgentExecutionProcess['status'],
		currentInputRequestId?: string | null
	): AgentCommand['type'][] {
		if (currentInputRequestId !== undefined && currentInputRequestId !== null) {
			return ['interrupt', 'checkpoint', 'nudge', 'resume'];
		}
		if (lifecycleState === 'starting' || lifecycleState === 'running') {
			return ['interrupt', 'checkpoint', 'nudge'];
		}
		return [];
	}

	private readonly listeners = new Set<(event: AgentExecutionEvent) => void>();
	private readonly dataChangeListeners = new Set<(data: AgentExecutionType) => void>();
	private projection: AgentExecutionProjectionType = AgentExecutionProjectionSchema.parse({ timelineItems: [] });
	private liveExecution: AgentExecutionProcess | undefined;
	private disposed = false;

	public static createLive(execution: AgentExecutionProcess, options: { adapterLabel?: string; protocolDescriptor?: AgentExecutionProtocolDescriptorType; transportState?: AgentExecutionTransportStateType } = {}): AgentExecution {
		const liveExecution = new AgentExecution(AgentExecution.toDataFromExecution(execution, options));
		liveExecution.liveExecution = cloneExecution(execution);
		return liveExecution;
	}

	private static toDataFromExecution(execution: AgentExecutionProcess, options: { adapterLabel?: string; protocolDescriptor?: AgentExecutionProtocolDescriptorType; transportState?: AgentExecutionTransportStateType } = {}): AgentExecutionType {
		return AgentExecutionSchema.parse({
			id: AgentExecution.createEntityId(getAgentExecutionEntityScopeId(execution), execution.agentExecutionId),
			ownerId: getAgentExecutionOwnerId(execution.scope),
			agentExecutionId: execution.agentExecutionId,
			agentId: execution.agentId,
			...(execution.transport?.kind === 'terminal' ? { transportId: 'terminal' } : {}),
			adapterLabel: options.adapterLabel?.trim() || execution.agentId,
			lifecycleState: execution.status,
			attention: execution.attention,
			...(deriveActivityStateFromProgressState(execution.progress.state)
				? { activityState: deriveActivityStateFromProgressState(execution.progress.state) }
				: {}),
			...(execution.transport?.kind === 'terminal'
				? {
					terminalHandle: {
						terminalName: execution.transport.terminalName,
						terminalPaneId: execution.transport.terminalPaneId ?? execution.transport.terminalName
					}
				}
				: {}),
			...(execution.taskId ? { taskId: execution.taskId } : {}),
			workingDirectory: execution.workingDirectory,
			interactionCapabilities: execution.interactionCapabilities
				? { ...execution.interactionCapabilities }
				: AgentExecution.resolveInteractionCapabilities({
					lifecycleState: execution.status,
					...(execution.transport ? { transport: execution.transport } : {}),
					acceptsPrompts: execution.acceptsPrompts,
					acceptedCommands: execution.acceptedCommands
				}),
			context: AgentExecutionContextSchema.parse({ artifacts: [], instructions: [] }),
			supportedMessages: AgentExecution.resolveSupportedMessages({
				lifecycleState: execution.status,
				acceptsPrompts: execution.acceptsPrompts,
				acceptedCommands: execution.acceptedCommands
			}),
			protocolDescriptor: options.protocolDescriptor ?? AgentExecution.createProtocolDescriptorForExecution(execution),
			...(options.transportState ? { transportState: AgentExecution.cloneTransportState(options.transportState) } : {}),
			scope: { ...execution.scope },
			progress: cloneStructured(execution.progress),
			waitingForInput: execution.waitingForInput,
			acceptsPrompts: execution.acceptsPrompts,
			acceptedCommands: [...execution.acceptedCommands],
			interactionPosture: execution.interactionPosture,
			...(execution.transport ? { transport: { ...execution.transport } } : {}),
			reference: {
				...execution.reference,
				...(execution.reference.transport ? { transport: { ...execution.reference.transport } } : {})
			},
			liveActivity: createLiveActivityFromProgress(execution.progress),
			createdAt: execution.startedAt,
			lastUpdatedAt: execution.updatedAt,
			...(execution.failureMessage ? { failureMessage: execution.failureMessage } : {}),
			...(execution.endedAt ? { endedAt: execution.endedAt } : {})
		});
	}

	public constructor(data: AgentExecutionType) {
		super(AgentExecutionSchema.parse(data));
		this.projection = cloneProjection(this.data.projection);
	}

	public override updateFromData(data: AgentExecutionType): this {
		super.updateFromData(data);
		this.projection = cloneProjection(this.data.projection);
		return this;
	}

	public override toData(): AgentExecutionType {
		return AgentExecutionSchema.parse({
			...super.toData(),
			projection: cloneProjection(this.projection)
		});
	}

	public replaceJournalRecords(records: AgentExecutionJournalRecordType[]): this {
		this.data.journalRecords = cloneStructured(records) as AgentExecutionType['journalRecords'];
		return this;
	}

	public appendJournalRecord(record: AgentExecutionJournalRecordType, options: { notify?: boolean } = {}): this {
		const existingRecords = (this.data.journalRecords ?? []) as AgentExecutionJournalRecordType[];
		if (existingRecords.some((existingRecord) => existingRecord.recordId === record.recordId)) {
			return this;
		}

		existingRecords.push(cloneStructured(record));
		this.data.journalRecords = existingRecords as AgentExecutionType['journalRecords'];
		this.data.lastUpdatedAt = record.occurredAt;

		if (options.notify) {
			this.notifyDataChanged();
		}

		return this;
	}

	public get id(): string {
		return this.agentExecutionId;
	}

	public get agentExecutionId(): string {
		return this.toData().agentExecutionId;
	}

	public get reference(): AgentExecutionReference {
		return this.getExecution().reference;
	}

	public attachTerminal(input: {
		terminalName: string;
		source: AgentExecutionTerminalUpdateSource;
	}): { dispose(): void } {
		const terminalName = input.terminalName.trim();
		if (!terminalName) {
			throw new Error(`AgentExecution '${this.agentExecutionId}' requires a terminal name before terminal attachment.`);
		}
		return input.source.onDidTerminalUpdate((update) => {
			if (update.terminalName === terminalName) {
				this.applyTerminalUpdate(update);
			}
		});
	}

	public getExecution(): AgentExecutionProcess {
		if (!this.liveExecution) {
			throw new Error(`AgentExecution '${this.agentExecutionId}' is not attached to live runtime state.`);
		}
		return cloneExecution(this.liveExecution);
	}

	public onDidEvent(listener: (event: AgentExecutionEvent) => void): { dispose(): void } {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			}
		};
	}

	public onDidDataChange(listener: (data: AgentExecutionType) => void): { dispose(): void } {
		this.dataChangeListeners.add(listener);
		return {
			dispose: () => {
				this.dataChangeListeners.delete(listener);
			}
		};
	}

	public async complete(): Promise<AgentExecutionProcess> {
		const endedAt = new Date().toISOString();
		const execution = this.patch({
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
		this.emitEvent({ type: 'execution.completed', execution });
		return execution;
	}

	public async submitPrompt(prompt: AgentPrompt): Promise<AgentExecutionProcess> {
		this.requireActiveExecution('submit a prompt', { requirePromptAcceptance: true });
		const execution = this.patch({
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
			this.appendTimelineItem({
				id: createProjectionItemId(execution.agentExecutionId, execution.updatedAt, 'operator', prompt.text),
				occurredAt: execution.updatedAt,
				zone: 'conversation',
				primitive: 'conversation.operator-message',
				behavior: createProjectionBehavior('conversational'),
				provenance: {
					durable: false,
					sourceRecordIds: [],
					liveOverlay: true,
					confidence: 'medium'
				},
				payload: {
					text: prompt.text
				}
			});
		}
		this.emitEvent({ type: 'execution.updated', execution });
		this.emitEvent({
			type: 'execution.message',
			channel: prompt.source === 'operator' || prompt.source === 'system' ? 'system' : 'agent',
			text: prompt.text,
			execution
		});
		return execution;
	}

	public setAwaitingResponseToMessageId(messageId: string | null, updatedAt = new Date().toISOString()): AgentExecutionType {
		const baseData = super.toData();
		const nextActivityState = deriveActivityState(
			this.liveExecution ? deriveActivityStateFromProgressState(this.liveExecution.progress.state) : baseData.activityState,
			messageId
		);
		const nextLiveActivity = this.liveExecution?.progress
			? createLiveActivityFromProgress(this.liveExecution.progress)
			: baseData.liveActivity;
		this.data = AgentExecutionSchema.parse({
			...baseData,
			...(messageId !== undefined ? { awaitingResponseToMessageId: messageId } : {}),
			...(nextActivityState ? { activityState: nextActivityState } : {}),
			...(nextLiveActivity ? { liveActivity: cloneStructured(nextLiveActivity) } : {}),
			lastUpdatedAt: updatedAt,
			projection: cloneProjection(this.projection)
		});
		this.refreshProjectionState(updatedAt);
		this.notifyDataChanged();
		return this.toData();
	}

	public async submitCommand(command: AgentCommand): Promise<AgentExecutionProcess> {
		this.requireActiveExecution(`perform '${command.type}'`);
		if (command.type === 'interrupt') {
			const execution = this.patch({
				status: 'running',
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
			this.emitEvent({ type: 'execution.updated', execution });
			return execution;
		}
		return this.submitPrompt(buildCommandPrompt(command));
	}

	public async cancelProcess(reason?: string): Promise<AgentExecutionProcess> {
		this.requireActiveExecution('cancel');
		const execution = this.patch({
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
		this.emitEvent({ type: 'execution.cancelled', ...(reason ? { reason } : {}), execution });
		return execution;
	}

	public async terminateProcess(reason?: string): Promise<AgentExecutionProcess> {
		const execution = this.patch({
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
		this.emitEvent({ type: 'execution.terminated', ...(reason ? { reason } : {}), execution });
		return execution;
	}

	public dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.listeners.clear();
	}

	public patch(overrides: Patch): AgentExecutionProcess {
		const execution = this.getExecution();
		const nextExecution: AgentExecutionType = {
			...execution,
			acceptedCommands: overrides.acceptedCommands
				? [...overrides.acceptedCommands]
				: [...execution.acceptedCommands],
			progress: overrides.progress
				? {
					...overrides.progress,
					...(overrides.progress.units ? { units: { ...overrides.progress.units } } : {})
				}
				: {
					...execution.progress,
					...(execution.progress.units ? { units: { ...execution.progress.units } } : {})
				},
			reference: overrides.reference
				? {
					...overrides.reference,
					...(overrides.reference.transport ? { transport: { ...overrides.reference.transport } } : {})
				}
				: {
					...execution.reference,
					...(execution.reference.transport ? { transport: { ...execution.reference.transport } } : {})
				},
			updatedAt: new Date().toISOString()
		};
		for (const key of Object.keys(overrides) as Array<keyof Patch>) {
			const value = overrides[key];
			if (key === 'failureMessage' && value === undefined) {
				continue;
			}
			if (value !== undefined) {
				Object.assign(nextExecution, { [key]: value });
			}
		}
		if ('failureMessage' in overrides && overrides.failureMessage === undefined) {
			delete nextExecution.failureMessage;
		}
		if (
			overrides.waitingForInput === false
			&& overrides.currentInputRequestId === undefined
		) {
			nextExecution.currentInputRequestId = null;
		}
		nextExecution.interactionCapabilities = deriveAgentExecutionInteractionCapabilities(nextExecution);
		this.liveExecution = nextExecution;
		return this.getExecution();
	}

	public emitEvent(event: AgentExecutionEvent): void {
		if (this.disposed) {
			return;
		}
		this.appendTimelineItemFromEvent(event);
		this.liveExecution = cloneExecution(event.execution);
		this.refreshProjectionState(event.execution.updatedAt);
		for (const listener of this.listeners) {
			listener(event);
		}
		this.notifyDataChanged();
	}

	public applySignalObservation(
		observation: AgentExecutionObservation,
		decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
	): AgentExecutionType | void {
		const appendedTimelineItem = this.appendTimelineItemFromObservation(observation, decision);
		const execution = this.applySignalDecision(decision);
		if (appendedTimelineItem && decision.action === 'record-observation-only') {
			this.notifyDataChanged();
		}
		return execution;
	}

	public applySignalDecision(
		decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
	): AgentExecutionType | void {
		switch (decision.action) {
			case 'emit-message':
				this.emitEvent({
					...decision.event,
					execution: this.getExecution()
				});
				return this.getExecution();
			case 'record-observation-only':
				return this.getExecution();
			case 'update-execution': {
				const execution = this.patch(decision.patch);
				this.emitEvent(toRuntimeExecutionEvent(decision.eventType, execution));
				return execution;
			}
		}
	}

	private appendTimelineItemFromObservation(
		observation: AgentExecutionObservation,
		decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
	): boolean {
		const signal = observation.signal;
		if (signal.type === 'diagnostic' || signal.type === 'usage' || signal.type === 'message' || decision.action === 'emit-message') {
			return false;
		}

		return this.appendTimelineItem(projectAgentExecutionObservationSignalToTimelineItem({
			itemId: observation.observationId,
			occurredAt: observation.observedAt,
			signal,
			provenance: {
				durable: false,
				sourceRecordIds: [],
				liveOverlay: true,
				confidence: signal.confidence
			}
		}));
	}

	private appendTimelineItemFromEvent(event: AgentExecutionEvent): boolean {
		if (event.type === 'execution.message' && event.channel === 'agent') {
			if (event.timelineItem) {
				return this.appendTimelineItem(event.timelineItem);
			}
			return this.appendTimelineItem({
				id: createProjectionItemId(event.execution.agentExecutionId, event.execution.updatedAt, event.channel, event.text),
				occurredAt: event.execution.updatedAt,
				zone: 'conversation',
				primitive: 'conversation.agent-message',
				behavior: createProjectionBehavior('conversational'),
				provenance: {
					durable: false,
					sourceRecordIds: [],
					liveOverlay: true,
					confidence: 'medium'
				},
				payload: {
					text: event.text
				}
			});
		}
		if (event.type === 'execution.completed' && event.execution.progress.summary) {
			return this.appendTimelineItem({
				id: createProjectionItemId(event.execution.agentExecutionId, event.execution.updatedAt, 'completed'),
				occurredAt: event.execution.updatedAt,
				zone: 'workflow',
				primitive: 'attention.verification-result',
				behavior: createProjectionBehavior('approval'),
				severity: 'success',
				provenance: {
					durable: false,
					sourceRecordIds: [],
					liveOverlay: true,
					confidence: 'high'
				},
				payload: {
					title: 'Completed',
					text: event.execution.progress.summary,
					result: 'passed'
				}
			});
		}
		if (event.type === 'execution.failed') {
			return this.appendTimelineItem({
				id: createProjectionItemId(event.execution.agentExecutionId, event.execution.updatedAt, 'failed'),
				occurredAt: event.execution.updatedAt,
				zone: 'workflow',
				primitive: 'attention.verification-result',
				behavior: createProjectionBehavior('approval', { sticky: true }),
				severity: 'error',
				provenance: {
					durable: false,
					sourceRecordIds: [],
					liveOverlay: true,
					confidence: 'high'
				},
				payload: {
					title: 'Failed',
					text: event.reason,
					result: 'failed'
				}
			});
		}
		return false;
	}

	private appendTimelineItem(item: AgentExecutionTimelineItemType | undefined): boolean {
		if (!item) {
			return false;
		}
		const parsed = AgentExecutionTimelineItemSchema.parse(item);
		if (this.projection.timelineItems.some((existing) => existing.id === parsed.id)) {
			return false;
		}
		this.projection = AgentExecutionProjectionSchema.parse({
			...this.projection,
			timelineItems: [...this.projection.timelineItems, parsed]
		});
		this.data = AgentExecutionSchema.parse({
			...super.toData(),
			projection: cloneProjection(this.projection),
			lastUpdatedAt: parsed.occurredAt
		});
		this.refreshProjectionState(parsed.occurredAt);
		return true;
	}

	private refreshProjectionState(updatedAt: string): void {
		const baseData = super.toData();
		const execution = this.liveExecution ? this.getExecution() : undefined;
		const lifecycleState = execution?.status ?? baseData.lifecycleState;
		const attention = execution?.attention ?? baseData.attention;
		const activityState = execution
			? deriveActivityState(
				deriveActivityStateFromProgressState(execution.progress.state) ?? baseData.activityState,
				baseData.awaitingResponseToMessageId
			)
			: baseData.activityState;
		const liveActivity = execution?.progress
			? createLiveActivityFromProgress(execution.progress)
			: baseData.liveActivity;
		const currentActivity = createLiveCurrentActivityProjection({
			lifecycleState,
			attention,
			activityState,
			liveActivity,
			telemetry: baseData.telemetry,
			updatedAt: execution?.updatedAt ?? updatedAt
		});
		const currentAttention = createLiveCurrentAttentionProjection({
			attention,
			currentInputRequestId: execution?.currentInputRequestId ?? baseData.currentInputRequestId,
			timelineItems: this.projection.timelineItems,
			updatedAt: execution?.updatedAt ?? updatedAt
		});
		this.projection = AgentExecutionProjectionSchema.parse({
			timelineItems: [...this.projection.timelineItems],
			...(currentActivity ? { currentActivity } : {}),
			...(currentAttention ? { currentAttention } : {}),
			...(this.projection.liveOverlay
				? { liveOverlay: cloneStructured(this.projection.liveOverlay) }
				: {})
		});
		this.data = AgentExecutionSchema.parse({
			...baseData,
			lifecycleState,
			...(attention !== undefined ? { attention } : {}),
			...(activityState ? { activityState } : {}),
			...(baseData.awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId: baseData.awaitingResponseToMessageId } : {}),
			...(liveActivity ? { liveActivity: cloneStructured(liveActivity) } : {}),
			...(execution?.failureMessage ? { failureMessage: execution.failureMessage } : {}),
			...(execution
				? {
					interactionCapabilities: execution.interactionCapabilities
						? { ...execution.interactionCapabilities }
						: AgentExecution.resolveInteractionCapabilities({
							lifecycleState: execution.status,
							...(execution.transport ? { transport: execution.transport } : {}),
							acceptsPrompts: execution.acceptsPrompts,
							acceptedCommands: execution.acceptedCommands
						}),
					supportedMessages: AgentExecution.resolveSupportedMessages({
						lifecycleState: execution.status,
						acceptsPrompts: execution.acceptsPrompts,
						acceptedCommands: execution.acceptedCommands
					})
				}
				: {}),
			projection: cloneProjection(this.projection),
			lastUpdatedAt: execution?.updatedAt ?? updatedAt
		});
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

	public toRecord(): AgentExecutionRecordType {
		const data = this.toData();
		return AgentExecution.cloneRecord({
			agentExecutionId: data.agentExecutionId,
			agentId: data.agentId,
			...(data.transportId ? { transportId: data.transportId } : {}),
			...(data.agentJournalPath ? { agentJournalPath: data.agentJournalPath } : {}),
			...(data.terminalRecordingPath ? { terminalRecordingPath: data.terminalRecordingPath } : {}),
			...(data.terminalHandle ? { terminalHandle: { ...data.terminalHandle } } : {}),
			adapterLabel: data.adapterLabel,
			lifecycleState: data.lifecycleState,
			...(data.attention ? { attention: data.attention } : {}),
			...(data.activityState ? { activityState: data.activityState } : {}),
			...(data.currentInputRequestId !== undefined ? { currentInputRequestId: data.currentInputRequestId } : {}),
			...(data.taskId ? { taskId: data.taskId } : {}),
			...(data.assignmentLabel ? { assignmentLabel: data.assignmentLabel } : {}),
			...(data.workingDirectory ? { workingDirectory: data.workingDirectory } : {}),
			...(data.currentTurnTitle ? { currentTurnTitle: data.currentTurnTitle } : {}),
			interactionCapabilities: { ...data.interactionCapabilities },
			supportedMessages: AgentExecution.cloneSupportedMessages(data.supportedMessages),
			...(data.protocolDescriptor ? { protocolDescriptor: AgentExecution.cloneProtocolDescriptor(data.protocolDescriptor) } : {}),
			...(data.transportState ? { transportState: AgentExecution.cloneTransportState(data.transportState) } : {}),
			...(data.scope ? { scope: { ...data.scope } } : {}),
			...(data.liveActivity ? { liveActivity: cloneStructured(data.liveActivity) } : {}),
			...(data.telemetry ? { telemetry: cloneStructured(data.telemetry) } : {}),
			...(data.failureMessage ? { failureMessage: data.failureMessage } : {}),
			createdAt: data.createdAt ?? data.lastUpdatedAt ?? new Date().toISOString(),
			lastUpdatedAt: data.lastUpdatedAt ?? data.createdAt ?? new Date().toISOString()
		});
	}

	public toEntity(): AgentExecutionType {
		return AgentExecutionSchema.parse(this.toData());
	}

	public toState(execution?: AgentExecutionProcess): AgentExecutionStateType {
		const record = this.toRecord();
		if (!execution) {
			return AgentExecution.cloneState({
				agentId: record.agentId,
				...(record.transportId ? { transportId: record.transportId } : {}),
				adapterLabel: record.adapterLabel,
				agentExecutionId: record.agentExecutionId,
				...(record.agentJournalPath ? { agentJournalPath: record.agentJournalPath } : {}),
				...(record.terminalHandle ? { terminalHandle: { ...record.terminalHandle } } : {}),
				lifecycleState: record.lifecycleState,
				...(record.attention ? { attention: record.attention } : {}),
				...(record.activityState ? { activityState: record.activityState } : {}),
				...(record.currentInputRequestId !== undefined ? { currentInputRequestId: record.currentInputRequestId } : {}),
				lastUpdatedAt: record.lastUpdatedAt,
				...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
				...(record.currentTurnTitle ? { currentTurnTitle: record.currentTurnTitle } : {}),
				interactionCapabilities: { ...record.interactionCapabilities },
				supportedMessages: AgentExecution.cloneSupportedMessages(record.supportedMessages),
				...(record.protocolDescriptor ? { protocolDescriptor: AgentExecution.cloneProtocolDescriptor(record.protocolDescriptor) } : {}),
				...(record.transportState ? { transportState: AgentExecution.cloneTransportState(record.transportState) } : {}),
				...(record.scope ? { scope: record.scope } : {}),
				...(record.liveActivity ? { liveActivity: cloneStructured(record.liveActivity) } : {}),
				...(record.failureMessage ? { failureMessage: record.failureMessage } : {})
			});
		}

		return AgentExecution.createStateFromExecution({
			execution,
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

	private requireActiveExecution(
		action: string,
		options: { requirePromptAcceptance?: boolean } = {}
	): AgentExecutionProcess {
		const execution = this.getExecution();
		if (AgentExecution.isTerminalFinalStatus(execution.status)) {
			throw new Error(`Cannot ${action} for execution '${execution.agentExecutionId}' because it is ${execution.status}.`);
		}
		if (options.requirePromptAcceptance && !execution.acceptsPrompts) {
			throw new Error(`Cannot ${action} for execution '${execution.agentExecutionId}' because prompts are disabled.`);
		}
		return execution;
	}

	private applyTerminalUpdate(update: AgentExecutionTerminalUpdate): void {
		if (update.chunk) {
			for (const line of splitTerminalLines(update.chunk)) {
				this.emitEvent({
					type: 'execution.message',
					channel: 'stdout',
					text: line,
					execution: this.getExecution()
				});
			}
		}
		if (!update.dead) {
			return;
		}
		const execution = update.exitCode === 0
			? this.patch({
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
			: this.patch({
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
		this.emitEvent(execution.status === 'completed'
			? { type: 'execution.completed', execution }
			: { type: 'execution.failed', reason: execution.failureMessage ?? 'terminal command failed.', execution });
	}

	private static requireRecordScopeId(record: AgentExecutionRecordType): string {
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
		throw new Error(`AgentExecution '${record.agentExecutionId}' requires an AgentExecutionScope.`);
	}

	private static requireRecordOwnerId(record: AgentExecutionRecordType): string {
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
		throw new Error(`AgentExecution '${record.agentExecutionId}' requires an AgentExecutionScope.`);
	}

	private static readRegistryExecution(
		input: { ownerId: string; agentExecutionId: string },
		context: EntityExecutionContext
	): AgentExecutionType | undefined {
		if (!context.agentExecutionRegistry?.hasExecution(input.agentExecutionId)) {
			return undefined;
		}
		const data = context.agentExecutionRegistry.readExecution(input.agentExecutionId);
		AgentExecution.assertOwnerMatches(input, data);
		return data;
	}

	private static async requireDataForOwner(
		input: { ownerId: string; agentExecutionId: string },
		context: EntityExecutionContext
	): Promise<LocatedAgentExecutionData> {
		const registryData = AgentExecution.readRegistryExecution(input, context);
		if (registryData) {
			return { data: registryData, missionDir: context.surfacePath };
		}

		const cacheKey = `${input.ownerId}:${input.agentExecutionId}`;
		const cached = agentExecutionDataCache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < AGENT_EXECUTION_DATA_CACHE_TTL_MS) {
			return cached.located;
		}

		const service = await loadMissionRegistry(context);
		const mission = await service.loadRequiredMission({ missionId: input.ownerId }, context);
		try {
			const data = await AgentExecution.hydrateDataFromJournal(
				AgentExecution.requireData(await mission.buildMission(), input.agentExecutionId),
				mission.getMissionDir()
			);
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

	private static assertOwnerMatches(input: { ownerId: string; agentExecutionId: string }, data: AgentExecutionType): void {
		if (data.ownerId !== input.ownerId) {
			throw new Error(`AgentExecution '${input.agentExecutionId}' belongs to owner '${data.ownerId}', not '${input.ownerId}'.`);
		}
	}

	private static async hydrateDataFromJournal(
		data: AgentExecutionType,
		missionDir: string | undefined
	): Promise<AgentExecutionType> {
		if (!missionDir || !data.agentJournalPath || !data.scope) {
			return data;
		}
		const store = new AgentExecutionJournalFileStore({
			resolvePath: () => ({
				rootPath: missionDir,
				relativePath: data.agentJournalPath ?? ''
			})
		});
		const records = await store.readRecords(createAgentExecutionJournalReference({
			agentExecutionId: data.agentExecutionId,
			scope: normalizeScopeFromData(data.scope)
		}));
		return AgentExecution.applyDerivedInteractionState(
			AgentExecutionSchema.parse(hydrateAgentExecutionDataFromJournal(data, records))
		);
	}

	private static applyDerivedInteractionState(data: AgentExecutionType): AgentExecutionType {
		return AgentExecutionSchema.parse({
			...data,
			interactionCapabilities: AgentExecution.resolveInteractionCapabilities({
				lifecycleState: data.lifecycleState,
				...(data.currentInputRequestId !== undefined ? { currentInputRequestId: data.currentInputRequestId } : {}),
				...(data.terminalHandle
					? {
						transport: {
							kind: 'terminal' as const,
							terminalName: data.terminalHandle.terminalName,
							terminalPaneId: data.terminalHandle.terminalPaneId
						}
					}
					: {})
			}),
			supportedMessages: AgentExecution.resolveSupportedMessages({
				lifecycleState: data.lifecycleState,
				...(data.currentInputRequestId !== undefined ? { currentInputRequestId: data.currentInputRequestId } : {})
			})
		});
	}

	private static async readTerminalData(
		ownerId: string,
		missionDir: string | undefined,
		data: AgentExecutionType
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
			const events = data.terminalRecordingPath && missionDir
				? await dossierFilesystem.readMissionTerminalRecordingEvents(missionDir, data.terminalRecordingPath) ?? []
				: [];
			recording = events.length > 0
				? AgentExecutionTerminalRecordingSchema.parse({ version: 1, events })
				: undefined;
			screen = '';
		}
		return AgentExecutionTerminalSnapshotSchema.parse({
			ownerId,
			agentExecutionId: data.agentExecutionId,
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

	private static requireTerminalHandle(data: AgentExecutionType): AgentExecutionTerminalHandleType {
		if (!data.terminalHandle) {
			throw new Error(`AgentExecution '${data.agentExecutionId}' is not backed by a Terminal.`);
		}
		return data.terminalHandle;
	}

}

function getTerminalFields(snapshot: AgentExecutionProcess | undefined): {
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

function cloneExecution(snapshot: AgentExecutionProcess): AgentExecutionProcess {
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

function normalizeScopeFromData(scope: AgentExecutionType['scope']): AgentExecutionScope {
	if (!scope) {
		throw new Error('AgentExecution scope is required for journal-backed replay.');
	}
	switch (scope.kind) {
		case 'system':
			return {
				kind: 'system',
				...(scope.label ? { label: scope.label } : {})
			};
		case 'repository':
			return {
				kind: 'repository',
				repositoryRootPath: scope.repositoryRootPath
			};
		case 'mission':
			return {
				kind: 'mission',
				missionId: scope.missionId,
				...(scope.repositoryRootPath ? { repositoryRootPath: scope.repositoryRootPath } : {})
			};
		case 'task':
			return {
				kind: 'task',
				missionId: scope.missionId,
				taskId: scope.taskId,
				...(scope.stageId ? { stageId: scope.stageId } : {}),
				...(scope.repositoryRootPath ? { repositoryRootPath: scope.repositoryRootPath } : {})
			};
		case 'artifact':
			return {
				kind: 'artifact',
				artifactId: scope.artifactId,
				...(scope.repositoryRootPath ? { repositoryRootPath: scope.repositoryRootPath } : {}),
				...(scope.missionId ? { missionId: scope.missionId } : {}),
				...(scope.taskId ? { taskId: scope.taskId } : {}),
				...(scope.stageId ? { stageId: scope.stageId } : {})
			};
	}
}

function deriveActivityState(
	baseActivity: AgentExecutionActivityStateType | undefined,
	awaitingResponseToMessageId: string | null | undefined
): AgentExecutionActivityStateType | undefined {
	return awaitingResponseToMessageId !== undefined && awaitingResponseToMessageId !== null
		? 'awaiting-agent-response'
		: baseActivity;
}

function createLiveActivityFromProgress(
	progress: AgentExecutionProcess['progress']
): AgentExecutionLiveActivityType {
	return {
		progress: {
			...(progress.summary ? { summary: progress.summary } : {}),
			...(progress.detail ? { detail: progress.detail } : {}),
			...(progress.units ? { units: cloneStructured(progress.units) } : {})
		},
		updatedAt: progress.updatedAt
	};
}

function getAgentExecutionEntityScopeId(snapshot: AgentExecutionProcess): string {
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

function cloneProjection(projection: AgentExecutionProjectionType): AgentExecutionProjectionType {
	return AgentExecutionProjectionSchema.parse(cloneStructured(projection));
}

function createLiveCurrentActivityProjection(input: {
	lifecycleState: AgentExecutionType['lifecycleState'];
	attention: AgentExecutionType['attention'] | undefined;
	activityState: AgentExecutionType['activityState'] | undefined;
	liveActivity: AgentExecutionType['liveActivity'] | undefined;
	telemetry: AgentExecutionType['telemetry'] | undefined;
	updatedAt: string;
}): AgentExecutionActivityProjectionType | undefined {
	if (
		!input.lifecycleState
		&& !input.attention
		&& !input.activityState
		&& !input.liveActivity
		&& !input.telemetry
	) {
		return undefined;
	}
	return {
		updatedAt: input.updatedAt,
		...(input.lifecycleState ? { lifecycleState: input.lifecycleState } : {}),
		...(input.attention ? { attention: input.attention } : {}),
		...(input.activityState
			? { activity: input.activityState }
			: {}),
		...(input.liveActivity?.progress?.summary ? { summary: input.liveActivity.progress.summary } : {}),
		...(input.liveActivity?.progress?.detail ? { detail: input.liveActivity.progress.detail } : {}),
		...(input.liveActivity?.progress?.units ? { units: input.liveActivity.progress.units } : {}),
		...(input.liveActivity?.currentTarget ? { currentTarget: input.liveActivity.currentTarget } : {}),
		...(input.telemetry?.activeToolName ? { activeToolName: input.telemetry.activeToolName } : {})
	};
}

function createLiveCurrentAttentionProjection(input: {
	attention: AgentExecutionType['attention'] | undefined;
	currentInputRequestId: AgentExecutionType['currentInputRequestId'] | undefined;
	timelineItems: AgentExecutionTimelineItemType[];
	updatedAt: string;
}): AgentExecutionAttentionProjectionType | undefined {
	if (!input.attention || input.attention === 'none' || input.attention === 'autonomous') {
		return undefined;
	}
	const attentionItem = resolveCurrentAttentionProjectionItem(input.timelineItems, input.currentInputRequestId);
	const primitive = attentionItem?.primitive;
	if (
		primitive !== 'attention.input-request'
		&& primitive !== 'attention.blocked'
		&& primitive !== 'attention.verification-requested'
		&& primitive !== 'attention.verification-result'
	) {
		return {
			state: input.attention,
			primitive: input.currentInputRequestId ? 'attention.input-request' : 'attention.blocked',
			...(input.currentInputRequestId !== undefined ? { currentInputRequestId: input.currentInputRequestId } : {}),
			updatedAt: input.updatedAt
		};
	}
	return {
		state: input.attention,
		primitive,
		...(attentionItem?.severity ? { severity: attentionItem.severity } : {}),
		...(attentionItem?.payload.title ? { title: attentionItem.payload.title } : {}),
		...(attentionItem?.payload.text ? { text: attentionItem.payload.text } : {}),
		...(attentionItem?.payload.detail ? { detail: attentionItem.payload.detail } : {}),
		...(attentionItem?.payload.choices ? { choices: attentionItem.payload.choices } : {}),
		...(input.currentInputRequestId !== undefined ? { currentInputRequestId: input.currentInputRequestId } : {}),
		updatedAt: attentionItem?.occurredAt ?? input.updatedAt
	};
}

function resolveCurrentAttentionProjectionItem(
	timelineItems: AgentExecutionTimelineItemType[],
	currentInputRequestId: AgentExecutionType['currentInputRequestId'] | undefined
): AgentExecutionTimelineItemType | undefined {
	if (currentInputRequestId) {
		const inputRequestItem = timelineItems.find((item) => item.id === currentInputRequestId);
		if (inputRequestItem?.primitive === 'attention.input-request') {
			return inputRequestItem;
		}
	}
	return [...timelineItems].reverse().find(
		(item) => item.primitive.startsWith('attention.') && item.primitive !== 'attention.input-request'
	);
}

function createProjectionItemId(agentExecutionId: string, at: string, kind: string, text = ''): string {
	const normalizedText = Repository.slugIdentitySegment(text).slice(0, 32);
	return [agentExecutionId, at, kind, normalizedText].filter(Boolean).join(':');
}

function createProjectionBehavior(
	behaviorClass: AgentExecutionTimelineItemType['behavior']['class'],
	overrides: Partial<AgentExecutionTimelineItemType['behavior']> = {}
): AgentExecutionTimelineItemType['behavior'] {
	return {
		class: behaviorClass,
		compactable: false,
		collapsible: false,
		sticky: false,
		actionable: false,
		replayRelevant: true,
		transient: false,
		defaultExpanded: true,
		...overrides
	};
}

function toRuntimeExecutionEvent(
	eventType: 'execution.updated' | 'execution.completed' | 'execution.failed',
	snapshot: AgentExecutionType
): AgentExecutionEvent {
	switch (eventType) {
		case 'execution.updated':
			return { type: 'execution.updated', execution: snapshot };
		case 'execution.completed':
			return { type: 'execution.completed', execution: snapshot };
		case 'execution.failed':
			return {
				type: 'execution.failed',
				reason: snapshot.failureMessage ?? snapshot.progress.detail ?? 'Agent execution failed.',
				execution: snapshot
			};
	}
}

function buildCommandPrompt(command: Exclude<AgentCommand, { type: 'interrupt' }>): AgentPrompt {
	if ('portability' in command && command.portability === 'adapter-scoped') {
		return {
			source: 'system',
			text: command.reason?.trim()
				? `Run adapter-scoped command '${command.type}': ${command.reason.trim()}`
				: `Run adapter-scoped command '${command.type}'.`,
			metadata: {
				...(command.metadata ?? {}),
				'mission.command.portability': 'adapter-scoped',
				'mission.command.adapterId': command.adapterId
			}
		};
	}
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
	throw new Error(`Unsupported AgentExecution command '${String((command as { type: string }).type)}'.`);
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
