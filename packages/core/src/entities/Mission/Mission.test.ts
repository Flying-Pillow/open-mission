import { describe, expect, it } from 'vitest';
import {
    createAllRuntimeEventSubscriptionChannels,
    createMissionRuntimeEventSubscriptionChannels,
    MissionContract
} from './MissionContract.js';
import {
    MissionChangedEventSchema,
    MissionCommandIds,
    MissionControlSchema,
    MissionSchema,
    MissionStorageSchema
} from './MissionSchema.js';
import { AgentExecutionSchema } from '../AgentExecution/AgentExecutionSchema.js';
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

const agentExecution = AgentExecutionSchema.parse({
    id: 'agent_execution:mission-1/agent-execution-1',
    ownerId: 'mission-1',
    agentExecutionId: 'agent-execution-1',
    agentId: 'copilot-cli',
    process: {
        agentId: 'copilot-cli',
        agentExecutionId: 'agent-execution-1',
        scope: {
            kind: 'task',
            missionId: 'mission-1',
            taskId: 'implementation/01',
            stageId: 'implementation'
        },
        workingDirectory: '/mission',
        taskId: 'implementation/01',
        missionId: 'mission-1',
        stageId: 'implementation',
        status: 'running',
        attention: 'autonomous',
        progress: {
            state: 'working',
            updatedAt: '2026-05-02T00:00:00.000Z'
        },
        waitingForInput: false,
        acceptsPrompts: true,
        acceptedCommands: ['interrupt', 'checkpoint', 'nudge'],
        interactionPosture: 'native-terminal-escape-hatch',
        interactionCapabilities: {
            mode: 'pty-terminal',
            canSendTerminalInput: true,
            canSendStructuredPrompt: false,
            canSendStructuredCommand: false
        },
        transport: {
            kind: 'terminal',
            terminalName: 'mission-agent-execution',
            terminalPaneId: 'terminal_1'
        },
        reference: {
            agentId: 'copilot-cli',
            agentExecutionId: 'agent-execution-1',
            transport: {
                kind: 'terminal',
                terminalName: 'mission-agent-execution',
                terminalPaneId: 'terminal_1'
            }
        },
        startedAt: '2026-05-02T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:00.000Z'
    },
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
    supportedMessages: []
});

