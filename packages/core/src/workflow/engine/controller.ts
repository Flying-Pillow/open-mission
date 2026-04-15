import type { MissionDescriptor } from '../../types.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import type {
	AgentLaunchConfig,
    AgentCommand,
    AgentPrompt,
    AgentSessionReference,
    AgentSessionSnapshot
} from '../../agent/AgentRuntimeTypes.js';
import {
    createMissionWorkflowConfigurationSnapshot,
    createMissionRuntimeRecordForMission,
    ingestMissionWorkflowEvent,
    type MissionWorkflowConfigurationSnapshot,
    type MissionWorkflowEvent,
    type MissionWorkflowRequest,
    type MissionRuntimeRecord
} from './index.js';
import { DEFAULT_WORKFLOW_VERSION } from './defaultWorkflow.js';
import type { MissionWorkflowRequestExecutor } from './requestExecutor.js';
import type { WorkflowGlobalSettings } from './types.js';

export interface MissionWorkflowControllerOptions {
    adapter: FilesystemAdapter;
    descriptor: MissionDescriptor;
    workflow: WorkflowGlobalSettings;
    resolveWorkflow?: () => WorkflowGlobalSettings;
    requestExecutor: MissionWorkflowRequestExecutor;
    workflowVersion?: string;
}

export class MissionWorkflowController {
    private readonly adapter: FilesystemAdapter;
    private readonly descriptor: MissionDescriptor;
    private readonly requestExecutor: MissionWorkflowRequestExecutor;
    private readonly workflowVersion: string;
    private readonly workflow: WorkflowGlobalSettings;
    private readonly resolveWorkflowOverride: (() => WorkflowGlobalSettings) | undefined;
    private document: MissionRuntimeRecord | undefined;

    public constructor(options: MissionWorkflowControllerOptions) {
        this.adapter = options.adapter;
        this.descriptor = options.descriptor;
        this.workflow = options.workflow;
        this.resolveWorkflowOverride = options.resolveWorkflow;
        this.requestExecutor = options.requestExecutor;
        this.workflowVersion = options.workflowVersion ?? DEFAULT_WORKFLOW_VERSION;
    }

