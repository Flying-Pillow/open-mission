import { describe, expect, it } from 'vitest';
import type { MissionDescriptor } from '../../types.js';
import type { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import type { AgentCommand, AgentPrompt } from '../../agent/AgentRuntimeTypes.js';
import {
    createMissionWorkflowConfigurationSnapshot,
    createMissionRuntimeRecord,
    ingestMissionWorkflowEvent,
    MissionWorkflowController,
    type MissionGeneratedTaskPayload,
    type MissionRuntimeRecord,
    type MissionWorkflowEvent,
    type MissionWorkflowRequest
} from './index.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from '../mission/workflow.js';
import type { MissionWorkflowRequestExecutor } from './requestExecutor.js';

describe('workflow engine e2e', () => {
    it('runs a mission end to end through control, recovery, completion, and delivery', async () => {
        const adapter = createAdapter();
        const workflow = createDefaultWorkflowSettings();
        workflow.taskGeneration = workflow.taskGeneration.map((rule) =>
            rule.stageId === 'implementation'
                ? {
                    ...rule,
                    tasks: [createGeneratedTask('implementation/01', 'implementation', 'Implement Change')]
                }
                : rule
        );
        const executor = createScenarioExecutor({
            stageTasks: {
                prd: [createGeneratedTask('prd/01', 'prd', 'Draft PRD')],
                spec: [createGeneratedTask('spec/01', 'spec', 'Draft Spec')],
                implementation: [createGeneratedTask('implementation/01', 'implementation', 'Implement Change')],
                audit: [createGeneratedTask('audit/01', 'audit', 'Run Audit')]
            }
        });
        const controller = new MissionWorkflowController({
            adapter,
            descriptor: createDescriptor('mission-e2e-happy'),
            workflow,
            requestExecutor: executor.api
        });

        let document = await controller.startFromDraft({
            occurredAt: '2026-04-14T10:00:00.000Z',
            source: 'human',
            startMission: true
        });

        expect(document.runtime.lifecycle).toBe('running');
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('running');

        const prdSessionId = executor.requireSessionId('prd/01');
        await controller.promptRuntimeSession(prdSessionId, {
            source: 'operator',
            text: 'Keep the PRD tight.'
        } satisfies AgentPrompt);
        await controller.commandRuntimeSession(prdSessionId, {
            type: 'nudge',
            reason: 'Continue'
        } satisfies AgentCommand);

        document = await controller.applyEvent(createMissionPausedEvent('2026-04-14T10:01:00.000Z'));
        expect(document.runtime.lifecycle).toBe('paused');

        document = await controller.applyEvent({
            eventId: 'mission.resumed:2026-04-14T10:01:30.000Z',
            type: 'mission.resumed',
            occurredAt: '2026-04-14T10:01:30.000Z',
            source: 'human'
        });
        expect(document.runtime.lifecycle).toBe('running');

        document = await completeTask(controller, 'prd/01', executor.requireSessionId('prd/01'), '2026-04-14T10:02:00.000Z');
        expect(document.runtime.tasks.find((task) => task.taskId === 'spec/01')?.lifecycle).toBe('running');

        document = await completeTask(controller, 'spec/01', executor.requireSessionId('spec/01'), '2026-04-14T10:03:00.000Z');
        expect(document.runtime.tasks.find((task) => task.taskId === 'implementation/01')?.lifecycle).toBe('ready');

        document = await controller.applyEvent({
            eventId: 'task.queued:implementation/01:2026-04-14T10:03:30.000Z',
            type: 'task.queued',
            occurredAt: '2026-04-14T10:03:30.000Z',
            source: 'human',
            taskId: 'implementation/01'
        });
        const implementationSessionId = executor.requireSessionId('implementation/01');

        document = await controller.cancelRuntimeSession(
            implementationSessionId,
            'restart implementation session',
            'implementation/01'
        );
        expect(document.runtime.tasks.find((task) => task.taskId === 'implementation/01')?.lifecycle).toBe('ready');

        document = await controller.applyEvent({
            eventId: 'task.queued:implementation/01:2026-04-14T10:04:10.000Z',
            type: 'task.queued',
            occurredAt: '2026-04-14T10:04:10.000Z',
            source: 'human',
            taskId: 'implementation/01'
        });
        document = await completeTask(controller, 'implementation/01', executor.requireSessionId('implementation/01'), '2026-04-14T10:05:00.000Z');

        expect(document.runtime.tasks.find((task) => task.taskId === 'audit/01')?.lifecycle).toBe('running');
        document = await controller.terminateRuntimeSession(
            executor.requireSessionId('audit/01'),
            'stop audit and relaunch',
            'audit/01'
        );
        expect(document.runtime.tasks.find((task) => task.taskId === 'audit/01')?.lifecycle).toBe('running');

        document = await completeTask(controller, 'audit/01', executor.requireSessionId('audit/01'), '2026-04-14T10:06:00.000Z');

        expect(document.runtime.lifecycle).toBe('completed');
        expect(document.runtime.stages.find((stage) => stage.stageId === 'delivery')?.lifecycle).toBe('completed');

        document = await controller.applyEvent({
            eventId: 'mission.delivered:2026-04-14T10:06:30.000Z',
            type: 'mission.delivered',
            occurredAt: '2026-04-14T10:06:30.000Z',
            source: 'human'
        });

        expect(document.runtime.lifecycle).toBe('delivered');
        expect(executor.promptCalls).toHaveLength(1);
        expect(executor.commandCalls).toHaveLength(1);
        expect(adapter.getPersistedEventLog().map((event) => event.type)).toEqual(expect.arrayContaining([
            'mission.created',
            'tasks.generated',
            'mission.started',
            'mission.paused',
            'mission.resumed',
            'session.cancelled',
            'session.terminated',
            'mission.delivered'
        ]));
    });

    it('covers launch failure, blocked work, and reopen-driven recovery', async () => {
        const adapter = createAdapter();
        const workflow = createDefaultWorkflowSettings();
        workflow.taskGeneration = workflow.taskGeneration.map((rule) =>
            rule.stageId === 'prd'
                ? rule
                : {
                    ...rule,
                    templateSources: [],
                    tasks: []
                }
        );
        const executor = createScenarioExecutor({
            stageTasks: {
                prd: [createGeneratedTask('prd/01', 'prd', 'Draft PRD')]
            },
            launchPlans: {
                'prd/01': ['launch-failed', 'started', 'started']
            }
        });
        const controller = new MissionWorkflowController({
            adapter,
            descriptor: createDescriptor('mission-e2e-failure'),
            workflow,
            requestExecutor: executor.api
        });

        let document = await controller.startFromDraft({
            occurredAt: '2026-04-14T11:00:00.000Z',
            source: 'human',
            startMission: true
        });

        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('failed');
        expect(adapter.getPersistedEventLog().at(-1)?.type).toBe('session.launch-failed');

        document = await controller.applyEvent(createTaskReopenedEvent('prd/01', '2026-04-14T11:00:30.000Z'));
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('running');

        document = await controller.applyEvent({
            eventId: 'task.blocked:prd/01:2026-04-14T11:01:00.000Z',
            type: 'task.blocked',
            occurredAt: '2026-04-14T11:01:00.000Z',
            source: 'human',
            taskId: 'prd/01',
            reason: 'waiting on clarification'
        });
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('blocked');

        document = await controller.terminateRuntimeSession(
            executor.requireSessionId('prd/01'),
            'clear blocked session',
            'prd/01'
        );
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('running');

        document = await completeTask(controller, 'prd/01', executor.requireSessionId('prd/01'), '2026-04-14T11:02:00.000Z');

        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('completed');
        expect(adapter.getPersistedEventLog().map((event) => event.type)).toEqual(expect.arrayContaining([
            'session.launch-failed',
            'task.reopened',
            'task.blocked',
            'session.started',
            'task.completed'
        ]));
    });

    it('replays generation requests during refresh recovery', async () => {
        const adapter = createAdapter();
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-14T12:00:00.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });
        adapter.setPersistedDocument(
            ingestMissionWorkflowEvent(
                createMissionRuntimeRecord({
                    missionId: 'mission-e2e-refresh',
                    configuration,
                    createdAt: configuration.createdAt
                }),
                {
                    eventId: 'mission-e2e-refresh:mission-created',
                    type: 'mission.created',
                    occurredAt: '2026-04-14T12:00:00.000Z',
                    source: 'human'
                }
            ).document
        );

        const executor = createScenarioExecutor({
            stageTasks: {
                prd: [createGeneratedTask('prd/01', 'prd', 'Draft PRD')]
            }
        });
        const controller = new MissionWorkflowController({
            adapter,
            descriptor: createDescriptor('mission-e2e-refresh'),
            workflow: createDefaultWorkflowSettings(),
            requestExecutor: executor.api
        });

        const document = await controller.refresh();

        expect(document?.runtime.tasks.map((task) => task.taskId)).toEqual(['prd/01']);
        expect(executor.executedRequestTypes).toEqual(['tasks.request-generation']);
    });

    it('covers panic termination and stale launch-queue restart recovery', async () => {
        const workflow = createDefaultWorkflowSettings();
        workflow.execution.maxParallelTasks = 2;
        workflow.execution.maxParallelSessions = 1;
        const adapter = createAdapter();
        const executor = createScenarioExecutor({
            stageTasks: {
                prd: [
                    createGeneratedTask('prd/01', 'prd', 'Draft PRD 1'),
                    createGeneratedTask('prd/02', 'prd', 'Draft PRD 2')
                ]
            }
        });
        const descriptor = createDescriptor('mission-e2e-panic');
        const controller = new MissionWorkflowController({
            adapter,
            descriptor,
            workflow,
            requestExecutor: executor.api
        });

        let document = await controller.startFromDraft({
            occurredAt: '2026-04-14T13:00:00.000Z',
            source: 'human',
            startMission: true
        });

        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('running');
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/02')?.lifecycle).toBe('queued');
        expect(document.runtime.launchQueue).toHaveLength(1);

        document = await controller.applyEvent({
            eventId: 'mission.panic.requested:2026-04-14T13:00:30.000Z',
            type: 'mission.panic.requested',
            occurredAt: '2026-04-14T13:00:30.000Z',
            source: 'human'
        });

        expect(document.runtime.lifecycle).toBe('panicked');
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('ready');
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/02')?.lifecycle).toBe('ready');
        expect(document.runtime.launchQueue).toEqual([]);

        document = await controller.applyEvent({
            eventId: 'mission.panic.cleared:2026-04-14T13:01:00.000Z',
            type: 'mission.panic.cleared',
            occurredAt: '2026-04-14T13:01:00.000Z',
            source: 'human'
        });
        document = await controller.applyEvent({
            eventId: 'task.launch-policy.changed:prd/02:2026-04-14T13:01:10.000Z',
            type: 'task.launch-policy.changed',
            occurredAt: '2026-04-14T13:01:10.000Z',
            source: 'human',
            taskId: 'prd/02',
            autostart: false
        });
        document = await controller.applyEvent({
            eventId: 'mission.resumed:2026-04-14T13:01:20.000Z',
            type: 'mission.resumed',
            occurredAt: '2026-04-14T13:01:20.000Z',
            source: 'human'
        });
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/02')?.lifecycle).toBe('ready');

        const staleDocument: MissionRuntimeRecord = {
            ...document,
            runtime: {
                ...document.runtime,
                lifecycle: 'running',
                pause: { paused: false },
                tasks: document.runtime.tasks.map((task) =>
                    task.taskId === 'prd/02'
                        ? {
                            ...task,
                            lifecycle: 'queued',
                            updatedAt: '2026-04-14T13:01:30.000Z'
                        }
                        : task
                ),
                sessions: [],
                launchQueue: [{
                    requestId: 'task.launch:prd/02:stale',
                    taskId: 'prd/02',
                    requestedAt: '2026-04-14T13:01:30.000Z',
                    requestedBy: 'system',
                    dispatchedAt: '2026-04-14T13:01:31.000Z'
                }],
                updatedAt: '2026-04-14T13:01:31.000Z'
            }
        };
        adapter.setPersistedDocument(staleDocument);

        const restartedController = new MissionWorkflowController({
            adapter,
            descriptor,
            workflow,
            requestExecutor: executor.api
        });
        await restartedController.refresh();

        document = await restartedController.applyEvent({
            eventId: 'mission.launch-queue.restarted:2026-04-14T13:02:00.000Z',
            type: 'mission.launch-queue.restarted',
            occurredAt: '2026-04-14T13:02:00.000Z',
            source: 'human'
        });

        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/02')?.lifecycle).toBe('running');
        expect(adapter.getPersistedEventLog().map((event) => event.type)).toEqual(expect.arrayContaining([
            'mission.panic.requested',
            'session.terminated',
            'mission.panic.cleared',
            'mission.resumed',
            'mission.launch-queue.restarted',
            'session.started'
        ]));
    });
});

