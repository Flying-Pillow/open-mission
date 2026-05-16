import type { MissionDescriptor } from '../../entities/Mission/MissionSchema.js';
import type { MissionDossierFilesystem } from '../../entities/Mission/MissionDossierFilesystem.js';
import {
    WorkflowEventRecordSchema,
    WorkflowStateDataSchema
} from './types.js';
import type {
    AgentLaunchConfig,
    AgentCommand,
    AgentPrompt,
    AgentExecutionReference
} from '../../entities/AgentExecution/AgentExecutionSchema.js';
import type { AgentExecutionSignalDecision } from '../../entities/AgentExecution/AgentExecutionSchema.js';
import type { AgentExecutionRuntimeType } from '../../daemon/runtime/agent-execution/AgentExecutionRegistry.js';
import {
    buildWorkflowTaskGenerationRequests,
    createWorkflowConfigurationSnapshot,
    createWorkflowStateData,
    ingestWorkflowEvent,
    type WorkflowConfigurationSnapshot,
    type WorkflowEvent,
    type WorkflowEventRecord,
    type WorkflowRequest,
    type WorkflowStateData
} from './index.js';
import { DEFAULT_WORKFLOW_VERSION } from '../mission/workflow.js';
import type { WorkflowRequestExecutor } from './requestExecutor.js';
import type { WorkflowDefinition } from './types.js';

export interface WorkflowControllerOptions {
    adapter: MissionDossierFilesystem;
    descriptor: MissionDescriptor;
    workflow: WorkflowDefinition;
    resolveWorkflow?: () => WorkflowDefinition;
    requestExecutor: WorkflowRequestExecutor;
    workflowVersion?: string;
    logger?: {
        info(message: string, metadata?: Record<string, unknown>): void;
    };
}

export class WorkflowController {
    private readonly descriptor: MissionDescriptor;
    private readonly adapter: MissionDossierFilesystem;
    private readonly requestExecutor: WorkflowRequestExecutor;
    private readonly workflowVersion: string;
    private readonly workflow: WorkflowDefinition;
    private readonly resolveWorkflowOverride: (() => WorkflowDefinition) | undefined;
    private readonly logger: WorkflowControllerOptions['logger'];
    private document: WorkflowStateData | undefined;
    private mutationQueue: Promise<void> = Promise.resolve();

    public constructor(options: WorkflowControllerOptions) {
        this.descriptor = options.descriptor;
        this.adapter = options.adapter;
        this.workflow = options.workflow;
        this.resolveWorkflowOverride = options.resolveWorkflow;
        this.requestExecutor = options.requestExecutor;
        this.workflowVersion = options.workflowVersion ?? DEFAULT_WORKFLOW_VERSION;
        this.logger = options.logger;
    }

    public async initialize(): Promise<WorkflowStateData | undefined> {
        let document = await this.readRuntimeData();
        if (!document) {
            if (!this.resolveWorkflow().autostart.mission) {
                this.document = undefined;
                return undefined;
            }
            document = await this.startFromDraft({
                occurredAt: this.descriptor.createdAt,
                source: 'system',
                startMission: true
            });
        }
        this.document = document;
        return document;
    }

    public async refresh(): Promise<WorkflowStateData | undefined> {
        const persisted = await this.readRuntimeData();
        const document = persisted;
        if (!document) {
            this.document = undefined;
            return undefined;
        }
        this.document = document;
        const synchronized = await this.reconcileDerivedRequests(document);
        this.document = synchronized;
        return synchronized;
    }

    public async getDocument(): Promise<WorkflowStateData> {
        if (this.document) {
            return this.document;
        }
        const document = await this.refresh();
        if (!document) {
            throw new Error(`Mission runtime data is missing for mission '${this.descriptor.missionId}'.`);
        }
        return document;
    }

    public async getPersistedDocument(): Promise<WorkflowStateData | undefined> {
        if (this.document) {
            return this.document;
        }
        return this.refresh();
    }

