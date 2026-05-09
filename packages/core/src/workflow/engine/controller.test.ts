import { describe, expect, it } from 'vitest';
import type { MissionDescriptor } from '../../entities/Mission/MissionSchema.js';
import type { MissionDossierFilesystem } from '../../entities/Mission/MissionDossierFilesystem.js';
import {
    createMissionWorkflowConfigurationSnapshot,
    createMissionStateData,
    ingestMissionWorkflowEvent,
    MissionWorkflowController,
    type MissionStateData,
    type MissionWorkflowEvent,
    type MissionWorkflowEventRecord
} from './index.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from '../mission/workflow.js';
import type { MissionWorkflowRequestExecutor } from './requestExecutor.js';

describe('MissionWorkflowController', () => {
    it('executes machine-emitted generation requests while creating Mission runtime data', async () => {
        const adapter = createAdapter();
        const executor = createRequestExecutor();
        const controller = new MissionWorkflowController({
            adapter,
            descriptor: createDescriptor(),
            workflow: createDefaultWorkflowSettings(),
            requestExecutor: executor
        });

        const document = await controller.startFromDraft({
            occurredAt: '2026-04-14T09:00:00.000Z',
            source: 'human',
            startMission: false
        });

        expect(adapter.getPersistedEventLog().map((event) => event.type)).toEqual([
            'mission.created',
            'tasks.generated'
        ]);
        expect(document.runtime.tasks).toContainEqual(expect.objectContaining({
            taskId: 'prd/01',
            stageId: 'prd'
        }));
        expect(executor.getExecutedRequestTypes()).toEqual(['tasks.request-generation']);
    });

    it('replays machine-derived generation requests during refresh recovery', async () => {
        const adapter = createAdapter();
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-14T09:00:00.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });
        adapter.setPersistedDocument(
            ingestMissionWorkflowEvent(
                createMissionStateData({
                    missionId: 'mission-42',
                    configuration,
                    createdAt: configuration.createdAt
                }),
                {
                    eventId: 'mission-42:mission-created',
                    type: 'mission.created',
                    occurredAt: '2026-04-14T09:00:00.000Z',
                    source: 'human'
                }
            ).document
        );

        const executor = createRequestExecutor();
        const controller = new MissionWorkflowController({
            adapter,
            descriptor: createDescriptor(),
            workflow: createDefaultWorkflowSettings(),
            requestExecutor: executor
        });

        const document = await controller.refresh();

        expect(document?.runtime.tasks).toContainEqual(expect.objectContaining({
            taskId: 'prd/01',
            stageId: 'prd'
        }));
        expect(executor.getExecutedRequestTypes()).toEqual(['tasks.request-generation']);
    });

    it('logs applied workflow events with useful event metadata', async () => {
        const adapter = createAdapter();
        const logger = createLogger();
        const controller = new MissionWorkflowController({
            adapter,
            descriptor: createDescriptor(),
            workflow: createDefaultWorkflowSettings(),
            requestExecutor: createRequestExecutor(),
            logger
        });

        await controller.startFromDraft({
            occurredAt: '2026-04-14T09:00:00.000Z',
            source: 'human',
            startMission: false
        });
        await controller.applyEvent({
            eventId: 'task.queued:prd/01:2026-04-14T09:00:02.000Z',
            type: 'task.queued',
            occurredAt: '2026-04-14T09:00:02.000Z',
            source: 'human',
            taskId: 'prd/01',
            agentId: 'copilot-cli'
        });
        await controller.applyEvent({
            eventId: 'task.queued:prd/01:2026-04-14T09:00:02.000Z',
            type: 'task.queued',
            occurredAt: '2026-04-14T09:00:02.000Z',
            source: 'human',
            taskId: 'prd/01',
            agentId: 'copilot-cli'
        });

        expect(logger.entries.map((entry) => entry.message)).toEqual([
            'Mission workflow event applied.',
            'Mission workflow event applied.',
            'Mission workflow event applied.'
        ]);
        expect(logger.entries.map((entry) => entry.metadata['type'])).toEqual([
            'mission.created',
            'tasks.generated',
            'task.queued'
        ]);
        expect(logger.entries[1]?.metadata).toMatchObject({
            missionId: 'mission-42',
            eventId: 'tasks.generated:prd:2026-04-14T09:00:01.000Z',
            stageId: 'prd',
            taskCount: 1,
            taskIds: ['prd/01']
        });
        expect(logger.entries[2]?.metadata).toMatchObject({
            missionId: 'mission-42',
            eventId: 'task.queued:prd/01:2026-04-14T09:00:02.000Z',
            taskId: 'prd/01',
            agentId: 'copilot-cli'
        });
    });

});

