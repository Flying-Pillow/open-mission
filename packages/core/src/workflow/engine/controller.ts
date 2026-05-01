import type { MissionDescriptor } from '../../types.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import {
    MissionWorkflowEventRecordSchema,
    MissionStateDataSchema
} from './types.js';
import type {
    AgentLaunchConfig,
    AgentCommand,
    AgentPrompt,
    AgentSessionReference,
    AgentSessionSnapshot
} from '../../daemon/runtime/agent/AgentRuntimeTypes.js';
import {
    buildWorkflowTaskGenerationRequests,
    createMissionWorkflowConfigurationSnapshot,
    createMissionStateData,
    ingestMissionWorkflowEvent,
    type MissionWorkflowConfigurationSnapshot,
    type MissionWorkflowEvent,
    type MissionWorkflowEventRecord,
    type MissionWorkflowRequest,
    type MissionStateData
} from './index.js';
import { DEFAULT_WORKFLOW_VERSION } from '../mission/workflow.js';
import type { MissionWorkflowRequestExecutor } from './requestExecutor.js';
import type { WorkflowDefinition } from './types.js';

export interface MissionWorkflowControllerOptions {
    adapter: FilesystemAdapter;
    descriptor: MissionDescriptor;
    workflow: WorkflowDefinition;
    resolveWorkflow?: () => WorkflowDefinition;
    requestExecutor: MissionWorkflowRequestExecutor;
    workflowVersion?: string;
}

export class MissionWorkflowController {
    private readonly descriptor: MissionDescriptor;
    private readonly adapter: FilesystemAdapter;
    private readonly requestExecutor: MissionWorkflowRequestExecutor;
    private readonly workflowVersion: string;
    private readonly workflow: WorkflowDefinition;
    private readonly resolveWorkflowOverride: (() => WorkflowDefinition) | undefined;
    private document: MissionStateData | undefined;
    private mutationQueue: Promise<void> = Promise.resolve();

    public constructor(options: MissionWorkflowControllerOptions) {
        this.descriptor = options.descriptor;
        this.adapter = options.adapter;
        this.workflow = options.workflow;
        this.resolveWorkflowOverride = options.resolveWorkflow;
        this.requestExecutor = options.requestExecutor;
        this.workflowVersion = options.workflowVersion ?? DEFAULT_WORKFLOW_VERSION;
    }