    public async reconcileExecutions(): Promise<WorkflowStateData> {
        const document = await this.getDocument();
        const emittedEvents = await this.requestExecutor.reconcileExecutions(document);
        let nextDocument = document;
        for (const emittedEvent of emittedEvents) {
            nextDocument = await this.applyEvent(emittedEvent);
        }
        this.document = nextDocument;
        return nextDocument;
    }

    public listRuntimeAgentExecutions(): AgentExecutionRuntimeType[] {
        return this.requestExecutor.listRuntimeAgentExecutions();
    }

    public getRuntimeAgentExecution(agentExecutionId: string): AgentExecutionRuntimeType | undefined {
        return this.requestExecutor.getRuntimeAgentExecution(agentExecutionId);
    }

    public applyRuntimeAgentExecutionSignalDecision(
        agentExecutionId: string,
        decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>
    ): AgentExecutionRuntimeType | undefined {
        return this.requestExecutor.applyRuntimeAgentExecutionSignalDecision(agentExecutionId, decision);
    }

    public async attachRuntimeAgentExecution(reference: AgentExecutionReference): Promise<AgentExecutionRuntimeType> {
        return this.requestExecutor.reconcileExecution(reference);
    }

    public async startRuntimeAgentExecution(config: AgentLaunchConfig): Promise<AgentExecutionRuntimeType> {
        return this.requestExecutor.startExecution(config);
    }

    public async cancelProcessAgentExecution(
        agentExecutionId: string,
        reason?: string,
        fallbackTaskId?: string
    ): Promise<WorkflowStateData> {
        return this.ingestEmittedEvents(
            await this.requestExecutor.cancelProcessAgentExecution(agentExecutionId, reason, fallbackTaskId)
        );
    }

    public async promptRuntimeAgentExecution(agentExecutionId: string, prompt: AgentPrompt): Promise<WorkflowStateData> {
        return this.ingestEmittedEvents(await this.requestExecutor.promptRuntimeAgentExecution(agentExecutionId, prompt));
    }

    public async completeRuntimeAgentExecution(
        agentExecutionId: string,
        fallbackTaskId?: string
    ): Promise<WorkflowStateData> {
        return this.ingestEmittedEvents(
            await this.requestExecutor.completeRuntimeAgentExecution(agentExecutionId, fallbackTaskId)
        );
    }

    public async commandRuntimeAgentExecution(agentExecutionId: string, command: AgentCommand): Promise<WorkflowStateData> {
        return this.ingestEmittedEvents(await this.requestExecutor.commandRuntimeAgentExecution(agentExecutionId, command));
    }

    public async terminateProcessAgentExecution(
        agentExecutionId: string,
        reason?: string,
        fallbackTaskId?: string
    ): Promise<WorkflowStateData> {
        return this.ingestEmittedEvents(
            await this.requestExecutor.terminateProcessAgentExecution(agentExecutionId, reason, fallbackTaskId)
        );
    }

    public async startFromDraft(input?: {
        occurredAt?: string;
        source?: WorkflowEvent['source'];
        startMission?: boolean;
    }): Promise<WorkflowStateData> {
        const occurredAt = input?.occurredAt ?? new Date().toISOString();
        let document = await this.readRuntimeData();
        if (!document) {
            const configuration = createWorkflowConfigurationSnapshot({
                createdAt: occurredAt,
                workflowVersion: this.workflowVersion,
                workflow: this.resolveWorkflow()
            });
            const created = ingestWorkflowEvent(
                createWorkflowStateData({
                    missionId: this.descriptor.missionId,
                    configuration,
                    createdAt: occurredAt
                }),
                {
                    eventId: `${this.descriptor.missionId}:mission-created`,
                    type: 'mission.created',
                    occurredAt,
                    source: input?.source ?? 'system'
                }
            );
            document = created.document;
            await this.writeRuntimeData({
                transactionId: created.eventRecord.eventId,
                workflowStateData: document,
                appendMissionEventRecords: [created.eventRecord]
            });
            this.logWorkflowEvent(created.eventRecord.eventId, created.eventRecord);
            this.document = document;

            const emittedEvents = await this.executeRequests(document, created.requests);
            for (const emittedEvent of emittedEvents) {
                document = await this.applyEvent(emittedEvent);
            }
            this.document = document;
        } else {
            this.document = document;
        }

        if (input?.startMission === false) {
            return document;
        }

        if (document.runtime.lifecycle === 'running' || document.runtime.lifecycle === 'paused') {
            return document;
        }

        return this.applyEvent({
            eventId: `${this.descriptor.missionId}:mission-started`,
            type: 'mission.started',
            occurredAt,
            source: input?.source ?? 'system'
        });
    }

