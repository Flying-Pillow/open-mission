import { describe, expect, it } from 'vitest';
import {
    createInitialMissionWorkflowRuntimeState,
    createMissionWorkflowConfigurationSnapshot
} from './document.js';
import { DEFAULT_WORKFLOW_VERSION, createDefaultWorkflowSettings } from './defaultWorkflow.js';
import { reduceMissionWorkflowEvent } from './reducer.js';
import { validateMissionWorkflowEvent } from './validation.js';
import type { MissionWorkflowEvent } from './types.js';

describe('workflow reducer delivery completion', () => {
    it('persists terminal attachment metadata on started sessions', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
        });

        let runtime = createInitialMissionWorkflowRuntimeState(configuration, configuration.createdAt);
        runtime.tasks = [{
            taskId: 'implementation/01',
            stageId: 'implementation',
            title: 'Implement',
            instruction: 'Ship it.',
            dependsOn: [],
            lifecycle: 'queued',
            blockedByTaskIds: [],
            runtime: { autostart: false, launchMode: 'manual' },
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
            workflow: createDefaultWorkflowSettings()
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

    it('does not auto-complete empty non-terminal stages', () => {
        const configuration = createMissionWorkflowConfigurationSnapshot({
            createdAt: '2026-04-10T15:51:25.000Z',
            workflowVersion: DEFAULT_WORKFLOW_VERSION,
            workflow: createDefaultWorkflowSettings()
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
        expect(runtime.stages.find((stage) => stage.stageId === 'implementation')?.lifecycle).toBe('blocked');
        expect(runtime.gates.find((gate) => gate.gateId === 'deliver')?.state).toBe('blocked');
    });
});

function createGeneratedTasksEvent(
    stageId: string,
    occurredAt: string,
    tasks: Array<{ taskId: string; title: string; instruction: string }>
): MissionWorkflowEvent {
    return {
        eventId: `tasks.generated:${stageId}:${occurredAt}`,
        type: 'tasks.generated',
        occurredAt,
        source: 'human',
        stageId,
        tasks: tasks.map((task) => ({
            ...task,
            dependsOn: []
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