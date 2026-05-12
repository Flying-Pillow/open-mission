import { describe, expect, it } from 'vitest';
import {
    createInitialWorkflowRuntimeState,
    createWorkflowConfigurationSnapshot
} from './document.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from '../mission/workflow.js';
import { reduceWorkflowEvent } from './reducer.js';
import { validateWorkflowEvent } from './validation.js';
import { AgentExecutionRuntimeStateSchema, type WorkflowEvent } from './types.js';

function createWorkflowSettingsWithoutTaskAutostart() {
    const workflow = createDefaultWorkflowSettings();
    workflow.stages = Object.fromEntries(
        Object.entries(workflow.stages).map(([stageId, stage]) => [
            stageId,
            {
                ...stage,
                taskLaunchPolicy: {
                    ...stage.taskLaunchPolicy,
                    defaultAutostart: false
                }
            }
        ])
    ) as typeof workflow.stages;
    return workflow;
}

describe('workflow reducer delivery completion', () => {
    it('persists terminal attachment metadata on started agentExecutions', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.tasks = [{
            taskId: 'implementation/01',
            stageId: 'implementation',
            title: 'Implement',
            instruction: 'Ship it.',
            dependsOn: [],
            lifecycle: 'queued',
            waitingOnTaskIds: [],
            runtime: { autostart: false },
            retries: 0,
            createdAt: '2026-04-10T15:51:25.000Z',
            updatedAt: '2026-04-10T15:51:25.000Z'
        }];

        const event: WorkflowEvent = {
            eventId: 'execution.started:implementation/01',
            type: 'execution.started',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'daemon',
            agentExecutionId: 'AgentExecution-1',
            taskId: 'implementation/01',
            agentId: 'copilot-cli',
            transportId: 'terminal',
            agentJournalPath: 'agent-journals/AgentExecution-1.interaction.jsonl',
            terminalHandle: {
                terminalName: 'airport-terminal-AgentExecution',
                terminalPaneId: 'terminal_44'
            }
        };

        validateWorkflowEvent(runtime, event, configuration);
        runtime = reduceWorkflowEvent(runtime, event, configuration).nextState;

        expect(runtime.agentExecutions).toContainEqual(expect.objectContaining({
            agentExecutionId: 'AgentExecution-1',
            agentJournalPath: 'agent-journals/AgentExecution-1.interaction.jsonl',
            terminalHandle: {
                terminalName: 'airport-terminal-AgentExecution',
                terminalPaneId: 'terminal_44'
            }
        }));
        expect(() => AgentExecutionRuntimeStateSchema.parse({
            ...runtime.agentExecutions[0],
            terminalName: 'airport-terminal-AgentExecution'
        })).toThrow();
        expect(() => AgentExecutionRuntimeStateSchema.parse({
            ...runtime.agentExecutions[0],
            agentJournalPath: 'terminal-recordings/AgentExecution-1.terminal.jsonl'
        })).toThrow('AgentExecution journals must use agent-journals/<agentExecutionId>.interaction.jsonl');
    });

    it('queues and emits AgentExecution launch requests for ready autostart tasks', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime = reduceWorkflowEvent(runtime, {
            eventId: 'mission.created',
            type: 'mission.created',
            occurredAt: '2026-04-10T15:51:25.000Z',
            source: 'human'
        }, configuration).nextState;
        runtime = reduceWorkflowEvent(runtime, {
            eventId: 'mission.started',
            type: 'mission.started',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human'
        }, configuration).nextState;

        const result = reduceWorkflowEvent(runtime, createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
            { taskId: 'prd/01', title: 'PRD', instruction: 'Draft PRD.' }
        ]), configuration);

        expect(result.nextState.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('queued');
        expect(result.requests).toContainEqual(expect.objectContaining({
            type: 'execution.launch',
            payload: { taskId: 'prd/01' }
        }));
    });

    it('does not autostart dependent tasks until prerequisites are completed', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime = reduceWorkflowEvent(runtime, {
            eventId: 'mission.created',
            type: 'mission.created',
            occurredAt: '2026-04-10T15:51:25.000Z',
            source: 'human'
        }, configuration).nextState;
        runtime = reduceWorkflowEvent(runtime, {
            eventId: 'mission.started',
            type: 'mission.started',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human'
        }, configuration).nextState;

        const generated = reduceWorkflowEvent(runtime, createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
            { taskId: 'prd/01', title: 'PRD', instruction: 'Draft PRD.' },
            { taskId: 'prd/02', title: 'PRD Follow-up', instruction: 'Refine PRD.', dependsOn: ['prd/01'] }
        ]), configuration);

        expect(generated.nextState.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('queued');
        expect(generated.nextState.tasks.find((task) => task.taskId === 'prd/02')).toEqual(expect.objectContaining({
            lifecycle: 'pending',
            waitingOnTaskIds: ['prd/01']
        }));
        expect(generated.requests).toContainEqual(expect.objectContaining({
            type: 'execution.launch',
            payload: { taskId: 'prd/01' }
        }));
        expect(generated.requests).not.toContainEqual(expect.objectContaining({
            type: 'execution.launch',
            payload: { taskId: 'prd/02' }
        }));

        const started = reduceWorkflowEvent(generated.nextState, {
            eventId: 'execution.started:prd/01:2026-04-10T15:53:30.000Z',
            type: 'execution.started',
            occurredAt: '2026-04-10T15:53:30.000Z',
            source: 'daemon',
            agentExecutionId: 'AgentExecution-prd-01',
            taskId: 'prd/01',
            agentId: 'copilot-cli'
        }, configuration);

        const completed = reduceWorkflowEvent(started.nextState, createTaskCompletedEvent('prd/01', '2026-04-10T15:54:00.000Z'), configuration);

        expect(completed.nextState.tasks.find((task) => task.taskId === 'prd/02')?.lifecycle).toBe('queued');
        expect(completed.requests).not.toContainEqual(expect.objectContaining({
            type: 'execution.launch',
            payload: { taskId: 'prd/02' }
        }));

        const agentExecutionCompleted = reduceWorkflowEvent(completed.nextState, {
            eventId: 'execution.completed:prd/01:2026-04-10T15:54:05.000Z',
            type: 'execution.completed',
            occurredAt: '2026-04-10T15:54:05.000Z',
            source: 'daemon',
            agentExecutionId: 'AgentExecution-prd-01',
            taskId: 'prd/01'
        }, configuration);

        expect(agentExecutionCompleted.requests).toContainEqual(expect.objectContaining({
            type: 'execution.launch',
            payload: { taskId: 'prd/02' }
        }));
    });

    it('enforces execution limits for autostart queueing and AgentExecution dispatch', () => {
        const workflow = createDefaultWorkflowSettings();
        workflow.execution.maxParallelTasks = 2;
        workflow.execution.maxParallelAgentExecutions = 1;
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime = reduceWorkflowEvent(runtime, {
            eventId: 'mission.created',
            type: 'mission.created',
            occurredAt: '2026-04-10T15:51:25.000Z',
            source: 'human'
        }, configuration).nextState;
        runtime = reduceWorkflowEvent(runtime, {
            eventId: 'mission.started',
            type: 'mission.started',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human'
        }, configuration).nextState;

        const generated = reduceWorkflowEvent(runtime, createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
            { taskId: 'prd/01', title: 'PRD 1', instruction: 'Draft PRD 1.' },
            { taskId: 'prd/02', title: 'PRD 2', instruction: 'Draft PRD 2.' },
            { taskId: 'prd/03', title: 'PRD 3', instruction: 'Draft PRD 3.' }
        ]), configuration);

        expect(generated.nextState.tasks.filter((task) => task.lifecycle === 'queued').map((task) => task.taskId)).toEqual([
            'prd/01',
            'prd/02'
        ]);
        expect(generated.nextState.tasks.find((task) => task.taskId === 'prd/03')?.lifecycle).toBe('ready');
        expect(generated.requests.filter((request) => request.type === 'execution.launch')).toHaveLength(1);
        expect(generated.nextState.launchQueue.find((request) => request.taskId === 'prd/01')?.dispatchedAt).toBe('2026-04-10T15:53:00.000Z');
        expect(generated.nextState.launchQueue.find((request) => request.taskId === 'prd/02')?.dispatchedAt).toBeUndefined();
    });

    it('rejects queueing a task beyond execution.maxParallelTasks', () => {
        const workflow = createDefaultWorkflowSettings();
        workflow.execution.maxParallelTasks = 1;
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow
        });

        const runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [
            {
                taskId: 'prd/01',
                stageId: 'prd',
                title: 'PRD 1',
                instruction: 'Draft PRD 1.',
                dependsOn: [],
                lifecycle: 'queued',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:51:25.000Z',
                updatedAt: '2026-04-10T15:51:25.000Z'
            },
            {
                taskId: 'prd/02',
                stageId: 'prd',
                title: 'PRD 2',
                instruction: 'Draft PRD 2.',
                dependsOn: [],
                lifecycle: 'ready',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:51:25.000Z',
                updatedAt: '2026-04-10T15:51:25.000Z'
            }
        ];

        expect(() => validateWorkflowEvent(runtime, {
            eventId: 'task.queued:prd/02',
            type: 'task.queued',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human',
            taskId: 'prd/02'
        }, configuration)).toThrow(/execution.maxParallelTasks/);
    });

    it('restarts a stale launch queue and re-emits launch requests for queued tasks', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [{
            taskId: 'prd/01',
            stageId: 'prd',
            title: 'PRD',
            instruction: 'Draft PRD.',
            dependsOn: [],
            lifecycle: 'queued',
            waitingOnTaskIds: [],
            runtime: { autostart: true },
            retries: 0,
            createdAt: '2026-04-10T15:51:25.000Z',
            updatedAt: '2026-04-10T15:51:25.000Z'
        }];
        runtime.launchQueue = [{
            requestId: 'task.launch:prd/01:stale',
            taskId: 'prd/01',
            requestedAt: '2026-04-10T15:51:25.000Z',
            requestedBy: 'human',
            dispatchedAt: '2026-04-10T15:51:40.000Z'
        }];

        const restartEvent: WorkflowEvent = {
            eventId: 'mission.launch-queue.restarted',
            type: 'mission.launch-queue.restarted',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human'
        };

        validateWorkflowEvent(runtime, restartEvent, configuration);
        const result = reduceWorkflowEvent(runtime, restartEvent, configuration);

        expect(result.nextState.launchQueue).toHaveLength(1);
        expect(result.nextState.launchQueue[0]?.taskId).toBe('prd/01');
        expect(result.nextState.launchQueue[0]?.dispatchedAt).toBe('2026-04-10T15:52:00.000Z');
        expect(result.requests).toContainEqual(expect.objectContaining({
            type: 'execution.launch',
            payload: { taskId: 'prd/01' }
        }));
    });

    it('accepts launch-failed after restart when prior task agentExecutions are only historical', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [{
            taskId: 'audit/01',
            stageId: 'audit',
            title: 'Audit task',
            instruction: 'Run audit.',
            dependsOn: [],
            lifecycle: 'queued',
            waitingOnTaskIds: [],
            runtime: { autostart: true },
            retries: 0,
            createdAt: '2026-04-10T15:51:25.000Z',
            updatedAt: '2026-04-10T15:51:25.000Z'
        }];
        runtime.agentExecutions = [{
            agentExecutionId: 'AgentExecution-1',
            taskId: 'audit/01',
            agentId: 'copilot-cli',
            lifecycle: 'terminated',
            launchedAt: '2026-04-10T15:51:30.000Z',
            updatedAt: '2026-04-10T15:51:40.000Z'
        }];
        runtime.launchQueue = [{
            requestId: 'task.launch:audit/01:stale',
            taskId: 'audit/01',
            requestedAt: '2026-04-10T15:51:25.000Z',
            requestedBy: 'human',
            dispatchedAt: '2026-04-10T15:51:40.000Z'
        }];

        const event: WorkflowEvent = {
            eventId: 'execution.launch-failed:audit/01',
            type: 'execution.launch-failed',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'daemon',
            taskId: 'audit/01',
            reason: 'launch failed after restart'
        };

        validateWorkflowEvent(runtime, event, configuration);
        const result = reduceWorkflowEvent(runtime, event, configuration);

        expect(result.nextState.tasks.find((task) => task.taskId === 'audit/01')?.lifecycle).toBe('failed');
        expect(result.nextState.launchQueue).toEqual([]);
        expect(result.nextState.agentExecutions).toContainEqual(expect.objectContaining({
            agentExecutionId: 'AgentExecution-1',
            lifecycle: 'terminated'
        }));
    });

    it('treats duplicate terminal lifecycle events as idempotent', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [{
            taskId: 'prd/01',
            stageId: 'prd',
            title: 'Spec',
            instruction: 'Draft spec.',
            dependsOn: [],
            lifecycle: 'ready',
            waitingOnTaskIds: [],
            runtime: { autostart: true },
            retries: 0,
            createdAt: '2026-04-10T15:51:25.000Z',
            updatedAt: '2026-04-10T15:51:25.000Z'
        }];
        runtime.agentExecutions = [{
            agentExecutionId: 'AgentExecution-1',
            taskId: 'prd/01',
            agentId: 'copilot-cli',
            lifecycle: 'terminated',
            launchedAt: '2026-04-10T15:52:00.000Z',
            updatedAt: '2026-04-10T15:53:00.000Z',
            terminatedAt: '2026-04-10T15:53:00.000Z'
        }];

        const event: WorkflowEvent = {
            eventId: 'runtime:AgentExecution-1:execution.terminated:duplicate',
            type: 'execution.terminated',
            occurredAt: '2026-04-10T15:54:00.000Z',
            source: 'daemon',
            agentExecutionId: 'AgentExecution-1',
            taskId: 'prd/01'
        };

        validateWorkflowEvent(runtime, event, configuration);
        const result = reduceWorkflowEvent(runtime, event, configuration);

        expect(result.nextState.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('ready');
        expect(result.nextState.launchQueue).toEqual([]);
        expect(result.requests).toEqual([]);
    });

    it('does not autostart tasks interrupted by AgentExecution termination', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [{
            taskId: 'prd/01',
            stageId: 'prd',
            title: 'PRD',
            instruction: 'Draft PRD.',
            dependsOn: [],
            lifecycle: 'running',
            waitingOnTaskIds: [],
            runtime: { autostart: true },
            retries: 0,
            createdAt: '2026-04-10T15:51:25.000Z',
            updatedAt: '2026-04-10T15:52:00.000Z'
        }];
        runtime.agentExecutions = [{
            agentExecutionId: 'AgentExecution-1',
            taskId: 'prd/01',
            agentId: 'copilot-cli',
            lifecycle: 'running',
            launchedAt: '2026-04-10T15:52:00.000Z',
            updatedAt: '2026-04-10T15:52:00.000Z'
        }];

        const event: WorkflowEvent = {
            eventId: 'runtime:AgentExecution-1:execution.terminated',
            type: 'execution.terminated',
            occurredAt: '2026-04-10T15:53:00.000Z',
            source: 'daemon',
            agentExecutionId: 'AgentExecution-1',
            taskId: 'prd/01'
        };

        validateWorkflowEvent(runtime, event, configuration);
        const result = reduceWorkflowEvent(runtime, event, configuration);

        const interruptedTask = result.nextState.tasks.find((task) => task.taskId === 'prd/01');
        expect(interruptedTask?.lifecycle).toBe('ready');
        expect(interruptedTask?.runtime.autostart).toBe(false);
        expect(result.nextState.launchQueue).toEqual([]);
        expect(result.requests).toEqual([]);

        const followUp = reduceWorkflowEvent(result.nextState, {
            eventId: 'mission.launch-queue.restarted:noop',
            type: 'mission.launch-queue.restarted',
            occurredAt: '2026-04-10T15:54:00.000Z',
            source: 'human'
        }, configuration);

        expect(followUp.nextState.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('ready');
        expect(followUp.nextState.launchQueue).toEqual([]);
        expect(followUp.requests).toEqual([]);
    });

    it('tracks the reducer-owned active stage id as work advances', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        expect(runtime.activeStageId).toBe('prd');

        runtime = reduceWorkflowEvent(runtime, {
            eventId: 'mission.created',
            type: 'mission.created',
            occurredAt: '2026-04-10T15:51:25.000Z',
            source: 'human'
        }, configuration).nextState;
        expect(runtime.activeStageId).toBe('prd');

        runtime = reduceWorkflowEvent(runtime, createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
            { taskId: 'prd/01', title: 'PRD', instruction: 'Draft PRD.' }
        ]), configuration).nextState;
        expect(runtime.activeStageId).toBe('prd');

        validateWorkflowEvent(runtime, createTaskCompletedEvent('prd/01', '2026-04-10T15:54:00.000Z'), configuration);
        runtime = reduceWorkflowEvent(runtime, createTaskCompletedEvent('prd/01', '2026-04-10T15:54:00.000Z'), configuration).nextState;
        expect(runtime.activeStageId).toBe('spec');
    });

    it('records mission pause target metadata in runtime state', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime = reduceWorkflowEvent(runtime, {
            eventId: 'mission.created',
            type: 'mission.created',
            occurredAt: '2026-04-10T15:51:25.000Z',
            source: 'human'
        }, configuration).nextState;
        runtime = reduceWorkflowEvent(runtime, {
            eventId: 'mission.started',
            type: 'mission.started',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human'
        }, configuration).nextState;

        const pauseEvent: WorkflowEvent = {
            eventId: 'mission.paused',
            type: 'mission.paused',
            occurredAt: '2026-04-10T15:53:00.000Z',
            source: 'human',
            reason: 'human-requested',
            targetType: 'mission'
        };

        validateWorkflowEvent(runtime, pauseEvent, configuration);
        runtime = reduceWorkflowEvent(runtime, pauseEvent, configuration).nextState;

        expect(runtime.lifecycle).toBe('paused');
        expect(runtime.pause).toEqual({
            paused: true,
            reason: 'human-requested',
            targetType: 'mission',
            requestedAt: '2026-04-10T15:53:00.000Z'
        });
    });

    it('auto-completes an empty final delivery stage after audit completion', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        const events: WorkflowEvent[] = [
            {
                eventId: 'mission.created',
                type: 'mission.created',
                occurredAt: '2026-04-10T15:51:25.000Z',
                source: 'human'
            },
            {
                eventId: 'mission.started',
                type: 'mission.started',
                occurredAt: '2026-04-10T15:52:00.000Z',
                source: 'human'
            },
            createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
                { taskId: 'prd/01', title: 'PRD', instruction: 'Draft PRD.' }
            ]),
            createTaskCompletedEvent('prd/01', '2026-04-10T15:54:00.000Z'),
            createGeneratedTasksEvent('spec', '2026-04-10T15:55:00.000Z', [
                { taskId: 'spec/01', title: 'Spec', instruction: 'Draft spec.' }
            ]),
            createTaskCompletedEvent('spec/01', '2026-04-10T15:56:00.000Z'),
            createGeneratedTasksEvent('implementation', '2026-04-10T15:57:00.000Z', [
                { taskId: 'implementation/01', title: 'Implement', instruction: 'Ship implementation.' }
            ]),
            createTaskCompletedEvent('implementation/01', '2026-04-10T15:58:00.000Z'),
            createGeneratedTasksEvent('audit', '2026-04-10T15:59:00.000Z', [
                { taskId: 'audit/01', title: 'Audit', instruction: 'Debrief.' }
            ]),
            createTaskCompletedEvent('audit/01', '2026-04-10T16:00:00.000Z')
        ];

        for (const event of events) {
            validateWorkflowEvent(runtime, event, configuration);
            runtime = reduceWorkflowEvent(runtime, event, configuration).nextState;
        }

        expect(runtime.lifecycle).toBe('completed');
        expect(runtime.stages.find((stage) => stage.stageId === 'delivery')?.lifecycle).toBe('completed');
        expect(runtime.gates.find((gate) => gate.gateId === 'deliver')?.state).toBe('passed');

        const deliveredEvent: WorkflowEvent = {
            eventId: 'mission.delivered',
            type: 'mission.delivered',
            occurredAt: '2026-04-10T16:01:00.000Z',
            source: 'human'
        };
        validateWorkflowEvent(runtime, deliveredEvent, configuration);

        runtime = reduceWorkflowEvent(runtime, deliveredEvent, configuration).nextState;
        expect(runtime.lifecycle).toBe('delivered');
    });

    it('does not emit decorative mission completion requests', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        const events: WorkflowEvent[] = [
            {
                eventId: 'mission.created',
                type: 'mission.created',
                occurredAt: '2026-04-10T15:51:25.000Z',
                source: 'human'
            },
            {
                eventId: 'mission.started',
                type: 'mission.started',
                occurredAt: '2026-04-10T15:52:00.000Z',
                source: 'human'
            },
            createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
                { taskId: 'prd/01', title: 'PRD', instruction: 'Draft PRD.' }
            ]),
            createTaskCompletedEvent('prd/01', '2026-04-10T15:54:00.000Z'),
            createGeneratedTasksEvent('spec', '2026-04-10T15:55:00.000Z', [
                { taskId: 'spec/01', title: 'Spec', instruction: 'Draft spec.' }
            ]),
            createTaskCompletedEvent('spec/01', '2026-04-10T15:56:00.000Z'),
            createGeneratedTasksEvent('implementation', '2026-04-10T15:57:00.000Z', [
                { taskId: 'implementation/01', title: 'Implement', instruction: 'Ship implementation.' }
            ]),
            createTaskCompletedEvent('implementation/01', '2026-04-10T15:58:00.000Z'),
            createGeneratedTasksEvent('audit', '2026-04-10T15:59:00.000Z', [
                { taskId: 'audit/01', title: 'Audit', instruction: 'Debrief.' }
            ]),
            createTaskCompletedEvent('audit/01', '2026-04-10T16:00:00.000Z')
        ];

        let finalResult = reduceWorkflowEvent(runtime, events[0]!, configuration);
        runtime = finalResult.nextState;
        for (const event of events.slice(1)) {
            validateWorkflowEvent(runtime, event, configuration);
            finalResult = reduceWorkflowEvent(runtime, event, configuration);
            runtime = finalResult.nextState;
        }

        expect(runtime.lifecycle).toBe('completed');
        expect(finalResult.requests).toEqual([]);
        expect(finalResult.signals.map((signal) => signal.type)).toContain('mission.completed');
        expect(finalResult.signals.map((signal) => signal.type)).toContain('mission.delivered-ready');
    });

    it('does not auto-complete empty non-terminal stages', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        const events: WorkflowEvent[] = [
            {
                eventId: 'mission.created',
                type: 'mission.created',
                occurredAt: '2026-04-10T15:51:25.000Z',
                source: 'human'
            },
            {
                eventId: 'mission.started',
                type: 'mission.started',
                occurredAt: '2026-04-10T15:52:00.000Z',
                source: 'human'
            },
            createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
                { taskId: 'prd/01', title: 'PRD', instruction: 'Draft PRD.' }
            ]),
            createTaskCompletedEvent('prd/01', '2026-04-10T15:54:00.000Z'),
            createGeneratedTasksEvent('spec', '2026-04-10T15:55:00.000Z', [
                { taskId: 'spec/01', title: 'Spec', instruction: 'Draft spec.' }
            ]),
            createTaskCompletedEvent('spec/01', '2026-04-10T15:56:00.000Z')
        ];

        for (const event of events) {
            validateWorkflowEvent(runtime, event, configuration);
            runtime = reduceWorkflowEvent(runtime, event, configuration).nextState;
        }

        expect(runtime.lifecycle).toBe('running');
        expect(runtime.stages.find((stage) => stage.stageId === 'implementation')?.lifecycle).toBe('pending');
        expect(runtime.gates.find((gate) => gate.gateId === 'deliver')?.state).toBe('blocked');
    });

    it('keeps dependency references strict and blocks tasks with unresolved dependencies', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        const events: WorkflowEvent[] = [
            {
                eventId: 'mission.created',
                type: 'mission.created',
                occurredAt: '2026-04-10T15:51:25.000Z',
                source: 'human'
            },
            {
                eventId: 'mission.started',
                type: 'mission.started',
                occurredAt: '2026-04-10T15:52:00.000Z',
                source: 'human'
            },
            createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
                { taskId: 'prd/01-prd', title: 'PRD', instruction: 'Draft PRD.' }
            ]),
            createTaskCompletedEvent('prd/01-prd', '2026-04-10T15:54:00.000Z'),
            createGeneratedTasksEvent('spec', '2026-04-10T15:55:00.000Z', [
                { taskId: 'spec/02-plan', title: 'Plan', instruction: 'Draft plan.' }
            ]),
            createTaskCompletedEvent('spec/02-plan', '2026-04-10T15:56:00.000Z'),
            createGeneratedTasksEvent('implementation', '2026-04-10T15:57:00.000Z', [
                {
                    taskId: 'implementation/01-derive-title',
                    title: 'Derive title',
                    instruction: 'Derive runtime title.',
                    dependsOn: ['spec/02-plan.md']
                }
            ])
        ];

        for (const event of events) {
            validateWorkflowEvent(runtime, event, configuration);
            runtime = reduceWorkflowEvent(runtime, event, configuration).nextState;
        }

        const task = runtime.tasks.find((candidate) => candidate.taskId === 'implementation/01-derive-title');
        expect(task).toBeDefined();
        expect(task?.dependsOn).toEqual(['spec/02-plan.md']);
        expect(task?.waitingOnTaskIds).toEqual(['spec/02-plan.md']);
        expect(task?.lifecycle).toBe('pending');
        expect(runtime.stages.find((stage) => stage.stageId === 'implementation')?.lifecycle).toBe('pending');
    });

    it('rewinds transitive dependent tasks when an upstream task is reopened', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        const events: WorkflowEvent[] = [
            {
                eventId: 'mission.created',
                type: 'mission.created',
                occurredAt: '2026-04-10T15:51:25.000Z',
                source: 'human'
            },
            {
                eventId: 'mission.started',
                type: 'mission.started',
                occurredAt: '2026-04-10T15:52:00.000Z',
                source: 'human'
            },
            createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
                { taskId: 'prd/01', title: 'PRD', instruction: 'Draft PRD.' }
            ]),
            createTaskCompletedEvent('prd/01', '2026-04-10T15:54:00.000Z'),
            createGeneratedTasksEvent('spec', '2026-04-10T15:55:00.000Z', [
                { taskId: 'spec/01', title: 'Spec', instruction: 'Draft spec.', dependsOn: ['prd/01'] }
            ]),
            createTaskCompletedEvent('spec/01', '2026-04-10T15:56:00.000Z'),
            createGeneratedTasksEvent('implementation', '2026-04-10T15:57:00.000Z', [
                { taskId: 'implementation/01', title: 'Implement', instruction: 'Ship implementation.', dependsOn: ['spec/01'] }
            ]),
            {
                eventId: 'execution.started:implementation/01:2026-04-10T15:57:30.000Z',
                type: 'execution.started',
                occurredAt: '2026-04-10T15:57:30.000Z',
                source: 'daemon',
                agentExecutionId: 'AgentExecution-implementation-01',
                taskId: 'implementation/01',
                agentId: 'copilot-cli'
            },
            {
                eventId: 'execution.cancelled:implementation/01:2026-04-10T15:58:00.000Z',
                type: 'execution.cancelled',
                occurredAt: '2026-04-10T15:58:00.000Z',
                source: 'daemon',
                agentExecutionId: 'AgentExecution-implementation-01',
                taskId: 'implementation/01'
            },
            createTaskReopenedEvent('prd/01', '2026-04-10T15:59:00.000Z'),
            createTaskCompletedEvent('prd/01', '2026-04-10T16:00:00.000Z')
        ];

        for (const event of events) {
            validateWorkflowEvent(runtime, event, configuration);
            runtime = reduceWorkflowEvent(runtime, event, configuration).nextState;
        }

        const specTask = runtime.tasks.find((task) => task.taskId === 'spec/01');
        expect(specTask?.lifecycle).toBe('ready');
        expect(runtime.stages.find((stage) => stage.stageId === 'spec')?.lifecycle).toBe('ready');
        expect(runtime.stages.find((stage) => stage.stageId === 'implementation')?.lifecycle).toBe('pending');
    });

    it('rewinds same-stage transitive dependents when a completed task is reopened', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [
            {
                taskId: 'prd/01',
                stageId: 'prd',
                title: 'Draft PRD',
                instruction: 'Draft PRD.',
                dependsOn: [],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:51:25.000Z',
                updatedAt: '2026-04-10T15:54:00.000Z',
                completedAt: '2026-04-10T15:54:00.000Z'
            },
            {
                taskId: 'prd/02',
                stageId: 'prd',
                title: 'Review PRD',
                instruction: 'Review PRD.',
                dependsOn: ['prd/01'],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:52:25.000Z',
                updatedAt: '2026-04-10T15:55:00.000Z',
                completedAt: '2026-04-10T15:55:00.000Z'
            },
            {
                taskId: 'spec/01',
                stageId: 'spec',
                title: 'Draft spec',
                instruction: 'Draft spec.',
                dependsOn: ['prd/02'],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:53:25.000Z',
                updatedAt: '2026-04-10T15:56:00.000Z',
                completedAt: '2026-04-10T15:56:00.000Z'
            }
        ];

        const result = reduceWorkflowEvent(runtime, createTaskReopenedEvent('prd/01', '2026-04-10T15:57:00.000Z'), configuration);

        expect(result.nextState.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('ready');
        expect(result.nextState.tasks.find((task) => task.taskId === 'prd/02')?.lifecycle).toBe('pending');
        expect(result.nextState.tasks.find((task) => task.taskId === 'spec/01')?.lifecycle).toBe('pending');
    });

    it('preserves independent later-stage tasks when a completed task is reopened', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [
            {
                taskId: 'prd/01',
                stageId: 'prd',
                title: 'Draft PRD',
                instruction: 'Draft PRD.',
                dependsOn: [],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:51:25.000Z',
                updatedAt: '2026-04-10T15:54:00.000Z',
                completedAt: '2026-04-10T15:54:00.000Z'
            },
            {
                taskId: 'spec/01',
                stageId: 'spec',
                title: 'Independent spec',
                instruction: 'Draft independent spec.',
                dependsOn: [],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:52:25.000Z',
                updatedAt: '2026-04-10T15:55:00.000Z',
                completedAt: '2026-04-10T15:55:00.000Z'
            }
        ];

        const result = reduceWorkflowEvent(runtime, createTaskReopenedEvent('prd/01', '2026-04-10T15:56:00.000Z'), configuration);

        expect(result.nextState.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('ready');
        expect(result.nextState.tasks.find((task) => task.taskId === 'spec/01')?.lifecycle).toBe('completed');
    });

    it('rejects reopening a task while a transitive dependent task is active', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        const runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [
            {
                taskId: 'prd/01',
                stageId: 'prd',
                title: 'Draft PRD',
                instruction: 'Draft PRD.',
                dependsOn: [],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:51:25.000Z',
                updatedAt: '2026-04-10T15:54:00.000Z',
                completedAt: '2026-04-10T15:54:00.000Z'
            },
            {
                taskId: 'prd/02',
                stageId: 'prd',
                title: 'Review PRD',
                instruction: 'Review PRD.',
                dependsOn: ['prd/01'],
                lifecycle: 'running',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:52:25.000Z',
                updatedAt: '2026-04-10T15:55:00.000Z'
            }
        ];

        expect(() => validateWorkflowEvent(runtime, createTaskReopenedEvent('prd/01', '2026-04-10T15:56:00.000Z'), configuration)).toThrow(
            /downstream work is active/
        );
    });

    it('allows reopening a task while unrelated later-stage work is active', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        const runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [
            {
                taskId: 'prd/01',
                stageId: 'prd',
                title: 'Draft PRD',
                instruction: 'Draft PRD.',
                dependsOn: [],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:51:25.000Z',
                updatedAt: '2026-04-10T15:54:00.000Z',
                completedAt: '2026-04-10T15:54:00.000Z'
            },
            {
                taskId: 'spec/01',
                stageId: 'spec',
                title: 'Independent spec',
                instruction: 'Draft independent spec.',
                dependsOn: [],
                lifecycle: 'running',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:52:25.000Z',
                updatedAt: '2026-04-10T15:55:00.000Z'
            }
        ];

        expect(() => validateWorkflowEvent(runtime, createTaskReopenedEvent('prd/01', '2026-04-10T15:56:00.000Z'), configuration)).not.toThrow();
    });

    it('records audited rework state and rewinds dependents', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [
            {
                taskId: 'prd/01',
                stageId: 'prd',
                title: 'PRD',
                instruction: 'Draft PRD.',
                dependsOn: [],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false, maxReworkIterations: 2 },
                retries: 0,
                reworkIterationCount: 0,
                createdAt: '2026-04-10T15:50:25.000Z',
                updatedAt: '2026-04-10T15:52:00.000Z',
                completedAt: '2026-04-10T15:52:00.000Z'
            },
            {
                taskId: 'spec/01',
                stageId: 'spec',
                title: 'Spec',
                instruction: 'Draft spec.',
                dependsOn: ['prd/01'],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false, maxReworkIterations: 2 },
                retries: 0,
                reworkIterationCount: 0,
                createdAt: '2026-04-10T15:50:55.000Z',
                updatedAt: '2026-04-10T15:53:00.000Z',
                completedAt: '2026-04-10T15:53:00.000Z'
            },
            {
                taskId: 'implementation/02-introduce-generic-entity-remote-boundary',
                stageId: 'implementation',
                title: 'Implement boundary',
                instruction: 'Implement boundary.',
                dependsOn: [],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false, maxReworkIterations: 2 },
                retries: 0,
                reworkIterationCount: 0,
                createdAt: '2026-04-10T15:51:25.000Z',
                updatedAt: '2026-04-10T15:54:00.000Z',
                completedAt: '2026-04-10T15:54:00.000Z'
            },
            {
                taskId: 'implementation/02-introduce-generic-entity-remote-boundary-verify',
                stageId: 'implementation',
                title: 'Verify boundary',
                instruction: 'Verify boundary.',
                dependsOn: ['implementation/02-introduce-generic-entity-remote-boundary'],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false, maxReworkIterations: 2 },
                retries: 0,
                reworkIterationCount: 0,
                createdAt: '2026-04-10T15:52:25.000Z',
                updatedAt: '2026-04-10T15:55:00.000Z',
                completedAt: '2026-04-10T15:55:00.000Z'
            }
        ];

        const result = reduceWorkflowEvent(runtime, createTaskReworkedEvent(
            'implementation/02-introduce-generic-entity-remote-boundary',
            '2026-04-10T15:56:00.000Z',
            {
                actor: 'workflow',
                reasonCode: 'verification.failed',
                sourceTaskId: 'implementation/02-introduce-generic-entity-remote-boundary-verify',
                summary: 'Verification failed. Review VERIFY.md before retrying.',
                artifactRefs: [{ path: 'implementation/VERIFY.md', title: 'VERIFY.md' }]
            }
        ), configuration);

        const reworkedTask = result.nextState.tasks.find((task) => task.taskId === 'implementation/02-introduce-generic-entity-remote-boundary');
        const verifyTask = result.nextState.tasks.find((task) => task.taskId === 'implementation/02-introduce-generic-entity-remote-boundary-verify');

        expect(reworkedTask?.lifecycle).toBe('ready');
        expect(reworkedTask?.reworkIterationCount).toBe(1);
        expect(reworkedTask?.reworkRequest).toEqual(expect.objectContaining({
            actor: 'workflow',
            reasonCode: 'verification.failed',
            sourceTaskId: 'implementation/02-introduce-generic-entity-remote-boundary-verify',
            summary: 'Verification failed. Review VERIFY.md before retrying.',
            iteration: 1,
            maxIterations: 2
        }));
        expect(reworkedTask?.pendingLaunchContext).toEqual(expect.objectContaining({
            source: 'rework',
            summary: 'Verification failed. Review VERIFY.md before retrying.'
        }));
        expect(verifyTask?.lifecycle).toBe('pending');
    });

    it('marks audited rework as launched when the restarted AgentExecution begins', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        const runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [
            {
                taskId: 'implementation/02',
                stageId: 'implementation',
                title: 'Implement',
                instruction: 'Implement.',
                dependsOn: [],
                lifecycle: 'ready',
                waitingOnTaskIds: [],
                runtime: { autostart: false, maxReworkIterations: 2 },
                retries: 0,
                reworkIterationCount: 1,
                reworkRequest: {
                    requestId: 'task.reworked:implementation/02:2026-04-10T15:56:00.000Z',
                    requestedAt: '2026-04-10T15:56:00.000Z',
                    actor: 'workflow',
                    reasonCode: 'verification.failed',
                    summary: 'Fix verification gap.',
                    iteration: 1,
                    maxIterations: 2,
                    sourceTaskId: 'implementation/02-verify',
                    artifactRefs: [{ path: 'implementation/VERIFY.md', title: 'VERIFY.md' }]
                },
                pendingLaunchContext: {
                    source: 'rework',
                    requestId: 'task.reworked:implementation/02:2026-04-10T15:56:00.000Z',
                    createdAt: '2026-04-10T15:56:00.000Z',
                    actor: 'workflow',
                    reasonCode: 'verification.failed',
                    summary: 'Fix verification gap.',
                    sourceTaskId: 'implementation/02-verify',
                    artifactRefs: [{ path: 'implementation/VERIFY.md', title: 'VERIFY.md' }]
                },
                createdAt: '2026-04-10T15:51:25.000Z',
                updatedAt: '2026-04-10T15:56:00.000Z'
            }
        ];

        const result = reduceWorkflowEvent(runtime, {
            eventId: 'execution.started:implementation/02:2026-04-10T15:57:00.000Z',
            type: 'execution.started',
            occurredAt: '2026-04-10T15:57:00.000Z',
            source: 'daemon',
            agentExecutionId: 'AgentExecution-implementation-02',
            taskId: 'implementation/02',
            agentId: 'copilot-cli'
        }, configuration);

        const task = result.nextState.tasks.find((candidate) => candidate.taskId === 'implementation/02');
        expect(task?.lifecycle).toBe('running');
        expect(task?.pendingLaunchContext).toBeUndefined();
        expect(task?.reworkRequest?.launchedAt).toBe('2026-04-10T15:57:00.000Z');
    });

    it('rejects audited rework after max iterations are exhausted', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        const runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [
            {
                taskId: 'implementation/02',
                stageId: 'implementation',
                title: 'Implement',
                instruction: 'Implement.',
                dependsOn: [],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false, maxReworkIterations: 1 },
                retries: 0,
                reworkIterationCount: 1,
                createdAt: '2026-04-10T15:51:25.000Z',
                updatedAt: '2026-04-10T15:56:00.000Z',
                completedAt: '2026-04-10T15:56:00.000Z'
            }
        ];

        expect(() => validateWorkflowEvent(runtime, createTaskReworkedEvent('implementation/02', '2026-04-10T15:57:00.000Z', {
            actor: 'workflow',
            reasonCode: 'verification.failed',
            sourceTaskId: 'implementation/02-verify',
            summary: 'Fix verification gap.',
            artifactRefs: [{ path: 'implementation/VERIFY.md', title: 'VERIFY.md' }]
        }), configuration)).toThrow(/max rework iterations/);
    });

    it('returns a task to ready when its running AgentExecution is cancelled', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [
            {
                taskId: 'prd/01',
                stageId: 'prd',
                title: 'PRD',
                instruction: 'Draft PRD.',
                dependsOn: [],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:51:25.000Z',
                updatedAt: '2026-04-10T15:54:00.000Z',
                completedAt: '2026-04-10T15:54:00.000Z'
            },
            {
                taskId: 'spec/01',
                stageId: 'spec',
                title: 'Spec',
                instruction: 'Draft spec.',
                dependsOn: ['prd/01'],
                lifecycle: 'completed',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:55:00.000Z',
                updatedAt: '2026-04-10T15:56:00.000Z',
                completedAt: '2026-04-10T15:56:00.000Z'
            },
            {
                taskId: 'implementation/01',
                stageId: 'implementation',
                title: 'Implement',
                instruction: 'Ship it.',
                dependsOn: ['spec/01'],
                lifecycle: 'running',
                waitingOnTaskIds: [],
                runtime: { autostart: false },
                retries: 0,
                createdAt: '2026-04-10T15:57:00.000Z',
                updatedAt: '2026-04-10T15:57:30.000Z'
            }
        ];
        runtime.agentExecutions = [{
            agentExecutionId: 'AgentExecution-implementation-01',
            taskId: 'implementation/01',
            agentId: 'copilot-cli',
            lifecycle: 'running',
            launchedAt: '2026-04-10T15:57:30.000Z',
            updatedAt: '2026-04-10T15:57:30.000Z'
        }];

        const result = reduceWorkflowEvent(runtime, {
            eventId: 'execution.cancelled:implementation/01:2026-04-10T15:58:00.000Z',
            type: 'execution.cancelled',
            occurredAt: '2026-04-10T15:58:00.000Z',
            source: 'daemon',
            agentExecutionId: 'AgentExecution-implementation-01',
            taskId: 'implementation/01'
        }, configuration);

        expect(result.nextState.tasks.find((task) => task.taskId === 'implementation/01')?.lifecycle).toBe('ready');
        expect(result.nextState.agentExecutions.find((execution) => execution.agentExecutionId === 'AgentExecution-implementation-01')?.lifecycle).toBe('cancelled');
    });

    it('returns a queued task to ready and removes its launch request when the task is cancelled', () => {
        const configuration = createWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'running';
        runtime.pause = { paused: false };
        runtime.tasks = [
            {
                taskId: 'prd/01',
                stageId: 'prd',
                title: 'PRD',
                instruction: 'Draft PRD.',
                dependsOn: [],
                lifecycle: 'queued',
                waitingOnTaskIds: [],
                runtime: { autostart: true },
                retries: 0,
                createdAt: '2026-04-10T15:51:25.000Z',
                updatedAt: '2026-04-10T15:54:00.000Z'
            }
        ];
        runtime.launchQueue = [{
            requestId: 'task.launch:prd/01:2026-04-10T15:54:00.000Z',
            taskId: 'prd/01',
            requestedAt: '2026-04-10T15:54:00.000Z',
            requestedBy: 'human',
            causedByEventId: 'task.queued:prd/01:2026-04-10T15:54:00.000Z'
        }];

        const result = reduceWorkflowEvent(runtime, {
            eventId: 'task.cancelled:prd/01:2026-04-10T15:55:00.000Z',
            type: 'task.cancelled',
            occurredAt: '2026-04-10T15:55:00.000Z',
            source: 'human',
            taskId: 'prd/01',
            reason: 'operator cancelled task'
        }, configuration);

        expect(result.nextState.tasks.find((candidate) => candidate.taskId === 'prd/01')?.lifecycle).toBe('ready');
        expect(result.nextState.tasks.find((candidate) => candidate.taskId === 'prd/01')?.runtime.autostart).toBe(false);
        expect(result.nextState.launchQueue).toEqual([]);
    });

});