function createDescriptor(missionId: string): MissionDescriptor {
    return {
        missionId,
        missionDir: `/tmp/${missionId}`,
        branchRef: `mission/${missionId}`,
        createdAt: '2026-04-14T09:00:00.000Z',
        brief: {
            title: 'Workflow engine e2e',
            body: 'Exercise workflow engine paths.',
            type: 'refactor'
        }
    } as MissionDescriptor;
}

function createAdapter() {
    let persisted: MissionRuntimeRecord | undefined;
    const eventLog: Array<{ type: string }> = [];

    return {
        readMissionRuntimeRecord: async () => persisted,
        readMissionRuntimeEventLog: async () => [...eventLog],
        writeMissionRuntimeRecord: async (_missionDir: string, document: MissionRuntimeRecord) => {
            persisted = document;
        },
        appendMissionRuntimeEventRecord: async (_missionDir: string, eventRecord: { type: string }) => {
            eventLog.push(eventRecord);
        },
        getPersistedDocument: () => persisted,
        getPersistedEventLog: () => [...eventLog],
        setPersistedDocument: (document: MissionRuntimeRecord | undefined) => {
            persisted = document;
        }
    } as unknown as FilesystemAdapter & {
        getPersistedDocument(): MissionRuntimeRecord | undefined;
        getPersistedEventLog(): Array<{ type: string }>;
        setPersistedDocument(document: MissionRuntimeRecord | undefined): void;
    };
}

