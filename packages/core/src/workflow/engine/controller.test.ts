import { describe, expect, it } from 'vitest';
import type { MissionDescriptor } from '../../types.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import type { MissionTaskState } from '../../types.js';
import {
    createMissionWorkflowConfigurationSnapshot,
    createMissionRuntimeRecord,
    ingestMissionWorkflowEvent,
    MissionWorkflowController,
    type MissionRuntimeRecord,
    type MissionWorkflowEvent,
    type MissionWorkflowEventRecord
} from './index.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from '../mission/workflow.js';
import type { MissionWorkflowRequestExecutor } from './requestExecutor.js';

describe('MissionWorkflowController', () => {
    it('executes machine-emitted generation requests while creating a mission runtime record', async () => {
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
                createMissionRuntimeRecord({
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

    it('normalizes stale generated task dependencies while loading persisted runtime state', async () => {
        const adapter = createAdapter();
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-14T09:00:00.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });
        const persisted = createMissionRuntimeRecord({
            missionId: 'mission-42',
            configuration,
            createdAt: configuration.createdAt
        });
        persisted.runtime.tasks = [
            {
                taskId: 'spec/01-draft-spec',
                stageId: 'spec',
                title: 'Draft Spec',
                instruction: 'Draft the spec.',
                dependsOn: [],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: true },
                retries: 0,
                createdAt: '2026-04-14T09:10:00.000Z',
                updatedAt: '2026-04-14T09:12:00.000Z',
                completedAt: '2026-04-14T09:12:00.000Z'
            },
            {
                taskId: 'spec/02-plan',
                stageId: 'spec',
                title: 'Plan',
                instruction: 'Plan the implementation.',
                dependsOn: [],
                lifecycle: 'pending',
                waitingOnTaskIds: [],
                runtime: { autostart: true },
                retries: 0,
                createdAt: '2026-04-14T09:12:05.000Z',
                updatedAt: '2026-04-14T09:12:05.000Z'
            }
        ];
        adapter.setPersistedDocument(persisted);

        const controller = new MissionWorkflowController({
            adapter,
            descriptor: createDescriptor(),
            workflow: createDefaultWorkflowSettings(),
            requestExecutor: createRequestExecutor()
        });

        const document = await controller.initialize();

        expect(document?.runtime.tasks.find((task) => task.taskId === 'spec/02-plan')?.dependsOn).toEqual([
            'spec/01-draft-spec'
        ]);
    });

    it('normalizes persisted artifact-backed generation settings from workflow defaults', async () => {
        const adapter = createAdapter({
            stageTasks: {
                implementation: [createImplementationTaskArtifact()]
            }
        });
        const workflow = createDefaultWorkflowSettings();
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-14T09:00:00.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow
        });
        configuration.workflow.taskGeneration = configuration.workflow.taskGeneration.map((rule) =>
            rule.stageId === 'implementation'
                ? {
                    ...rule,
                    artifactTasks: undefined as unknown as boolean,
                    templateSources: [],
                    tasks: []
                }
                : rule
        );
        const persisted = createMissionRuntimeRecord({
            missionId: 'mission-42',
            configuration,
            createdAt: configuration.createdAt
        });
        persisted.runtime.tasks = [
            {
                taskId: 'prd/01-prd-from-brief',
                stageId: 'prd',
                title: 'Draft PRD',
                instruction: 'Draft the PRD.',
                dependsOn: [],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: true },
                retries: 0,
                createdAt: configuration.createdAt,
                updatedAt: '2026-04-14T09:02:00.000Z',
                completedAt: '2026-04-14T09:02:00.000Z'
            },
            {
                taskId: 'spec/01-spec-from-prd',
                stageId: 'spec',
                title: 'Draft Spec',
                instruction: 'Draft the spec.',
                dependsOn: [],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: true },
                retries: 0,
                createdAt: '2026-04-14T09:03:00.000Z',
                updatedAt: '2026-04-14T09:05:00.000Z',
                completedAt: '2026-04-14T09:05:00.000Z'
            },
            {
                taskId: 'spec/02-plan',
                stageId: 'spec',
                title: 'Plan',
                instruction: 'Plan implementation.',
                dependsOn: ['spec/01-spec-from-prd'],
                lifecycle: 'running',
                waitingOnTaskIds: [],
                runtime: { autostart: true },
                retries: 0,
                createdAt: '2026-04-14T09:05:00.000Z',
                updatedAt: '2026-04-14T09:06:00.000Z'
            }
        ];
        adapter.setPersistedDocument(persisted);

        const executor = createRequestExecutor();
        const controller = new MissionWorkflowController({
            adapter,
            descriptor: createDescriptor(),
            workflow,
            requestExecutor: executor
        });

        const initialized = await controller.initialize();
        expect(initialized?.configuration.workflow.taskGeneration.find((rule) => rule.stageId === 'implementation')).toMatchObject({
            artifactTasks: true
        });

        const document = await controller.applyEvent({
            eventId: 'task.completed:spec/02-plan:2026-04-14T09:07:00.000Z',
            type: 'task.completed',
            occurredAt: '2026-04-14T09:07:00.000Z',
            source: 'human',
            taskId: 'spec/02-plan'
        });

        expect(document.runtime.tasks).toContainEqual(expect.objectContaining({
            taskId: 'implementation/01-from-artifact',
            stageId: 'implementation'
        }));
        expect(adapter.getPersistedEventLog().map((event) => event.type)).toContain('tasks.generated');
        expect(executor.getExecutedRequestTypes()).toContain('tasks.request-generation');
    });
});

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

