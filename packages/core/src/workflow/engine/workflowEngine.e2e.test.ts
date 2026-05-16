import { describe, expect, it } from 'vitest';
import type { MissionDescriptor } from '../../entities/Mission/MissionSchema.js';
import type { MissionDossierFilesystem } from '../../entities/Mission/MissionDossierFilesystem.js';
import type { AgentCommand, AgentPrompt } from '../../entities/AgentExecution/AgentExecutionSchema.js';
import {
    createWorkflowConfigurationSnapshot,
    createWorkflowStateData,
    ingestWorkflowEvent,
    WorkflowController,
    type WorkflowGeneratedTaskPayload,
    type WorkflowStateData,
    type WorkflowEvent,
    type WorkflowRequest
} from './index.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from '../mission/workflow.js';
import type { WorkflowRequestExecutor } from './requestExecutor.js';

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
        const controller = new WorkflowController({
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

        const prdAgentExecutionId = executor.requireTerminalId('prd/01');
        await controller.promptRuntimeAgentExecution(prdAgentExecutionId, {
            source: 'operator',
            text: 'Keep the PRD tight.'
        } satisfies AgentPrompt);
        await controller.commandRuntimeAgentExecution(prdAgentExecutionId, {
            type: 'nudge',
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

        document = await completeTask(controller, 'prd/01', executor.requireTerminalId('prd/01'), '2026-04-14T10:02:00.000Z');
        expect(document.runtime.tasks.find((task) => task.taskId === 'spec/01')?.lifecycle).toBe('running');

        document = await completeTask(controller, 'spec/01', executor.requireTerminalId('spec/01'), '2026-04-14T10:03:00.000Z');
        expect(document.runtime.tasks.find((task) => task.taskId === 'implementation/01')?.lifecycle).toBe('ready');

        document = await controller.applyEvent({
            eventId: 'task.queued:implementation/01:2026-04-14T10:03:30.000Z',
            type: 'task.queued',
            occurredAt: '2026-04-14T10:03:30.000Z',
            source: 'human',
            taskId: 'implementation/01'
        });
        const implementationAgentExecutionId = executor.requireTerminalId('implementation/01');

        document = await controller.cancelProcessAgentExecution(
            implementationAgentExecutionId,
            'restart implementation AgentExecution',
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
        document = await completeTask(controller, 'implementation/01', executor.requireTerminalId('implementation/01'), '2026-04-14T10:05:00.000Z');

        expect(document.runtime.tasks.find((task) => task.taskId === 'audit/01')?.lifecycle).toBe('running');
        document = await controller.terminateProcessAgentExecution(
            executor.requireTerminalId('audit/01'),
            'stop audit and relaunch',
            'audit/01'
        );
        expect(document.runtime.tasks.find((task) => task.taskId === 'audit/01')?.lifecycle).toBe('ready');

        document = await controller.applyEvent({
            eventId: 'task.queued:audit/01:2026-04-14T10:05:30.000Z',
            type: 'task.queued',
            occurredAt: '2026-04-14T10:05:30.000Z',
            source: 'human',
            taskId: 'audit/01'
        });
        expect(document.runtime.tasks.find((task) => task.taskId === 'audit/01')?.lifecycle).toBe('running');

        document = await completeTask(controller, 'audit/01', executor.requireTerminalId('audit/01'), '2026-04-14T10:06:00.000Z');

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
            'execution.cancelled',
            'execution.terminated',
            'mission.delivered'
        ]));
    });

    it('covers launch failure and reopen-driven recovery', async () => {
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
        const controller = new WorkflowController({
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
        expect(adapter.getPersistedEventLog().at(-1)?.type).toBe('execution.launch-failed');

        document = await controller.applyEvent(createTaskReopenedEvent('prd/01', '2026-04-14T11:00:30.000Z'));
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('running');

        document = await controller.terminateProcessAgentExecution(
            executor.requireTerminalId('prd/01'),
            'reset AgentExecution',
            'prd/01'
        );
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('ready');

        document = await controller.applyEvent({
            eventId: 'task.queued:prd/01:2026-04-14T11:01:30.000Z',
            type: 'task.queued',
            occurredAt: '2026-04-14T11:01:30.000Z',
            source: 'human',
            taskId: 'prd/01'
        });
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('running');

        document = await completeTask(controller, 'prd/01', executor.requireTerminalId('prd/01'), '2026-04-14T11:02:00.000Z');

        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('completed');
        expect(adapter.getPersistedEventLog().map((event) => event.type)).toEqual(expect.arrayContaining([
            'execution.launch-failed',
            'task.reopened',
            'execution.started',
            'task.completed'
        ]));
    });

    it('replays generation requests during refresh recovery', async () => {
        const adapter = createAdapter();
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-14T12:00:00.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });
        adapter.setPersistedDocument(
            ingestWorkflowEvent(
                createWorkflowStateData({
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
        const controller = new WorkflowController({
            adapter,
            descriptor: createDescriptor('mission-e2e-refresh'),
            workflow: createDefaultWorkflowSettings(),
            requestExecutor: executor.api
        });

        const document = await controller.refresh();

        expect(document?.runtime.tasks.map((task) => task.taskId)).toEqual(['prd/01']);
        expect(executor.executedRequestTypes).toEqual(['tasks.request-generation']);
    });

    it('covers pause and stale launch-queue restart recovery', async () => {
        const workflow = createDefaultWorkflowSettings();
        workflow.execution.maxParallelTasks = 2;
        workflow.execution.maxParallelAgentExecutions = 1;
        const adapter = createAdapter();
        const executor = createScenarioExecutor({
            stageTasks: {
                prd: [
                    createGeneratedTask('prd/01', 'prd', 'Draft PRD 1'),
                    createGeneratedTask('prd/02', 'prd', 'Draft PRD 2')
                ]
            }
        });
        const descriptor = createDescriptor('mission-e2e-pause-recovery');
        const controller = new WorkflowController({
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
            eventId: 'mission.paused:2026-04-14T13:00:30.000Z',
            type: 'mission.paused',
            occurredAt: '2026-04-14T13:00:30.000Z',
            source: 'human',
            reason: 'human-requested',
            targetType: 'mission'
        });

        expect(document.runtime.lifecycle).toBe('paused');
        expect(document.runtime.pause.reason).toBe('human-requested');
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('running');
        expect(document.runtime.tasks.find((task) => task.taskId === 'prd/02')?.lifecycle).toBe('queued');

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

        const staleDocument: WorkflowStateData = {
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
                agentExecutions: [],
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

        const restartedController = new WorkflowController({
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
            'mission.paused',
            'mission.resumed',
            'mission.launch-queue.restarted',
            'execution.started'
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
    let persisted: WorkflowStateData | undefined;
    const eventLog: Array<{ type: string }> = [];

    return {
        readWorkflowStateDataFile: async () => persisted,
        readMissionEventLogFile: async () => [...eventLog],
        writeWorkflowStateDataFile: async (_missionDir: string, document: WorkflowStateData) => {
            persisted = document;
        },
        appendMissionEventRecordFile: async (_missionDir: string, eventRecord: { type: string }) => {
            eventLog.push(eventRecord);
        },
        getPersistedDocument: () => persisted,
        getPersistedEventLog: () => [...eventLog],
        setPersistedDocument: (document: WorkflowStateData | undefined) => {
            persisted = document;
        }
    } as unknown as MissionDossierFilesystem & {
        getPersistedDocument(): WorkflowStateData | undefined;
        getPersistedEventLog(): Array<{ type: string }>;
        setPersistedDocument(document: WorkflowStateData | undefined): void;
    };
}

function createGeneratedTask(taskId: string, stageId: string, title: string): WorkflowGeneratedTaskPayload {
    return {
        taskId,
        title,
        instruction: `${title} for ${stageId}.`,
        dependsOn: []
    };
}

async function completeTask(
    controller: WorkflowController,
    taskId: string,
    agentExecutionId: string,
    occurredAt: string
): Promise<WorkflowStateData> {
    const completedAgentExecutionDocument = await controller.applyEvent({
        eventId: `execution.completed:${agentExecutionId}:${occurredAt}`,
        type: 'execution.completed',
        occurredAt,
        source: 'daemon',
        agentExecutionId: agentExecutionId,
        taskId
    });
    const taskCompletedAt = advanceTimestamp(occurredAt, 1);
    void completedAgentExecutionDocument;
    return controller.applyEvent({
        eventId: `task.completed:${taskId}:${taskCompletedAt}`,
        type: 'task.completed',
        occurredAt: taskCompletedAt,
        source: 'human',
        taskId
    });
}

function createTaskReopenedEvent(taskId: string, occurredAt: string): WorkflowEvent {
    return {
        eventId: `task.reopened:${taskId}:${occurredAt}`,
        type: 'task.reopened',
        occurredAt,
        source: 'human',
        taskId
    };
}

function createMissionPausedEvent(occurredAt: string): WorkflowEvent {
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
    stageTasks: Record<string, WorkflowGeneratedTaskPayload[]>;
    launchPlans?: Record<string, Array<'started' | 'launch-failed'>>;
}) {
    const executedRequestTypes: string[] = [];
    const promptCalls: Array<{ agentExecutionId: string; prompt: AgentPrompt }> = [];
    const commandCalls: Array<{ agentExecutionId: string; command: AgentCommand }> = [];
    const taskAgentExecutionIds = new Map<string, string>();
    const agentExecutionTaskIds = new Map<string, string>();
    let agentExecutionCounter = 0;

    const api = {
        executeRequests: async (requestInput: { requests: WorkflowRequest[] }) => {
            const events: WorkflowEvent[] = [];
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
                    case 'execution.launch': {
                        const taskId = String(request.payload['taskId']);
                        const plan = input.launchPlans?.[taskId];
                        const outcome = plan?.shift() ?? 'started';
                        if (outcome === 'launch-failed') {
                            events.push({
                                eventId: `execution.launch-failed:${taskId}:${request.requestId}`,
                                type: 'execution.launch-failed',
                                occurredAt: advanceTimestamp('2026-04-14T09:00:00.000Z', executedRequestTypes.length),
                                source: 'daemon',
                                causedByRequestId: request.requestId,
                                taskId,
                                reason: 'scripted launch failure'
                            });
                            break;
                        }
                        agentExecutionCounter += 1;
                        const agentExecutionId = `AgentExecution-${String(agentExecutionCounter)}`;
                        taskAgentExecutionIds.set(taskId, agentExecutionId);
                        agentExecutionTaskIds.set(agentExecutionId, taskId);
                        events.push({
                            eventId: `execution.started:${taskId}:${request.requestId}`,
                            type: 'execution.started',
                            occurredAt: advanceTimestamp('2026-04-14T09:00:00.000Z', executedRequestTypes.length),
                            source: 'daemon',
                            causedByRequestId: request.requestId,
                            agentExecutionId: agentExecutionId,
                            taskId,
                            agentId: 'fake-adapter',
                            transportId: 'terminal',
                            terminalHandle: {
                                terminalName: agentExecutionId,
                                terminalPaneId: 'pty'
                            }
                        });
                        break;
                    }
                    case 'execution.terminate': {
                        const agentExecutionId = String(request.payload['agentExecutionId']);
                        const taskId = agentExecutionTaskIds.get(agentExecutionId) ?? String(request.payload['taskId'] ?? '');
                        taskAgentExecutionIds.delete(taskId);
                        agentExecutionTaskIds.delete(agentExecutionId);
                        events.push({
                            eventId: `execution.terminated:${agentExecutionId}:${request.requestId}`,
                            type: 'execution.terminated',
                            occurredAt: advanceTimestamp('2026-04-14T09:00:00.000Z', executedRequestTypes.length),
                            source: 'daemon',
                            causedByRequestId: request.requestId,
                            agentExecutionId,
                            taskId
                        });
                        break;
                    }
                }
            }
            return events;
        },
        reconcileExecutions: async () => [],
        listRuntimeAgentExecutions: () => [],
        getRuntimeAgentExecution: () => undefined,
        reconcileExecution: async () => {
            throw new Error('not implemented in workflowEngine.e2e.test.ts');
        },
        startExecution: async () => {
            throw new Error('not implemented in workflowEngine.e2e.test.ts');
        },
        cancelProcessAgentExecution: async (agentExecutionId: string, _reason?: string, fallbackTaskId?: string) => {
            const taskId = agentExecutionTaskIds.get(agentExecutionId) ?? fallbackTaskId ?? '';
            taskAgentExecutionIds.delete(taskId);
            agentExecutionTaskIds.delete(agentExecutionId);
            return [{
                eventId: `execution.cancelled:${agentExecutionId}`,
                type: 'execution.cancelled',
                occurredAt: '2026-04-14T09:30:00.000Z',
                source: 'daemon',
                agentExecutionId: agentExecutionId,
                taskId
            } satisfies WorkflowEvent];
        },
        promptRuntimeAgentExecution: async (agentExecutionId: string, prompt: AgentPrompt) => {
            promptCalls.push({ agentExecutionId, prompt });
            return [];
        },
        commandRuntimeAgentExecution: async (agentExecutionId: string, command: AgentCommand) => {
            commandCalls.push({ agentExecutionId, command });
            return [];
        },
        terminateProcessAgentExecution: async (agentExecutionId: string, _reason?: string, fallbackTaskId?: string) => {
            const taskId = agentExecutionTaskIds.get(agentExecutionId) ?? fallbackTaskId ?? '';
            taskAgentExecutionIds.delete(taskId);
            agentExecutionTaskIds.delete(agentExecutionId);
            return [{
                eventId: `execution.terminated:${agentExecutionId}`,
                type: 'execution.terminated',
                occurredAt: '2026-04-14T09:31:00.000Z',
                source: 'daemon',
                agentExecutionId,
                taskId
            } satisfies WorkflowEvent];
        }
    } as unknown as WorkflowRequestExecutor;

    return {
        api,
        executedRequestTypes,
        promptCalls,
        commandCalls,
        requireTerminalId(taskId: string): string {
            const agentExecutionId = taskAgentExecutionIds.get(taskId);
            if (!agentExecutionId) {
                throw new Error(`Missing AgentExecution id for task '${taskId}'.`);
            }
            return agentExecutionId;
        }
    };
}