    public getConfigurationSnapshot(): WorkflowConfigurationSnapshot | undefined {
        return this.document?.configuration;
    }

    public async applyEvent(event: WorkflowEvent): Promise<WorkflowStateData> {
        return this.runExclusiveMutation(() => this.applyEventUnlocked(event));
    }

    private async applyEventUnlocked(event: WorkflowEvent): Promise<WorkflowStateData> {
        const document = await this.requireDocument();
        const existingEventRecords = await this.readEventLog().catch(() => []);
        if (existingEventRecords.some((eventRecord) => eventRecord.eventId === event.eventId)) {
            return document;
        }
        const ingested = ingestWorkflowEvent(document, event);
        await this.writeRuntimeData({
            transactionId: ingested.eventRecord.eventId,
            workflowStateData: ingested.document,
            appendMissionEventRecords: [ingested.eventRecord]
        });
        this.logWorkflowEvent(ingested.eventRecord.eventId, event);
        let nextDocument = ingested.document;
        this.document = ingested.document;
        const emittedEvents = await this.executeRequests(nextDocument, ingested.requests);
        for (const emittedEvent of emittedEvents) {
            nextDocument = await this.applyEventUnlocked(emittedEvent);
        }
        this.document = nextDocument;
        return nextDocument;
    }

    public async generateTasksForStage(stageId: string): Promise<WorkflowStateData> {
        const document = await this.getDocument();
        const emittedEvents = await this.executeRequests(document, [{
            requestId: `tasks.request-generation:manual:${stageId}:${new Date().toISOString()}`,
            type: 'tasks.request-generation',
            payload: { stageId }
        }]);
        return this.ingestEmittedEvents(emittedEvents);
    }

    private async executeRequests(
        document: WorkflowStateData,
        requests: WorkflowRequest[]
    ): Promise<WorkflowEvent[]> {
        if (requests.length === 0) {
            return [];
        }
        return this.requestExecutor.executeRequests({
            missionId: document.missionId,
            descriptor: this.descriptor,
            configuration: document.configuration,
            runtime: document.runtime,
            requests
        });
    }

    private async ingestEmittedEvents(events: WorkflowEvent[]): Promise<WorkflowStateData> {
        let nextDocument = await this.getDocument();
        for (const emittedEvent of events) {
            nextDocument = await this.applyEvent(emittedEvent);
        }
        this.document = nextDocument;
        return nextDocument;
    }

    private async requireDocument(): Promise<WorkflowStateData> {
        if (this.document) {
            return this.document;
        }
        const persisted = await this.readRuntimeData();
        const document = persisted;
        if (!document) {
            throw new Error(`Mission runtime data is missing for mission '${this.descriptor.missionId}'.`);
        }
        this.document = document;
        return document;
    }

    private async writeRuntimeData(input: {
        transactionId: string;
        workflowStateData: WorkflowStateData;
        appendMissionEventRecords?: WorkflowEventRecord[];
    }): Promise<void> {
        if (input.workflowStateData.missionId !== this.descriptor.missionId) {
            throw new Error(`Mission write '${input.transactionId}' targets Mission '${input.workflowStateData.missionId}' but controller owns Mission '${this.descriptor.missionId}'.`);
        }
        await this.adapter.writeWorkflowStateDataFile(
            this.descriptor.missionDir,
            WorkflowStateDataSchema.parse(input.workflowStateData)
        );
        for (const eventRecord of input.appendMissionEventRecords ?? []) {
            await this.adapter.appendMissionEventRecordFile(
                this.descriptor.missionDir,
                parseMissionEventRecord(eventRecord)
            );
        }
    }