function createLogger() {
    const entries: Array<{ message: string; metadata: Record<string, unknown> }> = [];
    return {
        entries,
        info(message: string, metadata?: Record<string, unknown>) {
            entries.push({ message, metadata: metadata ?? {} });
        }
    };
}

function createDescriptor(): MissionDescriptor {
    return {
        missionId: 'mission-42',
        missionDir: '/tmp/mission-42',
        branchRef: 'mission/42-first-class-state-machine',
        createdAt: '2026-04-14T09:00:00.000Z',
        brief: {
            title: 'State machine cleanup',
            body: 'Remove duplicated workflow rules.',
            type: 'refactor'
        }
    } as MissionDescriptor;
}

function createAdapter() {
    let persisted: MissionStateData | undefined;
    const eventLog: MissionWorkflowEventRecord[] = [];

    return {
        readMissionStateDataFile: async () => persisted,
        readMissionEventLogFile: async () => [...eventLog],
        writeMissionStateDataFile: async (_missionDir: string, document: MissionStateData) => {
            persisted = document;
        },
        appendMissionEventRecordFile: async (_missionDir: string, eventRecord: MissionWorkflowEventRecord) => {
            eventLog.push(eventRecord);
        },
        listTaskStates: async () => [],
        getPersistedDocument: () => persisted,
        getPersistedEventLog: () => [...eventLog],
        setPersistedDocument: (document: MissionStateData | undefined) => {
            persisted = document;
        },
        setPersistedEventLog: (records: MissionWorkflowEventRecord[]) => {
            eventLog.splice(0, eventLog.length, ...records);
        }
    } as unknown as MissionDossierFilesystem & {
        getPersistedDocument(): MissionStateData | undefined;
        getPersistedEventLog(): MissionWorkflowEventRecord[];
        setPersistedDocument(document: MissionStateData | undefined): void;
        setPersistedEventLog(records: MissionWorkflowEventRecord[]): void;
    };
}

function createRequestExecutor() {
    const executedRequestTypes: string[] = [];

    return {
        executeRequests: async (input: { requests: Array<{ type: string }> }) => {
            executedRequestTypes.push(...input.requests.map((request) => request.type));
            return input.requests.flatMap((request) =>
                request.type === 'tasks.request-generation'
                    ? [createGeneratedTasksEvent(
                        String((request as { payload?: { stageId?: string } }).payload?.stageId ?? 'prd'),
                        '2026-04-14T09:00:01.000Z'
                    )]
                    : []
            );
        },
        reconcileExecutions: async () => [],
        listRuntimeAgentExecutions: () => [],
        getRuntimeAgentExecution: () => undefined,
        attachTerminal: async () => {
            throw new Error('not implemented for test');
        },
        startExecution: async () => {
            throw new Error('not implemented for test');
        },
        cancelRuntimeAgentExecution: async () => [],
        promptRuntimeAgentExecution: async () => [],
        commandRuntimeAgentExecution: async () => [],
        terminateRuntimeAgentExecution: async () => [],
        getExecutedRequestTypes: () => executedRequestTypes
    } as unknown as MissionWorkflowRequestExecutor & {
        getExecutedRequestTypes(): string[];
    };
}

function createGeneratedTasksEvent(stageId: string, occurredAt: string): MissionWorkflowEvent {
    return {
        eventId: `tasks.generated:${stageId}:${occurredAt}`,
        type: 'tasks.generated',
        occurredAt,
        source: 'daemon',
        stageId,
        tasks: stageId === 'implementation'
            ? [{
                taskId: 'implementation/01-from-artifact',
                title: 'From Artifact',
                instruction: 'Promote artifact-defined implementation task into runtime generation.',
                dependsOn: []
            }]
            : [{
                taskId: 'prd/01',
                title: 'Draft PRD',
                instruction: 'Draft the PRD.',
                dependsOn: []
            }]
    };
}
