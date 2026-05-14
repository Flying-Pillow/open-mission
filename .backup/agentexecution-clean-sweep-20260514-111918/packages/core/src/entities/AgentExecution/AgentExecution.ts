import { randomUUID } from 'node:crypto';
import type {
	AgentCapabilities,
	AgentCommand,
	AgentExecutionEvent,
	AgentExecutionId,
	AgentExecutionReference,
	AgentLaunchConfig,
	AgentPrompt,
	AgentExecutionObservation,
	AgentExecutionProcess
} from './AgentExecutionSchema.js';
import {
	isTerminalFinalStatus as isAgentExecutionTerminalFinalStatus,
	type AgentExecutionSignalDecision
} from './AgentExecutionSchema.js';
import { createEntityId, createEntityIdentitySegment, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import type { AgentExecutionLaunchRequestType } from './AgentExecutionSchema.js';
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
	AgentExecutionLocatorSchema,
	AgentExecutionResolveMessageShorthandInputSchema,
	AgentExecutionInvokeSemanticOperationInputSchema,
	AgentExecutionSendTerminalInputSchema,
	agentExecutionEntityName,
	type AgentExecutionMessageDescriptorType,
	type AgentExecutionProtocolDescriptorType
} from './AgentExecutionCommunicationSchema.js';
import { createAgentExecutionProtocolDescriptor } from './input/AgentExecutionCommunicationDescriptor.js';
import { AgentExecutionSemanticOperationResultSchema } from './input/AgentExecutionSemanticOperationSchema.js';
import {
	AgentExecutionTimelineSchema,
	type AgentExecutionTimelineType,
	type AgentExecutionTimelineItemType
} from './activity/AgentExecutionActivityTimelineSchema.js';
import type { AgentExecutionTransportStateType } from './AgentExecutionStateSchema.js';
import type { MissionType } from '../Mission/MissionSchema.js';
import type { AgentExecutionJournalRecordType } from './journal/AgentExecutionJournalSchema.js';
import { resolveAgentExecutionMessageShorthand } from './input/AgentExecutionMessageShorthand.js';
import {
	buildAgentExecutionCommandPrompt,
	createAgentExecutionInteractionDescriptor,
	createAgentExecutionSupportedMessages,
	createAgentExecutionSupportedMessagesForCommands,
	resolveAgentExecutionInputCapabilities,
	resolveAgentExecutionSupportedMessages
} from './input/AgentExecutionInput.js';
import {
	applyAgentExecutionProcessPatch,
	cloneAgentExecutionProcess,
	createRecoverableAgentExecutionProcessFromLaunch,
	extractAgentExecutionProcess,
	type AgentExecutionLaunchRecord,
	type AgentExecutionProcessPatch
} from './process/AgentExecutionProcessState.js';
import {
	createAgentExecutionLiveActivity,
	deriveAgentExecutionActivityFromProcess
} from './activity/AgentExecutionActivity.js';
import {
	appendAgentExecutionActivityItem,
	cloneAgentExecutionTimeline,
	createActivityItemFromAgentExecutionEvent,
	createAgentExecutionTimelineItemId,
	createTimelineBehavior,
	refreshAgentExecutionActivityTimeline
} from './activity/AgentExecutionActivityTimeline.js';
import { createActivityItemFromAgentExecutionObservation } from './observations/AgentExecutionObservationActivity.js';
import {
	getAgentExecutionTerminalFields,
	readAgentExecutionTerminal,
	sendAgentExecutionTerminalInput,
	splitAgentExecutionTerminalOutputLines,
	type AgentExecutionTerminalUpdate,
	type AgentExecutionTerminalUpdateSource
} from './terminal/AgentExecutionTerminalAttachment.js';

export class AgentExecution extends Entity<AgentExecutionType, string> {
	public static override readonly entityName = agentExecutionEntityName;

	public static createEntityId(ownerId: string, agentExecutionId: string): string {
		return createEntityId('agent_execution', `${ownerId}/${agentExecutionId}`);
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
		return createFreshAgentExecutionId(config.ownerId, agentId);
	}

	public static cloneData(data: AgentExecutionType): AgentExecutionType {
		return AgentExecutionSchema.parse(cloneStructured(data));
	}

	public static async read(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionLocatorSchema.parse(payload);
		return AgentExecution.requireRegistryExecution(input, context);
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
		return new AgentExecution(AgentExecution.requireRegistryExecution(input, context));
	}