    public async initialize(): Promise<MissionRuntimeRecord | undefined> {
        let document = await this.adapter.readMissionRuntimeRecord(this.descriptor.missionDir);
        if (document) {
            document = await this.normalizePersistedDocument(document);
        }
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

    public async refresh(): Promise<MissionRuntimeRecord | undefined> {
        const persisted = await this.adapter.readMissionRuntimeRecord(this.descriptor.missionDir);
        const document = persisted ? await this.normalizePersistedDocument(persisted) : undefined;
        if (!document) {
            this.document = undefined;
            return undefined;
        }
        this.document = document;
        const synchronized = await this.ensureGeneratedTasksForEligibleStage(document);
        this.document = synchronized;
        return synchronized;
    }

    public async getDocument(): Promise<MissionRuntimeRecord> {
        if (this.document) {
            return this.document;
        }
        const document = await this.refresh();
        if (!document) {
            throw new Error(`Mission workflow document is missing for mission '${this.descriptor.missionId}'.`);
        }
        return document;
    }

    public async getPersistedDocument(): Promise<MissionRuntimeRecord | undefined> {
        if (this.document) {
            return this.document;
        }
        return this.refresh();
    }

    public async reconcileSessions(): Promise<MissionRuntimeRecord> {
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
    ): Promise<MissionRuntimeRecord> {
        return this.ingestEmittedEvents(
            await this.requestExecutor.cancelRuntimeSession(sessionId, reason, fallbackTaskId)
        );
    }

    public async promptRuntimeSession(sessionId: string, prompt: AgentPrompt): Promise<MissionRuntimeRecord> {
		return this.ingestEmittedEvents(await this.requestExecutor.promptRuntimeSession(sessionId, prompt));
	}

    public async commandRuntimeSession(sessionId: string, command: AgentCommand): Promise<MissionRuntimeRecord> {
		return this.ingestEmittedEvents(await this.requestExecutor.commandRuntimeSession(sessionId, command));
	}

    public async terminateRuntimeSession(
        sessionId: string,
        reason?: string,
        fallbackTaskId?: string
    ): Promise<MissionRuntimeRecord> {
        return this.ingestEmittedEvents(
            await this.requestExecutor.terminateRuntimeSession(sessionId, reason, fallbackTaskId)
        );
    }

    public async startFromDraft(input?: {
        occurredAt?: string;
        source?: MissionWorkflowEvent['source'];
        startMission?: boolean;
    }): Promise<MissionRuntimeRecord> {
        const occurredAt = input?.occurredAt ?? new Date().toISOString();
        let document = await this.adapter.readMissionRuntimeRecord(this.descriptor.missionDir);
        if (!document) {
            const configuration = createMissionWorkflowConfigurationSnapshot({
                createdAt: occurredAt,
                workflowVersion: this.workflowVersion,
                workflow: this.resolveWorkflow()
            });
            document = ingestMissionWorkflowEvent(
                createMissionRuntimeRecordForMission({
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
            ).document;
            await this.adapter.writeMissionRuntimeRecord(this.descriptor.missionDir, document);
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

    public async applyEvent(event: MissionWorkflowEvent): Promise<MissionRuntimeRecord> {
        const document = await this.requireDocument();
        const ingested = ingestMissionWorkflowEvent(document, event);
        await this.adapter.writeMissionRuntimeRecord(this.descriptor.missionDir, ingested.document);
        let nextDocument = ingested.document;
        this.document = ingested.document;
        const emittedEvents = await this.executeRequests(nextDocument, ingested.requests);
        for (const emittedEvent of emittedEvents) {
            nextDocument = await this.applyEvent(emittedEvent);
        }
        this.document = nextDocument;
        return nextDocument;
    }

    private async executeRequests(
        document: MissionRuntimeRecord,
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

    private async ingestEmittedEvents(events: MissionWorkflowEvent[]): Promise<MissionRuntimeRecord> {
        let nextDocument = await this.getDocument();
        for (const emittedEvent of events) {
            nextDocument = await this.applyEvent(emittedEvent);
        }
        this.document = nextDocument;
        return nextDocument;
    }

    private async requireDocument(): Promise<MissionRuntimeRecord> {
        if (this.document) {
            return this.document;
        }
        const persisted = await this.adapter.readMissionRuntimeRecord(this.descriptor.missionDir);
        const document = persisted ? await this.normalizePersistedDocument(persisted) : undefined;
        if (!document) {
            throw new Error(`Mission runtime record is missing for mission '${this.descriptor.missionId}'.`);
        }
        this.document = document;
        return document;
    }

    private async normalizePersistedDocument(document: MissionRuntimeRecord): Promise<MissionRuntimeRecord> {
        let changed = false;
        const sessions = document.runtime.sessions.map((session) => {
            const normalized = this.requestExecutor.normalizePersistedSessionIdentity(session);
            if (normalized !== session) {
                changed = true;
            }
            return normalized;
        });

        if (!changed) {
            return document;
        }

        const normalizedDocument: MissionRuntimeRecord = {
            ...document,
            runtime: {
                ...document.runtime,
                sessions
            }
        };
        await this.adapter.writeMissionRuntimeRecord(this.descriptor.missionDir, normalizedDocument);
        return normalizedDocument;
    }

    private resolveWorkflow(): WorkflowGlobalSettings {
        return this.resolveWorkflowOverride?.() ?? this.workflow;
    }

    private async ensureGeneratedTasksForEligibleStage(
        document: MissionRuntimeRecord
    ): Promise<MissionRuntimeRecord> {
        if (document.runtime.lifecycle === 'delivered') {
            return document;
        }

        const stageId = this.resolveEligibleStageId(document);
        if (!stageId) {
            return document;
        }

        if (document.runtime.tasks.some((task) => task.stageId === stageId)) {
            return document;
        }

        const generationRule = document.configuration.workflow.taskGeneration.find(
            (candidate) => candidate.stageId === stageId
        );
        if (
            !generationRule
            || (generationRule.templateSources.length === 0 && generationRule.tasks.length === 0)
        ) {
            return document;
        }

        const emittedEvents = await this.executeRequests(document, [
            {
                requestId: `${document.missionId}:refresh:generate:${stageId}`,
                type: 'tasks.request-generation',
                payload: { stageId }
            }
        ]);

        let nextDocument = document;
        for (const emittedEvent of emittedEvents) {
            nextDocument = await this.applyEvent(emittedEvent);
        }
        return nextDocument;
    }

    private resolveEligibleStageId(document: MissionRuntimeRecord): string | undefined {
        for (const stageId of document.configuration.workflow.stageOrder) {
            const stageTasks = document.runtime.tasks.filter((task) => task.stageId === stageId);
            const completed =
                (stageTasks.length > 0 && stageTasks.every((task) => task.lifecycle === 'completed')) ||
                this.isImplicitlyCompletedEmptyFinalStage(document, stageId, stageTasks);
            if (!completed) {
                return stageId;
            }
        }

        return undefined;
    }

    private isImplicitlyCompletedEmptyFinalStage(
        document: MissionRuntimeRecord,
        stageId: string,
        stageTasks: MissionRuntimeRecord['runtime']['tasks']
    ): boolean {
        if (stageTasks.length > 0) {
            return false;
        }

        const finalStageId = document.configuration.workflow.stageOrder[
            document.configuration.workflow.stageOrder.length - 1
        ];
        if (stageId !== finalStageId) {
            return false;
        }

        const generationRule = document.configuration.workflow.taskGeneration.find(
            (candidate) => candidate.stageId === stageId
        );
        if (!generationRule) {
            return true;
        }

        return generationRule.templateSources.length === 0 && generationRule.tasks.length === 0;
    }
}