const missionData = {
    id: 'mission:mission-1',
    missionId: 'mission-1',
    title: 'Mission entity strict schema',
    assignee: {
        githubLogin: 'octocat',
        githubUserId: 1,
        source: 'manual'
    },
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
        const parsed = MissionStorageSchema.parse(missionData);

        expect(parsed.artifacts[0]).toEqual(artifact);
        expect(parsed.stages[0]).toEqual(stage);
        expect(parsed.stages[0]?.tasks[0]).toEqual(task);
        expect(parsed.agentExecutions[0]).toEqual(agentExecution);
    });

    it('rejects stale child AgentExecution runtime terminal fields', () => {
        expect(() => MissionStorageSchema.parse({
            ...missionData,
            agentExecutions: [{
                ...agentExecution,
                terminalName: 'mission-agent-execution'
            }]
        })).toThrow();
    });

    it('rejects command descriptors embedded in Entity data', () => {
        expect(() => MissionStorageSchema.parse({
            ...missionData,
            commands: [{ commandId: MissionCommandIds.pause, entity: 'Mission', method: 'pause', label: 'Pause Mission', available: true }]
        })).toThrow();

        expect(() => MissionStorageSchema.parse({
            ...missionData,
            stages: [{
                ...stage,
                commands: [{ commandId: 'stage.generateTasks', entity: 'Stage', method: 'generateTasks', label: 'Generate Tasks', available: true }]
            }]
        })).toThrow();

        expect(() => MissionStorageSchema.parse({
            ...missionData,
            stages: [{
                ...stage,
                tasks: [{
                    ...task,
                    commands: [{ commandId: TaskCommandIds.start, entity: 'Task', method: 'start', label: 'Start Task', available: true }]
                }]
            }]
        })).toThrow();
    });

    it('keeps Mission read as the canonical Mission entity contract', () => {
        const data = MissionSchema.parse({
            ...missionData,
            workflow: {
                lifecycle: 'running',
                updatedAt: '2026-05-12T00:00:00.000Z',
                currentStageId: 'implementation',
                pause: {
                    paused: false
                },
                stages: [{
                    stageId: 'implementation',
                    lifecycle: 'ready',
                    taskIds: ['implementation/01'],
                    readyTaskIds: ['implementation/01'],
                    queuedTaskIds: [],
                    runningTaskIds: [],
                    completedTaskIds: []
                }],
                tasks: [{
                    taskId: 'implementation/01',
                    stageId: 'implementation',
                    title: 'Implement task',
                    instruction: 'Ship it.',
                    dependsOn: [],
                    lifecycle: 'ready',
                    waitingOnTaskIds: [],
                    runtime: {
                        autostart: false
                    },
                    retries: 0,
                    createdAt: '2026-05-12T00:00:00.000Z',
                    updatedAt: '2026-05-12T00:00:00.000Z'
                }],
                gates: [{
                    gateId: 'implement',
                    intent: 'implement',
                    state: 'passed',
                    reasons: [],
                    updatedAt: '2026-05-12T00:00:00.000Z'
                }]
            },
            commands: [{
                commandId: MissionCommandIds.pause,
                entity: 'Mission',
                method: 'pause',
                targetId: 'mission:mission-1',
                label: 'Pause Mission',
                available: true
            }],
            tasks: [task]
        });

        expect(MissionContract.methods?.['read']?.result).toBe(MissionSchema);
        expect(MissionContract.methods?.['readControl']?.result).toBe(MissionControlSchema);
        expect(MissionContract.events?.['changed']?.payload).toBe(MissionChangedEventSchema);
        expect(data.id).toBe('mission:mission-1');
        expect(data.missionId).toBe('mission-1');
        expect(data.tasks[0]?.taskId).toBe('implementation/01');
        expect(data.commands?.[0]?.commandId).toBe(MissionCommandIds.pause);
        expect(data.workflow?.currentStageId).toBe('implementation');
        expect(data.workflow?.tasks?.[0]?.taskId).toBe('implementation/01');

        const control = MissionControlSchema.parse({
            missionId: data.missionId,
            mission: data,
            updatedAt: '2026-05-12T00:00:00.000Z'
        });

        expect(control.mission.commands?.[0]?.commandId).toBe(MissionCommandIds.pause);
    });

    it('uses mission as the Mission changed event payload field', () => {
        const mission = MissionSchema.parse({
            ...missionData,
            tasks: [task]
        });

        expect(MissionChangedEventSchema.parse({
            reference: { entity: 'Mission', missionId: 'mission-1' },
            mission
        }).mission.missionId).toBe('mission-1');

        expect(() => MissionChangedEventSchema.parse({
            reference: { entity: 'Mission', missionId: 'mission-1' },
            data: mission
        })).toThrow();
    });

    it('rejects invalid commands in canonical Mission data', () => {
        expect(() => MissionSchema.parse({
            ...missionData,
            commands: [{ label: 'Pause Mission', available: true }],
            tasks: [task]
        })).toThrow();
    });

    it('excludes terminal snapshot channels from runtime event subscriptions', () => {
        expect(createMissionRuntimeEventSubscriptionChannels('mission-1')).not.toContain('mission:mission-1.terminal');
        expect(createMissionRuntimeEventSubscriptionChannels('mission-1')).not.toContain('agent_execution:mission-1/*.terminal');
        expect(createMissionRuntimeEventSubscriptionChannels('mission-1')).toContain('mission:mission-1.changed');
        expect(createMissionRuntimeEventSubscriptionChannels('mission-1')).not.toContain('mission:mission-1.data.changed');
        expect(createMissionRuntimeEventSubscriptionChannels('mission-1')).toContain('agent_execution:mission-1/*.data.changed');
        expect(createAllRuntimeEventSubscriptionChannels()).not.toContain('mission:*.terminal');
        expect(createAllRuntimeEventSubscriptionChannels()).not.toContain('agent_execution:*.terminal');
    });
});