function createGeneratedTask(taskId: string, stageId: string, title: string): MissionGeneratedTaskPayload {
    return {
        taskId,
        title,
        instruction: `${title} for ${stageId}.`,
        dependsOn: []
    };
}

async function completeTask(
    controller: MissionWorkflowController,
    taskId: string,
    sessionId: string,
    occurredAt: string
): Promise<MissionRuntimeRecord> {
    const completedSessionDocument = await controller.applyEvent({
        eventId: `session.completed:${sessionId}:${occurredAt}`,
        type: 'session.completed',
        occurredAt,
        source: 'daemon',
        sessionId,
        taskId
    });
    const taskCompletedAt = advanceTimestamp(occurredAt, 1);
    void completedSessionDocument;
    return controller.applyEvent({
        eventId: `task.completed:${taskId}:${taskCompletedAt}`,
        type: 'task.completed',
        occurredAt: taskCompletedAt,
        source: 'human',
        taskId
    });
}

function createTaskReopenedEvent(taskId: string, occurredAt: string): MissionWorkflowEvent {
    return {
        eventId: `task.reopened:${taskId}:${occurredAt}`,
        type: 'task.reopened',
        occurredAt,
        source: 'human',
        taskId
    };
}

function createMissionPausedEvent(occurredAt: string): MissionWorkflowEvent {
    return {
        eventId: `mission.paused:${occurredAt}`,
        type: 'mission.paused',
        occurredAt,
        source: 'human',
        reason: 'human-requested',
        targetType: 'mission'
    };
}