	public static async readTerminal(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionLocatorSchema.parse(payload);
		return readAgentExecutionTerminal({
			ownerId: input.ownerId,
			execution: AgentExecution.requireRegistryExecution(input, context)
		});
	}

	public static async resolveMessageShorthand(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionResolveMessageShorthandInputSchema.parse(payload);
		const data = AgentExecution.requireRegistryExecution(input, context);
		const protocolDescriptor = data.protocolDescriptor
			?? (data.ownerId
				? createAgentExecutionProtocolDescriptor({
					ownerId: data.ownerId,
					messages: data.supportedMessages
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
		AgentExecution.requireRegistryExecution(input, context);
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

	public static async sendTerminalInput(payload: unknown, context: EntityExecutionContext) {
		const input = AgentExecutionSendTerminalInputSchema.parse(payload);
		const data = AgentExecution.requireRegistryExecution(input, context);
		sendAgentExecutionTerminalInput({
			execution: data,
			...(input.data !== undefined ? { data: input.data } : {}),
			...(input.literal !== undefined ? { literal: input.literal } : {}),
			...(input.cols !== undefined ? { cols: input.cols } : {}),
			...(input.rows !== undefined ? { rows: input.rows } : {}),
			context
		});
		return readAgentExecutionTerminal({ ownerId: input.ownerId, execution: data });
	}

	public static async isCompatibleForLaunch(input: {
		AgentExecution: AgentExecutionType;
		request: AgentExecutionLaunchRequestType;
		resolveLiveAgentExecution(): Promise<AgentExecutionProcess | undefined>;
	}): Promise<boolean> {
		try {
			const liveAgentExecution = await input.resolveLiveAgentExecution();
			if (!liveAgentExecution || AgentExecution.isTerminalFinalStatus(liveAgentExecution.status)) {
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

	public static isTerminalFinalStatus(status: AgentExecutionProcess['status']): boolean {
		return isAgentExecutionTerminalFinalStatus(status);
	}

	public static createContext(data: Pick<AgentExecutionType, 'agentExecutionId' | 'assignmentLabel' | 'currentTurnTitle'>): AgentExecutionContextType {
		return AgentExecutionContextSchema.parse({
			artifacts: data.assignmentLabel
				? [{ id: data.assignmentLabel, role: 'instruction', order: 0, title: data.currentTurnTitle ?? data.assignmentLabel }]
				: [],
			instructions: data.currentTurnTitle
				? [{ instructionId: `${data.agentExecutionId}:turn-title`, text: data.currentTurnTitle, order: 0 }]
				: []
		});
	}

	public static createSupportedMessages(): AgentExecutionMessageDescriptorType[] {
		return createAgentExecutionSupportedMessages();
	}

	public static createSupportedMessagesForCommands(
		commandTypes: AgentCommand['type'][]
	): AgentExecutionMessageDescriptorType[] {
		return createAgentExecutionSupportedMessagesForCommands(commandTypes);
	}

	public static createProtocolDescriptorForExecution(execution: AgentExecutionProcess): AgentExecutionProtocolDescriptorType {
		return createAgentExecutionInteractionDescriptor(execution);
	}

	public static createDataFromLaunch(input: {
		launch: AgentExecutionLaunchRecord;
		adapterLabel: string;
		execution?: AgentExecutionProcess;
		missionDir?: string;
	}): AgentExecutionType {
		const ownerId = input.execution?.ownerId ?? input.launch.ownerId;
		const liveProcess = input.execution ? extractAgentExecutionProcess(input.execution) : undefined;
		const terminalFields = getAgentExecutionTerminalFields(liveProcess);
		const effectiveActivityState = deriveAgentExecutionActivityFromProcess({
			process: liveProcess,
			fallbackActivity: undefined,
			awaitingResponseToMessageId: undefined
		});
		const protocolDescriptor = liveProcess
			? AgentExecution.createProtocolDescriptorForExecution(liveProcess)
			: undefined;
		const process = liveProcess
			? cloneAgentExecutionProcess(liveProcess)
			: createRecoverableAgentExecutionProcessFromLaunch({
				launch: input.launch,
				ownerId,
				workingDirectory: input.missionDir ?? '.',
				terminalFields
			});

		const baseData = {
			id: AgentExecution.createEntityId(ownerId, input.launch.agentExecutionId),
			ownerId,
			agentExecutionId: input.launch.agentExecutionId,
			agentId: input.launch.agentId,
			process,
			...(terminalFields.transportId ? { transportId: terminalFields.transportId } : input.launch.transportId ? { transportId: input.launch.transportId } : {}),
			...(input.launch.agentJournalPath ? { agentJournalPath: input.launch.agentJournalPath } : {}),
			...(input.launch.terminalRecordingPath ? { terminalRecordingPath: input.launch.terminalRecordingPath } : {}),
			...(terminalFields.terminalHandle
				? { terminalHandle: terminalFields.terminalHandle }
				: input.launch.terminalHandle
					? { terminalHandle: { ...input.launch.terminalHandle } }
					: {}),
			adapterLabel: input.adapterLabel,
			lifecycleState: liveProcess?.status ?? input.launch.lifecycle,
			...(liveProcess?.attention ? { attention: liveProcess.attention } : {}),
			...(effectiveActivityState
				? { activityState: effectiveActivityState }
				: {}),
			createdAt: input.launch.launchedAt,
			lastUpdatedAt: liveProcess?.updatedAt ?? input.launch.updatedAt,
			...(input.launch.assignmentLabel ? { assignmentLabel: input.launch.assignmentLabel } : {}),
			...(liveProcess?.workingDirectory ? { workingDirectory: liveProcess.workingDirectory } : {}),
			...(input.launch.currentTurnTitle ? { currentTurnTitle: input.launch.currentTurnTitle } : {}),
			interactionCapabilities: resolveAgentExecutionInputCapabilities({
				lifecycleState: liveProcess?.status ?? input.launch.lifecycle,
				transport: liveProcess?.transport
					?? (terminalFields.terminalHandle
						? {
							kind: 'terminal',
							terminalName: terminalFields.terminalHandle.terminalName,
							terminalPaneId: terminalFields.terminalHandle.terminalPaneId
						}
						: undefined),
				...(liveProcess?.acceptsPrompts !== undefined
					? { acceptsPrompts: liveProcess.acceptsPrompts }
					: {}),
				...(liveProcess?.acceptedCommands
					? { acceptedCommands: liveProcess.acceptedCommands }
					: {})
			}),
			supportedMessages: resolveAgentExecutionSupportedMessages({
				lifecycleState: liveProcess?.status ?? input.launch.lifecycle,
				...(liveProcess?.acceptsPrompts !== undefined
					? { acceptsPrompts: liveProcess.acceptsPrompts }
					: {}),
				...(liveProcess?.acceptedCommands
					? { acceptedCommands: liveProcess.acceptedCommands }
					: {})
			}),
			...(protocolDescriptor ? { protocolDescriptor } : {}),
			...(liveProcess?.progress
				? {
					liveActivity: createAgentExecutionLiveActivity(liveProcess.progress)
				}
				: {}),
			...(liveProcess?.failureMessage ? { failureMessage: liveProcess.failureMessage } : {})
		};

		return AgentExecutionSchema.parse({
			...baseData,
			context: AgentExecution.createContext(baseData),
			timeline: AgentExecutionTimelineSchema.parse({ timelineItems: [] })
		});
	}

	public static createDataFromExecutionUpdate(input: {
		execution: AgentExecutionProcess;
		adapterLabel: string;
		existing?: AgentExecutionType;
	}): AgentExecutionType {
		const { execution, adapterLabel, existing } = input;
		const baseData = existing
			? AgentExecution.cloneData(existing)
			: AgentExecution.toDataFromExecution(execution, { adapterLabel });
		const terminalFields = getAgentExecutionTerminalFields(execution);
		const awaitingResponseToMessageId = baseData.awaitingResponseToMessageId;
		const effectiveActivityState = deriveAgentExecutionActivityFromProcess({
			process: execution,
			fallbackActivity: baseData.activityState,
			awaitingResponseToMessageId
		});
		const protocolDescriptor = AgentExecution.createProtocolDescriptorForExecution(execution);
		return AgentExecutionSchema.parse({
			...baseData,
			id: AgentExecution.createEntityId(execution.ownerId, execution.agentExecutionId),
			ownerId: execution.ownerId,
			agentId: execution.agentId,
			process: cloneAgentExecutionProcess(execution),
			...(terminalFields.transportId ? { transportId: terminalFields.transportId } : {}),
			adapterLabel,
			agentExecutionId: execution.agentExecutionId,
			...(baseData.agentJournalPath ? { agentJournalPath: baseData.agentJournalPath } : {}),
			...(baseData.terminalRecordingPath ? { terminalRecordingPath: baseData.terminalRecordingPath } : {}),
			...(terminalFields.terminalHandle
				? { terminalHandle: terminalFields.terminalHandle }
				: baseData.terminalHandle
					? { terminalHandle: { ...baseData.terminalHandle } }
					: {}),
			lifecycleState: execution.status,
			attention: execution.attention,
			...(effectiveActivityState
				? { activityState: effectiveActivityState }
				: baseData.activityState
					? { activityState: baseData.activityState }
					: {}),
			...(baseData.currentInputRequestId !== undefined ? { currentInputRequestId: baseData.currentInputRequestId } : {}),
			...(awaitingResponseToMessageId !== undefined ? { awaitingResponseToMessageId } : {}),
			lastUpdatedAt: execution.updatedAt,
			...(execution.workingDirectory
				? { workingDirectory: execution.workingDirectory }
				: baseData.workingDirectory
					? { workingDirectory: baseData.workingDirectory }
					: {}),
			...(baseData.currentTurnTitle ? { currentTurnTitle: baseData.currentTurnTitle } : {}),
			interactionCapabilities: execution.interactionCapabilities
				? { ...execution.interactionCapabilities }
				: resolveAgentExecutionInputCapabilities({
					lifecycleState: execution.status,
					...(execution.transport ? { transport: execution.transport } : {}),
					acceptsPrompts: execution.acceptsPrompts,
					acceptedCommands: execution.acceptedCommands
				}),
			supportedMessages: resolveAgentExecutionSupportedMessages({
				lifecycleState: execution.status,
				acceptsPrompts: execution.acceptsPrompts,
				acceptedCommands: execution.acceptedCommands
			}),
			protocolDescriptor,
			...(baseData.transportState ? { transportState: AgentExecution.cloneTransportState(baseData.transportState) } : {}),
			...(execution.progress
				? {
					liveActivity: createAgentExecutionLiveActivity(execution.progress)
				}
				: baseData.liveActivity
					? { liveActivity: cloneStructured(baseData.liveActivity) }
					: {}),
			...(execution.failureMessage
				? { failureMessage: execution.failureMessage }
				: baseData.failureMessage
					? { failureMessage: baseData.failureMessage }
					: {})
		});
	}

	public static cloneTransportState(
		transportState: AgentExecutionTransportStateType
	): AgentExecutionTransportStateType {
		return {
			selected: transportState.selected,
			degraded: false
		};
	}

	private readonly listeners = new Set<(event: AgentExecutionEvent) => void>();
	private readonly dataChangeListeners = new Set<(data: AgentExecutionType) => void>();
	private timeline: AgentExecutionTimelineType = AgentExecutionTimelineSchema.parse({ timelineItems: [] });
	private liveExecution: AgentExecutionProcess | undefined;
	private disposed = false;

	public static createLive(execution: AgentExecutionProcess, options: { adapterLabel?: string; protocolDescriptor?: AgentExecutionProtocolDescriptorType; transportState?: AgentExecutionTransportStateType } = {}): AgentExecution {
		const liveExecution = new AgentExecution(AgentExecution.toDataFromExecution(execution, options));
		liveExecution.liveExecution = cloneAgentExecutionProcess(execution);
		return liveExecution;
	}

	private static toDataFromExecution(execution: AgentExecutionProcess, options: { adapterLabel?: string; protocolDescriptor?: AgentExecutionProtocolDescriptorType; transportState?: AgentExecutionTransportStateType } = {}): AgentExecutionType {
		return AgentExecutionSchema.parse({
			id: AgentExecution.createEntityId(execution.ownerId, execution.agentExecutionId),
			ownerId: execution.ownerId,
			agentExecutionId: execution.agentExecutionId,
			agentId: execution.agentId,
			process: cloneAgentExecutionProcess(execution),
			...(execution.transport?.kind === 'terminal' ? { transportId: 'terminal' } : {}),
			adapterLabel: options.adapterLabel?.trim() || execution.agentId,
			lifecycleState: execution.status,
			attention: execution.attention,
			...(deriveAgentExecutionActivityFromProcess({ process: execution, fallbackActivity: undefined, awaitingResponseToMessageId: undefined })
				? { activityState: deriveAgentExecutionActivityFromProcess({ process: execution, fallbackActivity: undefined, awaitingResponseToMessageId: undefined }) }
				: {}),
			...(execution.transport?.kind === 'terminal'
				? {
					terminalHandle: {
						terminalName: execution.transport.terminalName,
						terminalPaneId: execution.transport.terminalPaneId ?? execution.transport.terminalName
					}
				}
				: {}),
			workingDirectory: execution.workingDirectory,
			interactionCapabilities: execution.interactionCapabilities
				? { ...execution.interactionCapabilities }
				: resolveAgentExecutionInputCapabilities({
					lifecycleState: execution.status,
					...(execution.transport ? { transport: execution.transport } : {}),
					acceptsPrompts: execution.acceptsPrompts,
					acceptedCommands: execution.acceptedCommands
				}),
			context: AgentExecutionContextSchema.parse({ artifacts: [], instructions: [] }),
			supportedMessages: resolveAgentExecutionSupportedMessages({
				lifecycleState: execution.status,
				acceptsPrompts: execution.acceptsPrompts,
				acceptedCommands: execution.acceptedCommands
			}),
			protocolDescriptor: options.protocolDescriptor ?? AgentExecution.createProtocolDescriptorForExecution(execution),
			...(options.transportState ? { transportState: AgentExecution.cloneTransportState(options.transportState) } : {}),
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
			liveActivity: createAgentExecutionLiveActivity(execution.progress),
			createdAt: execution.startedAt,
			lastUpdatedAt: execution.updatedAt,
			...(execution.failureMessage ? { failureMessage: execution.failureMessage } : {}),
			...(execution.endedAt ? { endedAt: execution.endedAt } : {})
		});
	}

	public constructor(data: AgentExecutionType) {
		super(AgentExecutionSchema.parse(data));
		this.timeline = cloneAgentExecutionTimeline(this.data.timeline);
	}

	public override updateFromData(data: AgentExecutionType): this {
		super.updateFromData(data);
		this.timeline = cloneAgentExecutionTimeline(this.data.timeline);
		return this;
	}

	public override toData(): AgentExecutionType {
		return AgentExecutionSchema.parse({
			...super.toData(),
			timeline: cloneAgentExecutionTimeline(this.timeline)
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
		return this.toData().id;
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
		return cloneAgentExecutionProcess(this.liveExecution);
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
				id: createAgentExecutionTimelineItemId(execution.agentExecutionId, execution.updatedAt, 'operator', prompt.text),
				occurredAt: execution.updatedAt,
				zone: 'conversation',
				primitive: 'conversation.operator-message',
				behavior: createTimelineBehavior('conversational'),
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
		const nextActivityState = deriveAgentExecutionActivityFromProcess({
			process: this.liveExecution,
			fallbackActivity: baseData.activityState,
			awaitingResponseToMessageId: messageId
		});
		const nextLiveActivity = this.liveExecution?.progress
			? createAgentExecutionLiveActivity(this.liveExecution.progress)
			: baseData.liveActivity;
		this.data = AgentExecutionSchema.parse({
			...baseData,
			...(this.liveExecution ? { process: cloneAgentExecutionProcess(this.liveExecution) } : {}),
			...(messageId !== undefined ? { awaitingResponseToMessageId: messageId } : {}),
			...(nextActivityState ? { activityState: nextActivityState } : {}),
			...(nextLiveActivity ? { liveActivity: cloneStructured(nextLiveActivity) } : {}),
			lastUpdatedAt: updatedAt,
			timeline: cloneAgentExecutionTimeline(this.timeline)
		});
		this.refreshTimelineState(updatedAt);
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
		return this.submitPrompt(buildAgentExecutionCommandPrompt(command as Exclude<AgentCommand, { type: 'interrupt' }>));
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

	public patch(overrides: AgentExecutionProcessPatch): AgentExecutionProcess {
		this.liveExecution = applyAgentExecutionProcessPatch({
			process: this.getExecution(),
			patch: overrides,
			updatedAt: new Date().toISOString()
		});
		return this.getExecution();
	}

	public emitEvent(event: AgentExecutionEvent): void {
		if (this.disposed) {
			return;
		}
		this.appendTimelineItemFromEvent(event);
		this.liveExecution = cloneAgentExecutionProcess(event.execution);
		this.refreshTimelineState(event.execution.updatedAt);
		for (const listener of this.listeners) {
			listener(event);
		}
		this.notifyDataChanged();
	}

	public applySignalObservation(
		observation: AgentExecutionObservation,
		decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
	): AgentExecutionProcess | void {
		const appendedTimelineItem = this.appendTimelineItemFromObservation(observation, decision);
		const execution = this.applySignalDecision(decision);
		if (appendedTimelineItem && decision.action === 'record-observation-only') {
			this.notifyDataChanged();
		}
		return execution;
	}

	public applySignalDecision(
		decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
	): AgentExecutionProcess | void {
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
		return this.appendTimelineItem(createActivityItemFromAgentExecutionObservation({ observation, decision }));
	}

	private appendTimelineItemFromEvent(event: AgentExecutionEvent): boolean {
		return this.appendTimelineItem(createActivityItemFromAgentExecutionEvent(event));
	}

	private appendTimelineItem(item: AgentExecutionTimelineItemType | undefined): boolean {
		const result = appendAgentExecutionActivityItem({ timeline: this.timeline, item });
		if (!result.appended) {
			return false;
		}
		this.timeline = result.timeline;
		this.data = AgentExecutionSchema.parse({
			...super.toData(),
			...(this.liveExecution ? { process: cloneAgentExecutionProcess(this.liveExecution) } : {}),
			timeline: cloneAgentExecutionTimeline(this.timeline),
			lastUpdatedAt: result.occurredAt
		});
		this.refreshTimelineState(result.occurredAt ?? new Date().toISOString());
		return true;
	}

	private refreshTimelineState(updatedAt: string): void {
		const refreshed = refreshAgentExecutionActivityTimeline({
			execution: super.toData(),
			process: this.liveExecution ? this.getExecution() : undefined,
			timeline: this.timeline,
			updatedAt
		});
		this.timeline = refreshed.timeline;
		this.data = refreshed.execution;
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

	public toEntity(): AgentExecutionType {
		return AgentExecution.cloneData(this.toData());
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
			for (const line of splitAgentExecutionTerminalOutputLines(update.chunk)) {
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

	private static requireRegistryExecution(
		input: { ownerId: string; agentExecutionId: string },
		context: EntityExecutionContext
	): AgentExecutionType {
		const registryData = AgentExecution.readRegistryExecution(input, context);
		if (registryData) {
			return registryData;
		}
		throw new Error(`AgentExecution '${input.agentExecutionId}' is not registered for owner '${input.ownerId}'.`);
	}

	private static assertOwnerMatches(input: { ownerId: string; agentExecutionId: string }, data: AgentExecutionType): void {
		if (data.ownerId !== input.ownerId) {
			throw new Error(`AgentExecution '${input.agentExecutionId}' belongs to owner '${data.ownerId}', not '${input.ownerId}'.`);
		}
	}

	public static applyDerivedInteractionState(data: AgentExecutionType): AgentExecutionType {
		return AgentExecutionSchema.parse({
			...data,
			interactionCapabilities: resolveAgentExecutionInputCapabilities({
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
			supportedMessages: resolveAgentExecutionSupportedMessages({
				lifecycleState: data.lifecycleState,
				...(data.currentInputRequestId !== undefined ? { currentInputRequestId: data.currentInputRequestId } : {})
			})
		});
	}

}

function cloneStructured<T>(input: T): T {
	return JSON.parse(JSON.stringify(input)) as T;
}

function createFreshAgentExecutionId(ownerId: string, agentId: string): string {
	const normalizedOwnerId = createEntityIdentitySegment(ownerId);
	const normalizedAgentId = createEntityIdentitySegment(agentId);
	const suffix = randomUUID().slice(0, 8);
	if (!normalizedOwnerId) {
		return normalizedAgentId ? `${normalizedAgentId}-${suffix}` : `agent-execution-${suffix}`;
	}
	return normalizedAgentId
		? `${normalizedOwnerId}-${normalizedAgentId}-${suffix}`
		: `${normalizedOwnerId}-${suffix}`;
}

function toRuntimeExecutionEvent(
	eventType: 'execution.updated' | 'execution.completed' | 'execution.failed',
	snapshot: AgentExecutionProcess
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

