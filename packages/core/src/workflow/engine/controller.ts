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
    buildWorkflowTaskGenerationRequests,
    createMissionWorkflowConfigurationSnapshot,
    createMissionRuntimeRecord,
    deriveMissionWorkflowProjectionState,
    ingestMissionWorkflowEvent,
    normalizeGeneratedTaskDependencies,
    type MissionWorkflowConfigurationSnapshot,
    type MissionWorkflowEvent,
    type MissionWorkflowRequest,
    type MissionRuntimeRecord
} from './index.js';
import { DEFAULT_WORKFLOW_VERSION } from '../mission/workflow.js';
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
        const synchronized = await this.reconcileDerivedRequests(document);
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

    public async completeRuntimeSession(
        sessionId: string,
        fallbackTaskId?: string
    ): Promise<MissionRuntimeRecord> {
        return this.ingestEmittedEvents(
            await this.requestExecutor.completeRuntimeSession(sessionId, fallbackTaskId)
        );
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
            const created = ingestMissionWorkflowEvent(
                createMissionRuntimeRecord({
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
            await this.adapter.writeMissionRuntimeRecord(this.descriptor.missionDir, document);
            await this.adapter.appendMissionRuntimeEventRecord(this.descriptor.missionDir, created.eventRecord);
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

    public async applyEvent(event: MissionWorkflowEvent): Promise<MissionRuntimeRecord> {
        const document = await this.requireDocument();
        const ingested = ingestMissionWorkflowEvent(document, event);
        await this.adapter.writeMissionRuntimeRecord(this.descriptor.missionDir, ingested.document);
        await this.adapter.appendMissionRuntimeEventRecord(this.descriptor.missionDir, ingested.eventRecord);
        let nextDocument = ingested.document;
        this.document = ingested.document;
        const emittedEvents = await this.executeRequests(nextDocument, ingested.requests);
        for (const emittedEvent of emittedEvents) {
            nextDocument = await this.applyEvent(emittedEvent);
        }
        this.document = nextDocument;
        return nextDocument;
    }

    public async generateTasksForStage(stageId: string): Promise<MissionRuntimeRecord> {
        const document = await this.getDocument();
        const emittedEvents = await this.executeRequests(document, [{
            requestId: `tasks.request-generation:manual:${stageId}:${new Date().toISOString()}`,
            type: 'tasks.request-generation',
            payload: { stageId }
        }]);
        return this.ingestEmittedEvents(emittedEvents);
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
        const configuration = normalizePersistedConfiguration(document.configuration, this.resolveWorkflow(), this.workflowVersion);
        if (configuration !== document.configuration) {
            changed = true;
        }
        const sessions = document.runtime.sessions.map((session) => {
            const normalized = this.requestExecutor.normalizePersistedSessionIdentity(session);
            if (normalized !== session) {
                changed = true;
            }
            return normalized;
        });
        const normalizedSourceDocument = configuration === document.configuration
            ? document
            : {
                ...document,
                configuration
            };
        const tasks = normalizePersistedRuntimeTasks(normalizedSourceDocument);
        if (tasks.some((task, index) => task !== document.runtime.tasks[index])) {
            changed = true;
        }

        if (!changed) {
            return document;
        }

        const normalizedRuntime = {
            ...document.runtime,
            sessions,
            tasks
        };
        const derivedProjection = deriveMissionWorkflowProjectionState(
            normalizedRuntime,
            configuration,
            normalizedRuntime.updatedAt
        );

        const normalizedDocument: MissionRuntimeRecord = {
            ...document,
            configuration,
            runtime: {
                ...normalizedRuntime,
                ...(derivedProjection.activeStageId ? { activeStageId: derivedProjection.activeStageId } : {}),
                tasks: derivedProjection.tasks,
                stages: derivedProjection.stages,
                gates: derivedProjection.gates
            }
        };
        await this.adapter.writeMissionRuntimeRecord(this.descriptor.missionDir, normalizedDocument);
        return normalizedDocument;
    }

    private resolveWorkflow(): WorkflowGlobalSettings {
        return this.resolveWorkflowOverride?.() ?? this.workflow;
    }

    private async reconcileDerivedRequests(
        document: MissionRuntimeRecord
    ): Promise<MissionRuntimeRecord> {
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

function normalizePersistedConfiguration(
    configuration: MissionWorkflowConfigurationSnapshot,
    workflowDefaults: WorkflowGlobalSettings,
    workflowVersion: string
): MissionWorkflowConfigurationSnapshot {
    let changed = configuration.workflowVersion !== workflowVersion;
    const defaultRulesByStageId = new Map(
        workflowDefaults.taskGeneration.map((rule) => [rule.stageId, rule])
    );
    const normalizedTaskGeneration = configuration.workflow.taskGeneration.map((rule) => {
        if (typeof rule.artifactTasks === 'boolean') {
            return rule;
        }

        changed = true;
        const defaultRule = defaultRulesByStageId.get(rule.stageId);
        return {
            ...rule,
            artifactTasks: defaultRule?.artifactTasks ?? false
        };
    });

    if (!changed) {
        return configuration;
    }

    return {
        ...configuration,
        workflowVersion,
        workflow: {
            ...configuration.workflow,
            taskGeneration: normalizedTaskGeneration
        }
    };
}

function normalizePersistedRuntimeTasks(document: MissionRuntimeRecord): MissionRuntimeRecord['runtime']['tasks'] {
    const normalizedDependsOnByTaskId = new Map<string, string[]>();
    const tasksByStage = new Map<string, MissionRuntimeRecord['runtime']['tasks']>();

    for (const task of document.runtime.tasks) {
        const existing = tasksByStage.get(task.stageId);
        if (existing) {
            existing.push(task);
            continue;
        }
        tasksByStage.set(task.stageId, [task]);
    }

    for (const stageTasks of tasksByStage.values()) {
        const normalizedStageTasks = normalizeGeneratedTaskDependencies(stageTasks.map((task) => ({
            taskId: task.taskId,
            title: task.title,
            instruction: task.instruction,
            dependsOn: [...task.dependsOn],
            ...(task.agentRunner ? { agentRunner: task.agentRunner } : {})
        })));
        for (const normalizedTask of normalizedStageTasks) {
            normalizedDependsOnByTaskId.set(normalizedTask.taskId, normalizedTask.dependsOn);
        }
    }

    return document.runtime.tasks.map((task) => {
        const normalizedDependsOn = normalizedDependsOnByTaskId.get(task.taskId) ?? task.dependsOn;
        if (sameStringArray(normalizedDependsOn, task.dependsOn)) {
            return task;
        }
        return {
            ...task,
            dependsOn: normalizedDependsOn
        };
    });
}

function sameStringArray(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