function advanceTimestamp(iso: string, seconds: number): string {
    return new Date(Date.parse(iso) + (seconds * 1000)).toISOString();
}

function createScenarioExecutor(input: {
    stageTasks: Record<string, MissionGeneratedTaskPayload[]>;
    launchPlans?: Record<string, Array<'started' | 'launch-failed'>>;
}) {
    const executedRequestTypes: string[] = [];
    const promptCalls: Array<{ sessionId: string; prompt: AgentPrompt }> = [];
    const commandCalls: Array<{ sessionId: string; command: AgentCommand }> = [];
    const taskSessionIds = new Map<string, string>();
    const sessionTaskIds = new Map<string, string>();
    let sessionCounter = 0;

    const api = {
        executeRequests: async (requestInput: { requests: MissionWorkflowRequest[] }) => {
            const events: MissionWorkflowEvent[] = [];
            for (const request of requestInput.requests) {
                executedRequestTypes.push(request.type);
                switch (request.type) {
                    case 'tasks.request-generation': {
                        const stageId = String(request.payload['stageId']);
                        events.push({
                            eventId: `tasks.generated:${stageId}:${request.requestId}`,
                            type: 'tasks.generated',
                            occurredAt: advanceTimestamp('2026-04-14T09:00:00.000Z', executedRequestTypes.length),
                            source: 'daemon',
                            causedByRequestId: request.requestId,
                            stageId,
                            tasks: input.stageTasks[stageId] ?? []
                        });
                        break;
                    }
                    case 'session.launch': {
                        const taskId = String(request.payload['taskId']);
                        const plan = input.launchPlans?.[taskId];
                        const outcome = plan?.shift() ?? 'started';
                        if (outcome === 'launch-failed') {
                            events.push({
                                eventId: `session.launch-failed:${taskId}:${request.requestId}`,
                                type: 'session.launch-failed',
                                occurredAt: advanceTimestamp('2026-04-14T09:00:00.000Z', executedRequestTypes.length),
                                source: 'daemon',
                                causedByRequestId: request.requestId,
                                taskId,
                                reason: 'scripted launch failure'
                            });
                            break;
                        }
                        sessionCounter += 1;
                        const sessionId = `session-${String(sessionCounter)}`;
                        taskSessionIds.set(taskId, sessionId);
                        sessionTaskIds.set(sessionId, taskId);
                        events.push({
                            eventId: `session.started:${taskId}:${request.requestId}`,
                            type: 'session.started',
                            occurredAt: advanceTimestamp('2026-04-14T09:00:00.000Z', executedRequestTypes.length),
                            source: 'daemon',
                            causedByRequestId: request.requestId,
                            sessionId,
                            taskId,
                            runnerId: 'fake-runner',
                            transportId: 'terminal',
                            terminalSessionName: sessionId
                        });
                        break;
                    }
                    case 'session.terminate': {
                        const sessionId = String(request.payload['sessionId']);
                        const taskId = sessionTaskIds.get(sessionId) ?? String(request.payload['taskId'] ?? '');
                        taskSessionIds.delete(taskId);
                        sessionTaskIds.delete(sessionId);
                        events.push({
                            eventId: `session.terminated:${sessionId}:${request.requestId}`,
                            type: 'session.terminated',
                            occurredAt: advanceTimestamp('2026-04-14T09:00:00.000Z', executedRequestTypes.length),
                            source: 'daemon',
                            causedByRequestId: request.requestId,
                            sessionId,
                            taskId
                        });
                        break;
                    }
                }
            }
            return events;
        },
        normalizePersistedSessionIdentity: <T>(session: T) => session,
        reconcileSessions: async () => [],
        listRuntimeSessions: () => [],
        getRuntimeSession: () => undefined,
        attachSession: async () => {
            throw new Error('not implemented in workflowEngine.e2e.test.ts');
        },
        startSession: async () => {
            throw new Error('not implemented in workflowEngine.e2e.test.ts');
        },
        cancelRuntimeSession: async (sessionId: string, _reason?: string, fallbackTaskId?: string) => {
            const taskId = sessionTaskIds.get(sessionId) ?? fallbackTaskId ?? '';
            taskSessionIds.delete(taskId);
            sessionTaskIds.delete(sessionId);
            return [{
                eventId: `session.cancelled:${sessionId}`,
                type: 'session.cancelled',
                occurredAt: '2026-04-14T09:30:00.000Z',
                source: 'daemon',
                sessionId,
                taskId
            } satisfies MissionWorkflowEvent];
        },
        promptRuntimeSession: async (sessionId: string, prompt: AgentPrompt) => {
            promptCalls.push({ sessionId, prompt });
            return [];
        },
        commandRuntimeSession: async (sessionId: string, command: AgentCommand) => {
            commandCalls.push({ sessionId, command });
            return [];
        },
        terminateRuntimeSession: async (sessionId: string, _reason?: string, fallbackTaskId?: string) => {
            const taskId = sessionTaskIds.get(sessionId) ?? fallbackTaskId ?? '';
            taskSessionIds.delete(taskId);
            sessionTaskIds.delete(sessionId);
            return [{
                eventId: `session.terminated:${sessionId}`,
                type: 'session.terminated',
                occurredAt: '2026-04-14T09:31:00.000Z',
                source: 'daemon',
                sessionId,
                taskId
            } satisfies MissionWorkflowEvent];
        }
    } as unknown as MissionWorkflowRequestExecutor;

    return {
        api,
        executedRequestTypes,
        promptCalls,
        commandCalls,
        requireSessionId(taskId: string): string {
            const sessionId = taskSessionIds.get(taskId);
            if (!sessionId) {
                throw new Error(`Missing session id for task '${taskId}'.`);
            }
            return sessionId;
        }
    };
}