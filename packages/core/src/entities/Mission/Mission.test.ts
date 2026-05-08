import { describe, expect, it } from 'vitest';
import {
    createAllRuntimeEventSubscriptionChannels,
    createMissionRuntimeEventSubscriptionChannels,
    MissionContract
} from './MissionContract.js';
import { MissionCommandIds, MissionDataSchema, MissionSnapshotSchema } from './MissionSchema.js';
import { AgentExecutionDataSchema } from '../AgentExecution/AgentExecutionSchema.js';
import { ArtifactDataSchema } from '../Artifact/ArtifactSchema.js';
import { StageDataSchema } from '../Stage/StageSchema.js';
import { TaskCommandIds, TaskDataSchema } from '../Task/TaskSchema.js';

const artifact = ArtifactDataSchema.parse({
    id: 'artifact:mission-1/mission:brief',
    kind: 'mission',
    label: 'Brief',
    fileName: 'BRIEF.md',
    key: 'brief',
    relativePath: 'BRIEF.md'
});

const task = TaskDataSchema.parse({
    id: 'task:mission-1/implementation/01',
    taskId: 'implementation/01',
    stageId: 'implementation',
    sequence: 1,
    title: 'Implement task',
    instruction: 'Ship it.',
    lifecycle: 'ready',
    dependsOn: [],
    waitingOnTaskIds: [],
    agentAdapter: 'copilot-cli',
    retries: 0,
    fileName: '01.md',
    relativePath: 'implementation/tasks/01.md'
});

const stage = StageDataSchema.parse({
    id: 'stage:mission-1/implementation',
    stageId: 'implementation',
    lifecycle: 'ready',
    isCurrentStage: true,
    artifacts: [],
    tasks: [task]
});

const agentExecution = AgentExecutionDataSchema.parse({
    id: 'agent_execution:mission-1/session-1',
    ownerId: 'mission-1',
    sessionId: 'session-1',
    agentId: 'copilot-cli',
    transportId: 'terminal',
    adapterLabel: 'Copilot CLI',
    lifecycleState: 'running',
    terminalHandle: {
        terminalName: 'mission-agent-execution',
        terminalPaneId: 'terminal_1'
    },
    taskId: 'implementation/01',
    interactionCapabilities: {
        mode: 'pty-terminal',
        canSendTerminalInput: true,
        canSendStructuredPrompt: false,
        canSendStructuredCommand: false
    },
    context: {
        artifacts: [],
        instructions: []
    },
    runtimeMessages: []
});

const missionData = {
    id: 'mission:mission-1',
    missionId: 'mission-1',
    title: 'Mission entity strict schema',
    type: 'refactor',
    branchRef: 'mission/mission-1',
    missionDir: '/mission/.mission/missions/mission-1',
    missionRootDir: '/mission',
    lifecycle: 'running',
    currentStageId: 'implementation',
    artifacts: [artifact],
    stages: [stage],
    agentExecutions: [agentExecution]
};

describe('Mission schemas', () => {
    it('composes Mission data from the four child Entity schemas', () => {
        const parsed = MissionDataSchema.parse(missionData);

        expect(parsed.artifacts[0]).toEqual(artifact);
        expect(parsed.stages[0]).toEqual(stage);
        expect(parsed.stages[0]?.tasks[0]).toEqual(task);
        expect(parsed.agentExecutions[0]).toEqual(agentExecution);
    });

    it('rejects stale child AgentExecution runtime terminal fields', () => {
        expect(() => MissionDataSchema.parse({
            ...missionData,
            agentExecutions: [{
                ...agentExecution,
                terminalName: 'mission-agent-execution'
            }]
        })).toThrow();
    });

    it('rejects command descriptors embedded in Entity data', () => {
        expect(() => MissionDataSchema.parse({
            ...missionData,
            commands: [{ commandId: MissionCommandIds.pause, label: 'Pause Mission', disabled: false }]
        })).toThrow();

        expect(() => MissionDataSchema.parse({
            ...missionData,
            stages: [{
                ...stage,
                commands: [{ commandId: 'stage.generateTasks', label: 'Generate Tasks', disabled: false }]
            }]
        })).toThrow();

        expect(() => MissionDataSchema.parse({
            ...missionData,
            stages: [{
                ...stage,
                tasks: [{
                    ...task,
                    commands: [{ commandId: TaskCommandIds.start, label: 'Start Task', disabled: false }]
                }]
            }]
        })).toThrow();
    });

    it('keeps Mission read as an aggregate snapshot contract', () => {
        const snapshot = MissionSnapshotSchema.parse({
            mission: missionData,
            commandView: {
                revision: 'commands-1',
                commands: [{
                    owner: { entity: 'Mission' },
                    command: { commandId: MissionCommandIds.pause, label: 'Pause Mission', disabled: false }
                }]
            },
            stages: [stage],
            tasks: [task],
            artifacts: [artifact],
            agentExecutions: [agentExecution]
        });

        expect(MissionContract.methods?.['read']?.result).toBe(MissionSnapshotSchema);
        expect(snapshot.commandView?.commands[0]?.command.commandId).toBe(MissionCommandIds.pause);
        expect(snapshot.mission.missionId).toBe('mission-1');
    });

    it('excludes terminal snapshot channels from runtime event subscriptions', () => {
        expect(createMissionRuntimeEventSubscriptionChannels('mission-1')).not.toContain('mission:mission-1.terminal');
        expect(createMissionRuntimeEventSubscriptionChannels('mission-1')).not.toContain('agent_execution:mission-1/*.terminal');
        expect(createMissionRuntimeEventSubscriptionChannels('mission-1')).toContain('agent_execution:mission-1/*.data.changed');
        expect(createAllRuntimeEventSubscriptionChannels()).not.toContain('mission:*.terminal');
        expect(createAllRuntimeEventSubscriptionChannels()).not.toContain('agent_execution:*.terminal');
    });
});
