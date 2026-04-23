import { describe, expect, it } from 'vitest';
import {
    createInitialMissionWorkflowRuntimeState,
    createMissionWorkflowConfigurationSnapshot
} from './document.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from '../mission/workflow.js';
import { reduceMissionWorkflowEvent } from './reducer.js';
import { validateMissionWorkflowEvent } from './validation.js';
import type { MissionWorkflowEvent } from './types.js';

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
    it('persists terminal attachment metadata on started sessions', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
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

        const event: MissionWorkflowEvent = {
            eventId: 'session.started:implementation/01',
            type: 'session.started',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'daemon',
            sessionId: 'session-1',
            taskId: 'implementation/01',
            runnerId: 'copilot-cli',
            transportId: 'terminal',
            terminalSessionName: 'airport-terminal-session',
            terminalPaneId: 'terminal_44'
        };

        validateMissionWorkflowEvent(runtime, event, configuration);
        runtime = reduceMissionWorkflowEvent(runtime, event, configuration).nextState;

        expect(runtime.sessions).toContainEqual(expect.objectContaining({
            sessionId: 'session-1',
            terminalSessionName: 'airport-terminal-session',
            terminalPaneId: 'terminal_44'
        }));
    });

    it('queues and emits session launch requests for ready autostart tasks', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime = reduceMissionWorkflowEvent(runtime, {
            eventId: 'mission.created',
            type: 'mission.created',
            occurredAt: '2026-04-10T15:51:25.000Z',
            source: 'human'
        }, configuration).nextState;
        runtime = reduceMissionWorkflowEvent(runtime, {
            eventId: 'mission.started',
            type: 'mission.started',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human'
        }, configuration).nextState;

        const result = reduceMissionWorkflowEvent(runtime, createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
            { taskId: 'prd/01', title: 'PRD', instruction: 'Draft PRD.' }
        ]), configuration);

        expect(result.nextState.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('queued');
        expect(result.requests).toContainEqual(expect.objectContaining({
            type: 'session.launch',
            payload: { taskId: 'prd/01' }
        }));
    });

    it('does not autostart dependent tasks until prerequisites are completed', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime = reduceMissionWorkflowEvent(runtime, {
            eventId: 'mission.created',
            type: 'mission.created',
            occurredAt: '2026-04-10T15:51:25.000Z',
            source: 'human'
        }, configuration).nextState;
        runtime = reduceMissionWorkflowEvent(runtime, {
            eventId: 'mission.started',
            type: 'mission.started',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human'
        }, configuration).nextState;

        const generated = reduceMissionWorkflowEvent(runtime, createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
            { taskId: 'prd/01', title: 'PRD', instruction: 'Draft PRD.' },
            { taskId: 'prd/02', title: 'PRD Follow-up', instruction: 'Refine PRD.', dependsOn: ['prd/01'] }
        ]), configuration);

        expect(generated.nextState.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('queued');
        expect(generated.nextState.tasks.find((task) => task.taskId === 'prd/02')).toEqual(expect.objectContaining({
            lifecycle: 'pending',
            waitingOnTaskIds: ['prd/01']
        }));
        expect(generated.requests).toContainEqual(expect.objectContaining({
            type: 'session.launch',
            payload: { taskId: 'prd/01' }
        }));
        expect(generated.requests).not.toContainEqual(expect.objectContaining({
            type: 'session.launch',
            payload: { taskId: 'prd/02' }
        }));

        const started = reduceMissionWorkflowEvent(generated.nextState, {
            eventId: 'session.started:prd/01:2026-04-10T15:53:30.000Z',
            type: 'session.started',
            occurredAt: '2026-04-10T15:53:30.000Z',
            source: 'daemon',
            sessionId: 'session-prd-01',
            taskId: 'prd/01',
            runnerId: 'copilot-cli'
        }, configuration);

        const completed = reduceMissionWorkflowEvent(started.nextState, createTaskCompletedEvent('prd/01', '2026-04-10T15:54:00.000Z'), configuration);

        expect(completed.nextState.tasks.find((task) => task.taskId === 'prd/02')?.lifecycle).toBe('queued');
        expect(completed.requests).not.toContainEqual(expect.objectContaining({
            type: 'session.launch',
            payload: { taskId: 'prd/02' }
        }));

        const sessionCompleted = reduceMissionWorkflowEvent(completed.nextState, {
            eventId: 'session.completed:prd/01:2026-04-10T15:54:05.000Z',
            type: 'session.completed',
            occurredAt: '2026-04-10T15:54:05.000Z',
            source: 'daemon',
            sessionId: 'session-prd-01',
            taskId: 'prd/01'
        }, configuration);

        expect(sessionCompleted.requests).toContainEqual(expect.objectContaining({
            type: 'session.launch',
            payload: { taskId: 'prd/02' }
        }));
    });

    it('enforces execution limits for autostart queueing and session dispatch', () => {
        const workflow = createDefaultWorkflowSettings();
        workflow.execution.maxParallelTasks = 2;
        workflow.execution.maxParallelSessions = 1;
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime = reduceMissionWorkflowEvent(runtime, {
            eventId: 'mission.created',
            type: 'mission.created',
            occurredAt: '2026-04-10T15:51:25.000Z',
            source: 'human'
        }, configuration).nextState;
        runtime = reduceMissionWorkflowEvent(runtime, {
            eventId: 'mission.started',
            type: 'mission.started',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human'
        }, configuration).nextState;

        const generated = reduceMissionWorkflowEvent(runtime, createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
            { taskId: 'prd/01', title: 'PRD 1', instruction: 'Draft PRD 1.' },
            { taskId: 'prd/02', title: 'PRD 2', instruction: 'Draft PRD 2.' },
            { taskId: 'prd/03', title: 'PRD 3', instruction: 'Draft PRD 3.' }
        ]), configuration);

        expect(generated.nextState.tasks.filter((task) => task.lifecycle === 'queued').map((task) => task.taskId)).toEqual([
            'prd/01',
            'prd/02'
        ]);
        expect(generated.nextState.tasks.find((task) => task.taskId === 'prd/03')?.lifecycle).toBe('ready');
        expect(generated.requests.filter((request) => request.type === 'session.launch')).toHaveLength(1);
        expect(generated.nextState.launchQueue.find((request) => request.taskId === 'prd/01')?.dispatchedAt).toBe('2026-04-10T15:53:00.000Z');
        expect(generated.nextState.launchQueue.find((request) => request.taskId === 'prd/02')?.dispatchedAt).toBeUndefined();
    });

    it('rejects queueing a task beyond execution.maxParallelTasks', () => {
        const workflow = createDefaultWorkflowSettings();
        workflow.execution.maxParallelTasks = 1;
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow
        });

        const runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
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

        expect(() => validateMissionWorkflowEvent(runtime, {
            eventId: 'task.queued:prd/02',
            type: 'task.queued',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human',
            taskId: 'prd/02'
        }, configuration)).toThrow(/execution.maxParallelTasks/);
    });

    it('restarts a stale launch queue and re-emits launch requests for queued tasks', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
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

        const restartEvent: MissionWorkflowEvent = {
            eventId: 'mission.launch-queue.restarted',
            type: 'mission.launch-queue.restarted',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human'
        };

        validateMissionWorkflowEvent(runtime, restartEvent, configuration);
        const result = reduceMissionWorkflowEvent(runtime, restartEvent, configuration);

        expect(result.nextState.launchQueue).toHaveLength(1);
        expect(result.nextState.launchQueue[0]?.taskId).toBe('prd/01');
        expect(result.nextState.launchQueue[0]?.dispatchedAt).toBe('2026-04-10T15:52:00.000Z');
        expect(result.requests).toContainEqual(expect.objectContaining({
            type: 'session.launch',
            payload: { taskId: 'prd/01' }
        }));
    });

    it('tracks the reducer-owned active stage id as work advances', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
        expect(runtime.activeStageId).toBe('prd');

        runtime = reduceMissionWorkflowEvent(runtime, {
            eventId: 'mission.created',
            type: 'mission.created',
            occurredAt: '2026-04-10T15:51:25.000Z',
            source: 'human'
        }, configuration).nextState;
        expect(runtime.activeStageId).toBe('prd');

        runtime = reduceMissionWorkflowEvent(runtime, createGeneratedTasksEvent('prd', '2026-04-10T15:53:00.000Z', [
            { taskId: 'prd/01', title: 'PRD', instruction: 'Draft PRD.' }
        ]), configuration).nextState;
        expect(runtime.activeStageId).toBe('prd');

        validateMissionWorkflowEvent(runtime, createTaskCompletedEvent('prd/01', '2026-04-10T15:54:00.000Z'), configuration);
        runtime = reduceMissionWorkflowEvent(runtime, createTaskCompletedEvent('prd/01', '2026-04-10T15:54:00.000Z'), configuration).nextState;
        expect(runtime.activeStageId).toBe('spec');
    });

    it('records mission pause target metadata in runtime state', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime = reduceMissionWorkflowEvent(runtime, {
            eventId: 'mission.created',
            type: 'mission.created',
            occurredAt: '2026-04-10T15:51:25.000Z',
            source: 'human'
        }, configuration).nextState;
        runtime = reduceMissionWorkflowEvent(runtime, {
            eventId: 'mission.started',
            type: 'mission.started',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human'
        }, configuration).nextState;

        const pauseEvent: MissionWorkflowEvent = {
            eventId: 'mission.paused',
            type: 'mission.paused',
            occurredAt: '2026-04-10T15:53:00.000Z',
            source: 'human',
            reason: 'human-requested',
            targetType: 'mission'
        };

        validateMissionWorkflowEvent(runtime, pauseEvent, configuration);
        runtime = reduceMissionWorkflowEvent(runtime, pauseEvent, configuration).nextState;

        expect(runtime.lifecycle).toBe('paused');
        expect(runtime.pause).toEqual({
            paused: true,
            reason: 'human-requested',
            targetType: 'mission',
            requestedAt: '2026-04-10T15:53:00.000Z'
        });
    });

    it('auto-completes an empty final delivery stage after audit completion', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
        const events: MissionWorkflowEvent[] = [
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
            validateMissionWorkflowEvent(runtime, event, configuration);
            runtime = reduceMissionWorkflowEvent(runtime, event, configuration).nextState;
        }

        expect(runtime.lifecycle).toBe('completed');
        expect(runtime.stages.find((stage) => stage.stageId === 'delivery')?.lifecycle).toBe('completed');
        expect(runtime.gates.find((gate) => gate.gateId === 'deliver')?.state).toBe('passed');

        const deliveredEvent: MissionWorkflowEvent = {
            eventId: 'mission.delivered',
            type: 'mission.delivered',
            occurredAt: '2026-04-10T16:01:00.000Z',
            source: 'human'
        };
        validateMissionWorkflowEvent(runtime, deliveredEvent, configuration);

        runtime = reduceMissionWorkflowEvent(runtime, deliveredEvent, configuration).nextState;
        expect(runtime.lifecycle).toBe('delivered');
    });

    it('does not emit decorative mission completion requests', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
        const events: MissionWorkflowEvent[] = [
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

        let finalResult = reduceMissionWorkflowEvent(runtime, events[0]!, configuration);
        runtime = finalResult.nextState;
        for (const event of events.slice(1)) {
            validateMissionWorkflowEvent(runtime, event, configuration);
            finalResult = reduceMissionWorkflowEvent(runtime, event, configuration);
            runtime = finalResult.nextState;
        }

        expect(runtime.lifecycle).toBe('completed');
        expect(finalResult.requests).toEqual([]);
        expect(finalResult.signals.map((signal) => signal.type)).toContain('mission.completed');
        expect(finalResult.signals.map((signal) => signal.type)).toContain('mission.delivered-ready');
    });

    it('does not auto-complete empty non-terminal stages', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
        const events: MissionWorkflowEvent[] = [
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
            validateMissionWorkflowEvent(runtime, event, configuration);
            runtime = reduceMissionWorkflowEvent(runtime, event, configuration).nextState;
        }

        expect(runtime.lifecycle).toBe('running');
        expect(runtime.stages.find((stage) => stage.stageId === 'implementation')?.lifecycle).toBe('pending');
        expect(runtime.gates.find((gate) => gate.gateId === 'deliver')?.state).toBe('blocked');
    });

    it('keeps dependency references strict and blocks tasks with unresolved dependencies', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
        const events: MissionWorkflowEvent[] = [
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
            validateMissionWorkflowEvent(runtime, event, configuration);
            runtime = reduceMissionWorkflowEvent(runtime, event, configuration).nextState;
        }

        const task = runtime.tasks.find((candidate) => candidate.taskId === 'implementation/01-derive-title');
        expect(task).toBeDefined();
        expect(task?.dependsOn).toEqual(['spec/02-plan.md']);
        expect(task?.waitingOnTaskIds).toEqual(['spec/02-plan.md']);
        expect(task?.lifecycle).toBe('pending');
        expect(runtime.stages.find((stage) => stage.stageId === 'implementation')?.lifecycle).toBe('pending');
    });

    it('rewinds transitive dependent tasks when an upstream task is reopened', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
        const events: MissionWorkflowEvent[] = [
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
                eventId: 'session.started:implementation/01:2026-04-10T15:57:30.000Z',
                type: 'session.started',
                occurredAt: '2026-04-10T15:57:30.000Z',
                source: 'daemon',
                sessionId: 'session-implementation-01',
                taskId: 'implementation/01',
                runnerId: 'copilot-cli'
            },
            {
                eventId: 'session.cancelled:implementation/01:2026-04-10T15:58:00.000Z',
                type: 'session.cancelled',
                occurredAt: '2026-04-10T15:58:00.000Z',
                source: 'daemon',
                sessionId: 'session-implementation-01',
                taskId: 'implementation/01'
            },
            createTaskReopenedEvent('prd/01', '2026-04-10T15:59:00.000Z'),
            createTaskCompletedEvent('prd/01', '2026-04-10T16:00:00.000Z')
        ];

        for (const event of events) {
            validateMissionWorkflowEvent(runtime, event, configuration);
            runtime = reduceMissionWorkflowEvent(runtime, event, configuration).nextState;
        }

        const specTask = runtime.tasks.find((task) => task.taskId === 'spec/01');
        expect(specTask?.lifecycle).toBe('ready');
        expect(runtime.stages.find((stage) => stage.stageId === 'spec')?.lifecycle).toBe('ready');
        expect(runtime.stages.find((stage) => stage.stageId === 'implementation')?.lifecycle).toBe('pending');
    });

    it('rewinds same-stage transitive dependents when a completed task is reopened', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
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

        const result = reduceMissionWorkflowEvent(runtime, createTaskReopenedEvent('prd/01', '2026-04-10T15:57:00.000Z'), configuration);

        expect(result.nextState.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('ready');
        expect(result.nextState.tasks.find((task) => task.taskId === 'prd/02')?.lifecycle).toBe('pending');
        expect(result.nextState.tasks.find((task) => task.taskId === 'spec/01')?.lifecycle).toBe('pending');
    });

    it('preserves independent later-stage tasks when a completed task is reopened', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createWorkflowSettingsWithoutTaskAutostart()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
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

        const result = reduceMissionWorkflowEvent(runtime, createTaskReopenedEvent('prd/01', '2026-04-10T15:56:00.000Z'), configuration);

        expect(result.nextState.tasks.find((task) => task.taskId === 'prd/01')?.lifecycle).toBe('ready');
        expect(result.nextState.tasks.find((task) => task.taskId === 'spec/01')?.lifecycle).toBe('completed');
    });

    it('rejects reopening a task while a transitive dependent task is active', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        const runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
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

        expect(() => validateMissionWorkflowEvent(runtime, createTaskReopenedEvent('prd/01', '2026-04-10T15:56:00.000Z'), configuration)).toThrow(
            /downstream work is active/
        );
    });

    it('allows reopening a task while unrelated later-stage work is active', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        const runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
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

        expect(() => validateMissionWorkflowEvent(runtime, createTaskReopenedEvent('prd/01', '2026-04-10T15:56:00.000Z'), configuration)).not.toThrow();
    });

    it('returns a task to ready when its running session is cancelled', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
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
        runtime.sessions = [{
            sessionId: 'session-implementation-01',
            taskId: 'implementation/01',
            runnerId: 'copilot-cli',
            lifecycle: 'running',
            launchedAt: '2026-04-10T15:57:30.000Z',
            updatedAt: '2026-04-10T15:57:30.000Z'
        }];

        const result = reduceMissionWorkflowEvent(runtime, {
            eventId: 'session.cancelled:implementation/01:2026-04-10T15:58:00.000Z',
            type: 'session.cancelled',
            occurredAt: '2026-04-10T15:58:00.000Z',
            source: 'daemon',
            sessionId: 'session-implementation-01',
            taskId: 'implementation/01'
        }, configuration);

        expect(result.nextState.tasks.find((task) => task.taskId === 'implementation/01')?.lifecycle).toBe('ready');
        expect(result.nextState.sessions.find((session) => session.sessionId === 'session-implementation-01')?.lifecycle).toBe('cancelled');
    });

    it('rejects panic requests after mission completion', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        const runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.lifecycle = 'completed';

        expect(() => validateMissionWorkflowEvent(runtime, {
            eventId: 'mission.panic.requested:2026-04-10T15:52:00.000Z',
            type: 'mission.panic.requested',
            occurredAt: '2026-04-10T15:52:00.000Z',
            source: 'human'
        }, configuration)).toThrow(/not allowed after mission completion/);
    });

});

function createGeneratedTasksEvent(
    stageId: string,
    occurredAt: string,
    tasks: Array<{ taskId: string; title: string; instruction: string; dependsOn?: string[] }>
): MissionWorkflowEvent {
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

function createTaskCompletedEvent(taskId: string, occurredAt: string): MissionWorkflowEvent {
    return {
        eventId: `task.completed:${taskId}:${occurredAt}`,
        type: 'task.completed',
        occurredAt,
        source: 'human',
        taskId
    };
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