function createAdapter(options: {
    stageTasks?: Partial<Record<string, MissionTaskState[]>>;
} = {}) {
    let persisted: MissionRuntimeRecord | undefined;
    const eventLog: MissionWorkflowEventRecord[] = [];

    return {
        readMissionRuntimeRecord: async () => persisted,
        readMissionRuntimeEventLog: async () => [...eventLog],
        writeMissionRuntimeRecord: async (_missionDir: string, document: MissionRuntimeRecord) => {
            persisted = document;
        },
        appendMissionRuntimeEventRecord: async (_missionDir: string, eventRecord: MissionWorkflowEventRecord) => {
            eventLog.push(eventRecord);
        },
        listTaskStates: async (_missionDir: string, stageId: string) => options.stageTasks?.[stageId] ?? [],
        getPersistedDocument: () => persisted,
        getPersistedEventLog: () => [...eventLog],
        setPersistedDocument: (document: MissionRuntimeRecord | undefined) => {
            persisted = document;
        },
        setPersistedEventLog: (records: MissionWorkflowEventRecord[]) => {
            eventLog.splice(0, eventLog.length, ...records);
        }
    } as unknown as FilesystemAdapter & {
        getPersistedDocument(): MissionRuntimeRecord | undefined;
        getPersistedEventLog(): MissionWorkflowEventRecord[];
        setPersistedDocument(document: MissionRuntimeRecord | undefined): void;
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
        normalizePersistedSessionIdentity: <T>(session: T) => session,
        reconcileSessions: async () => [],
        listRuntimeSessions: () => [],
        getRuntimeSession: () => undefined,
        attachSession: async () => {
            throw new Error('not implemented for test');
        },
        startSession: async () => {
            throw new Error('not implemented for test');
        },
        cancelRuntimeSession: async () => [],
        promptRuntimeSession: async () => [],
        commandRuntimeSession: async () => [],
        terminateRuntimeSession: async () => [],
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

function createImplementationTaskArtifact(): MissionTaskState {
    return {
        taskId: 'implementation/01-from-artifact',
        stage: 'implementation',
        sequence: 1,
        subject: 'From Artifact',
        instruction: 'Promote artifact-defined implementation task into runtime generation.',
        body: 'Promote artifact-defined implementation task into runtime generation.',
        dependsOn: [],
        waitingOn: [],
        status: 'pending',
        agent: 'copilot',
        retries: 0,
        fileName: '01-from-artifact.md',
        filePath: '/tmp/mission-42/.mission/missions/mission-42/03-IMPLEMENTATION/tasks/01-from-artifact.md',
        relativePath: '03-IMPLEMENTATION/tasks/01-from-artifact.md'
    };
}