    public async initialize(): Promise<MissionStateData | undefined> {
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

    public async refresh(): Promise<MissionStateData | undefined> {
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

    public async getDocument(): Promise<MissionStateData> {
        if (this.document) {
            return this.document;
        }
        const document = await this.refresh();
        if (!document) {
            throw new Error(`Mission workflow document is missing for mission '${this.descriptor.missionId}'.`);
        }
        return document;
    }

    public async getPersistedDocument(): Promise<MissionStateData | undefined> {
        if (this.document) {
            return this.document;
        }
        return this.refresh();
    }

    public async reconcileSessions(): Promise<MissionStateData> {
        const document = await this.getDocument();
        const emittedEvents = await this.requestExecutor.reconcileSessions(document);
        let nextDocument = document;
        for (const emittedEvent of emittedEvents) {
            nextDocument = await this.applyEvent(emittedEvent);
        }
        this.document = nextDocument;
        return nextDocument;
    }

    public listRuntimeSessions(): AgentSessionSnapshot[] {
        return this.requestExecutor.listRuntimeSessions();
    }

    public getRuntimeSession(sessionId: string): AgentSessionSnapshot | undefined {
        return this.requestExecutor.getRuntimeSession(sessionId);
    }

    public async attachRuntimeSession(reference: AgentSessionReference): Promise<AgentSessionSnapshot> {
        return this.requestExecutor.attachSession(reference);
    }

    public async startRuntimeSession(config: AgentLaunchConfig): Promise<AgentSessionSnapshot> {
        return this.requestExecutor.startSession(config);
    }

    public async cancelRuntimeSession(
        sessionId: string,
        reason?: string,
        fallbackTaskId?: string
    ): Promise<MissionStateData> {
        return this.ingestEmittedEvents(
            await this.requestExecutor.cancelRuntimeSession(sessionId, reason, fallbackTaskId)
        );
    }

    public async promptRuntimeSession(sessionId: string, prompt: AgentPrompt): Promise<MissionStateData> {
        return this.ingestEmittedEvents(await this.requestExecutor.promptRuntimeSession(sessionId, prompt));
    }

    public async completeRuntimeSession(
        sessionId: string,
        fallbackTaskId?: string
    ): Promise<MissionStateData> {
        return this.ingestEmittedEvents(
            await this.requestExecutor.completeRuntimeSession(sessionId, fallbackTaskId)
        );
    }

    public async commandRuntimeSession(sessionId: string, command: AgentCommand): Promise<MissionStateData> {
        return this.ingestEmittedEvents(await this.requestExecutor.commandRuntimeSession(sessionId, command));
    }

    public async terminateRuntimeSession(
        sessionId: string,
        reason?: string,
        fallbackTaskId?: string
    ): Promise<MissionStateData> {
        return this.ingestEmittedEvents(
            await this.requestExecutor.terminateRuntimeSession(sessionId, reason, fallbackTaskId)
        );
    }

    public async startFromDraft(input?: {
        occurredAt?: string;
        source?: MissionWorkflowEvent['source'];
        startMission?: boolean;
    }): Promise<MissionStateData> {
        const occurredAt = input?.occurredAt ?? new Date().toISOString();
        let document = await this.readRuntimeData();
        if (!document) {
            const configuration = createMissionWorkflowConfigurationSnapshot({
                createdAt: occurredAt,
                workflowVersion: this.workflowVersion,
                workflow: this.resolveWorkflow()
            });
            const created = ingestMissionWorkflowEvent(
                createMissionStateData({
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
                missionStateData: document,
                appendMissionEventRecords: [created.eventRecord]
            });
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

    public getConfigurationSnapshot(): MissionWorkflowConfigurationSnapshot | undefined {
        return this.document?.configuration;
    }

    public async applyEvent(event: MissionWorkflowEvent): Promise<MissionStateData> {
        return this.runExclusiveMutation(() => this.applyEventUnlocked(event));
    }

    private async applyEventUnlocked(event: MissionWorkflowEvent): Promise<MissionStateData> {
        const document = await this.requireDocument();
        const existingEventRecords = await this.readEventLog().catch(() => []);
        if (existingEventRecords.some((eventRecord) => eventRecord.eventId === event.eventId)) {
            return document;
        }
        const ingested = ingestMissionWorkflowEvent(document, event);
        await this.writeRuntimeData({
            transactionId: ingested.eventRecord.eventId,
            missionStateData: ingested.document,
            appendMissionEventRecords: [ingested.eventRecord]
        });
        let nextDocument = ingested.document;
        this.document = ingested.document;
        const emittedEvents = await this.executeRequests(nextDocument, ingested.requests);
        for (const emittedEvent of emittedEvents) {
            nextDocument = await this.applyEventUnlocked(emittedEvent);
        }
        this.document = nextDocument;
        return nextDocument;
    }

    public async generateTasksForStage(stageId: string): Promise<MissionStateData> {
        const document = await this.getDocument();
        const emittedEvents = await this.executeRequests(document, [{
            requestId: `tasks.request-generation:manual:${stageId}:${new Date().toISOString()}`,
            type: 'tasks.request-generation',
            payload: { stageId }
        }]);
        return this.ingestEmittedEvents(emittedEvents);
    }

    private async executeRequests(
        document: MissionStateData,
        requests: MissionWorkflowRequest[]
    ): Promise<MissionWorkflowEvent[]> {
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

    private async ingestEmittedEvents(events: MissionWorkflowEvent[]): Promise<MissionStateData> {
        let nextDocument = await this.getDocument();
        for (const emittedEvent of events) {
            nextDocument = await this.applyEvent(emittedEvent);
        }
        this.document = nextDocument;
        return nextDocument;
    }

    private async requireDocument(): Promise<MissionStateData> {
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
        missionStateData: MissionStateData;
        appendMissionEventRecords?: MissionWorkflowEventRecord[];
    }): Promise<void> {
        if (input.missionStateData.missionId !== this.descriptor.missionId) {
            throw new Error(`Mission write '${input.transactionId}' targets Mission '${input.missionStateData.missionId}' but controller owns Mission '${this.descriptor.missionId}'.`);
        }
        await this.adapter.writeMissionStateDataFile(
            this.descriptor.missionDir,
            MissionStateDataSchema.parse(input.missionStateData)
        );
        for (const eventRecord of input.appendMissionEventRecords ?? []) {
            await this.adapter.appendMissionEventRecordFile(
                this.descriptor.missionDir,
                parseMissionEventRecord(eventRecord)
            );
        }
    }

    private async readRuntimeData(): Promise<MissionStateData | undefined> {
        const rawData = await this.adapter.readMissionStateDataFile(this.descriptor.missionDir);
        return rawData === undefined ? undefined : MissionStateDataSchema.parse(rawData);
    }

    private async readEventLog(): Promise<MissionWorkflowEventRecord[]> {
        return MissionWorkflowEventRecordSchema.array()
            .parse(await this.adapter.readMissionEventLogFile(this.descriptor.missionDir))
            .map(parseMissionEventRecord);
    }

    private resolveWorkflow(): WorkflowDefinition {
        return this.resolveWorkflowOverride?.() ?? this.workflow;
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
        document: MissionStateData
    ): Promise<MissionStateData> {
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

function parseMissionEventRecord(value: unknown): MissionWorkflowEventRecord {
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