function createGeneratedTasksEvent(
    stageId: string,
    occurredAt: string,
    tasks: Array<{ taskId: string; title: string; instruction: string; dependsOn?: string[] }>
): WorkflowEvent {
    return {
        eventId: `tasks.generated:${stageId}:${occurredAt}`,
        type: 'tasks.generated',
        occurredAt,
        source: 'human',
        stageId,
        tasks: tasks.map((task) => ({
            ...task,
            dependsOn: [...(task.dependsOn ?? [])]
        }))
    };
}

function createTaskCompletedEvent(taskId: string, occurredAt: string): WorkflowEvent {
    return {
        eventId: `task.completed:${taskId}:${occurredAt}`,
        type: 'task.completed',
        occurredAt,
        source: 'human',
        taskId
    };
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

function createTaskReworkedEvent(
    taskId: string,
    occurredAt: string,
    input: {
        actor: 'human' | 'system' | 'workflow';
        reasonCode: string;
        summary: string;
        sourceTaskId?: string;
        sourceAgentExecutionId?: string;
        artifactRefs: Array<{ path: string; title?: string }>;
    }
): WorkflowEvent {
    return {
        eventId: `task.reworked:${taskId}:${occurredAt}`,
        type: 'task.reworked',
        occurredAt,
        source: 'human',
        taskId,
        actor: input.actor,
        reasonCode: input.reasonCode,
        summary: input.summary,
        ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
        ...(input.sourceAgentExecutionId ? { sourceAgentExecutionId: input.sourceAgentExecutionId } : {}),
        artifactRefs: input.artifactRefs.map((artifactRef) => ({ ...artifactRef }))
    };
}