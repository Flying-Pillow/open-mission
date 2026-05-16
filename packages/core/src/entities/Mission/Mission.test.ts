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
    MissionInstanceInputSchema,
    MissionReadDocumentInputSchema,
    MissionSchema,
    MissionStorageSchema
} from './MissionSchema.js';
import { AgentExecutionSchema, type AgentExecutionType } from '../AgentExecution/AgentExecutionSchema.js';
import { ArtifactDataSchema } from '../Artifact/ArtifactSchema.js';
import { StageDataSchema } from '../Stage/StageSchema.js';
import { TaskDataSchema } from '../Task/TaskSchema.js';

function createTestAgentExecution(input: {
    id: string;
    ownerId: string;
    agentExecutionId: string;
    agentId: string;
}): AgentExecutionType {
    const updatedAt = '2026-05-14T10:00:00.000Z';
    return AgentExecutionSchema.parse({
        id: input.id,
        ownerEntity: 'Task',
        ownerId: input.ownerId,
        agentExecutionId: input.agentExecutionId,
        agentId: input.agentId,
        lifecycle: 'running',
        attention: 'autonomous',
        activity: 'executing',
        messageRegistry: {
            messages: []
        },
        transportState: {
            status: 'unavailable',
            structuredTransport: 'none'
        },
        mcpAvailability: 'unavailable',
        journal: {
            journalId: `agent_execution_journal:${input.ownerId}/${input.agentExecutionId}`,
            ownerEntity: 'Task',
            ownerId: input.ownerId,
            agentExecutionId: input.agentExecutionId,
            recordCount: 0,
            lastSequence: 0
        },
        createdAt: updatedAt,
        updatedAt
    });
}

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
    missionId: 'mission-1',
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
    missionId: 'mission-1',
    stageId: 'implementation',
    lifecycle: 'ready',
    isCurrentStage: true,
    artifacts: [],
    tasks: [task]
});

const agentExecution = createTestAgentExecution({
    id: 'agent_execution:mission-1/agent-execution-1',
    ownerId: 'mission-1',
    agentExecutionId: 'agent-execution-1',
    agentId: 'copilot-cli'
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
    missionDir: '/mission/.open-mission/missions/mission-1',
    missionRootDir: '/mission',
    lifecycle: 'running',
    currentStageId: 'implementation',
    artifacts: [artifact],
    stages: [stage],
    agentExecutions: [agentExecution]
};

const missionStorageData = {
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
    missionDir: '/mission/.open-mission/missions/mission-1',
    missionRootDir: '/mission',
    lifecycle: 'running',
    currentStageId: 'implementation'
};

describe('Mission schemas', () => {
    it('keeps Mission storage lean while MissionSchema is the canonical serializable entity shape', () => {
        const stored = MissionStorageSchema.parse(missionStorageData);
        const parsed = MissionSchema.parse({
            ...missionData,
            tasks: [task]
        });

        expect(stored.missionId).toBe('mission-1');
        expect(parsed.artifacts[0]).toEqual(artifact);
        expect(parsed.stages[0]).toEqual(stage);
        expect(parsed.stages[0]?.tasks[0]).toEqual(task);
        expect(parsed.tasks[0]).toEqual(task);
        expect(parsed.agentExecutions[0]).toEqual(agentExecution);
        expect(() => MissionStorageSchema.parse(missionData)).toThrow();
        expect(MissionContract.dataSchema).toBe(MissionSchema);
    });

    it('rejects stale child AgentExecution runtime terminal fields', () => {
        expect(() => MissionSchema.parse({
            ...missionData,
            tasks: [task],
            agentExecutions: [{
                ...agentExecution,
                terminalName: 'mission-agent-execution'
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
                id: 'mission:mission-1',
                label: 'Pause Mission',
                available: true
            }],
            tasks: [task]
        });

        expect(MissionContract.methods?.['read']?.result).toBe(MissionSchema);
        expect(MissionContract.methods?.['read']?.payload).toBe(MissionInstanceInputSchema);
    expect(MissionContract.dataSchema).toBe(MissionSchema);
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

    it('uses lean Mission instance payload schemas', () => {
        expect(MissionInstanceInputSchema.parse({})).toEqual({});
        expect(MissionReadDocumentInputSchema.parse({ path: 'BRIEF.md' })).toEqual({ path: 'BRIEF.md' });
        expect(() => MissionInstanceInputSchema.parse({ missionId: 'mission-1' })).toThrow();
        expect(() => MissionReadDocumentInputSchema.parse({ missionId: 'mission-1', path: 'BRIEF.md' })).toThrow();
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