    private async readRuntimeData(): Promise<WorkflowStateData | undefined> {
        const rawData = await this.adapter.readWorkflowStateDataFile(this.descriptor.missionDir);
        return rawData === undefined ? undefined : WorkflowStateDataSchema.parse(rawData);
    }

    private async readEventLog(): Promise<WorkflowEventRecord[]> {
        return WorkflowEventRecordSchema.array()
            .parse(await this.adapter.readMissionEventLogFile(this.descriptor.missionDir))
            .map(parseMissionEventRecord);
    }

    private resolveWorkflow(): WorkflowDefinition {
        return this.resolveWorkflowOverride?.() ?? this.workflow;
    }

    private logWorkflowEvent(transactionId: string, event: WorkflowEvent | WorkflowEventRecord): void {
        this.logger?.info('Mission workflow event applied.', {
            missionId: this.descriptor.missionId,
            missionDir: this.descriptor.missionDir,
            transactionId,
            ...summarizeWorkflowEvent(event)
        });
    }

    private async runExclusiveMutation<T>(operation: () => Promise<T>): Promise<T> {
        const previous = this.mutationQueue;
        let release!: () => void;
        this.mutationQueue = new Promise<void>((resolve) => {
            release = resolve;
        });
        await previous.catch(() => undefined);
        try {
            return await operation();
        } finally {
            release();
        }
    }

    private async reconcileDerivedRequests(
        document: WorkflowStateData
    ): Promise<WorkflowStateData> {
        const requests = buildWorkflowTaskGenerationRequests(
            document.runtime,
            document.configuration,
            new Date().toISOString()
        );
        if (requests.length === 0) {
            return document;
        }

        const emittedEvents = await this.executeRequests(document, requests);

        let nextDocument = document;
        for (const emittedEvent of emittedEvents) {
            nextDocument = await this.applyEvent(emittedEvent);
        }
        return nextDocument;
    }
}

function summarizeWorkflowEvent(event: WorkflowEvent | WorkflowEventRecord): Record<string, unknown> {
    const payload = 'payload' in event && isRecord(event.payload)
        ? event.payload
        : Object.fromEntries(Object.entries(event));
    return {
        eventId: event.eventId,
        type: event.type,
        source: event.source,
        occurredAt: event.occurredAt,
        ...(event.causedByRequestId ? { causedByRequestId: event.causedByRequestId } : {}),
        ...pickWorkflowPayloadSummary(payload)
    };
}

function pickWorkflowPayloadSummary(payload: Record<string, unknown>): Record<string, unknown> {
    const summary: Record<string, unknown> = {};
    for (const key of [
        'stageId',
        'taskId',
        'agentExecutionId',
        'agentId',
        'transportId',
        'reason',
        'reasonCode',
        'actor',
        'targetType',
        'id',
        'autostart'
    ]) {
        const value = payload[key];
        if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
            summary[key] = value;
        }
    }
    const tasks = payload['tasks'];
    if (Array.isArray(tasks)) {
        summary['taskCount'] = tasks.length;
        summary['taskIds'] = tasks
            .map((task) => isRecord(task) && typeof task['taskId'] === 'string' ? task['taskId'] : undefined)
            .filter((taskId): taskId is string => Boolean(taskId));
    }
    const terminalHandle = payload['terminalHandle'];
    if (isRecord(terminalHandle)) {
        summary['terminalName'] = typeof terminalHandle['terminalName'] === 'string'
            ? terminalHandle['terminalName']
            : undefined;
        summary['terminalPaneId'] = typeof terminalHandle['terminalPaneId'] === 'string'
            ? terminalHandle['terminalPaneId']
            : undefined;
    }
    const artifactRefs = payload['artifactRefs'];
    if (Array.isArray(artifactRefs)) {
        summary['artifactRefCount'] = artifactRefs.length;
    }
    return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMissionEventRecord(value: unknown): WorkflowEventRecord {
    const parsed = WorkflowEventRecordSchema.parse(value);
    return {
        eventId: parsed.eventId,
        type: parsed.type,
        occurredAt: parsed.occurredAt,
        source: parsed.source,
        ...(parsed.causedByRequestId ? { causedByRequestId: parsed.causedByRequestId } : {}),
        payload: parsed.payload
    };
}
