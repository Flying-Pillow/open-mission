import { describe, expect, it } from 'vitest';
import { Mission } from './Mission.svelte.js';
import type {
    MissionAgentSessionSnapshot,
    MissionArtifactSnapshot,
    MissionActionListSnapshot,
    MissionSnapshot,
    MissionStageSnapshot,
    MissionTaskSnapshot
} from '@flying-pillow/mission-core/schemas';
import type { MissionCommandGateway } from './Mission.svelte.js';

describe('Mission projection reconciliation', () => {
    it('reconciles targeted child entity snapshots without replacing unrelated mirrors', () => {
        const mission = new Mission(createMissionSnapshot(), async () => createMissionSnapshot());
        mission.setRouteState({
            projectionSnapshot: {
                missionId: 'mission-29',
                status: {
                    missionId: 'mission-29',
                    title: 'Mission 29',
                    artifacts: [createArtifactSnapshot('verify', 'VERIFY.md')],
                    workflow: {
                        lifecycle: 'running',
                        currentStageId: 'implementation',
                        stages: [createStageSnapshot({
                            lifecycle: 'running',
                            tasks: [
                                createTaskSnapshot('task-1', 'ready'),
                                createTaskSnapshot('task-2', 'pending')
                            ]
                        })]
                    }
                },
                workflow: {
                    lifecycle: 'running',
                    currentStageId: 'implementation',
                    stages: [createStageSnapshot({
                        lifecycle: 'running',
                        tasks: [
                            createTaskSnapshot('task-1', 'ready'),
                            createTaskSnapshot('task-2', 'pending')
                        ]
                    })]
                },
                updatedAt: '2026-04-26T15:00:00.000Z'
            }
        });

        mission.applyTaskSnapshot(createTaskSnapshot('task-1', 'completed'));
        mission.applyArtifactSnapshot(createArtifactSnapshot('verify', 'Verification Evidence'));
        mission.applyAgentSessionSnapshot(createSessionSnapshot('session-1', 'completed'));

        expect(mission.getTask('task-1')?.lifecycle).toBe('completed');
        expect(mission.getTask('task-2')?.lifecycle).toBe('pending');
        expect(mission.getArtifact('VERIFY.md')?.label).toBe('Verification Evidence');
        expect(mission.getSession('session-1')?.lifecycleState).toBe('completed');
    });

    it('reconciles Stage snapshots as authoritative stage child projections', () => {
        const mission = new Mission(createMissionSnapshot(), async () => createMissionSnapshot());

        mission.applyStageSnapshot(createStageSnapshot({
            lifecycle: 'completed',
            tasks: [createTaskSnapshot('task-1', 'completed')]
        }));

        expect(mission.getStage('implementation')?.lifecycle).toBe('completed');
        expect(mission.getTask('task-1')?.lifecycle).toBe('completed');
        expect(mission.getTask('task-2')).toBeUndefined();
    });

    it('exposes only Mission-scoped actions as Mission entity commands', async () => {
        const mission = new Mission(
            createMissionSnapshot(),
            async () => createMissionSnapshot(),
            createMissionCommandGateway({
                missionId: 'mission-29',
                actions: [
                    {
                        actionId: 'mission.pause',
                        label: 'Pause Mission',
                        kind: 'mission',
                        target: { scope: 'mission' },
                        disabled: false
                    },
                    {
                        actionId: 'task.start.task-1',
                        label: 'Start Task',
                        kind: 'task',
                        target: { scope: 'task', targetId: 'task-1' },
                        disabled: false
                    },
                    {
                        actionId: 'session.cancel.session-1',
                        label: 'Cancel Session',
                        kind: 'session',
                        target: { scope: 'session', targetId: 'session-1' },
                        disabled: false
                    }
                ]
            })
        );

        await expect(mission.listCommands()).resolves.toEqual([
            {
                commandId: 'mission.pause',
                label: 'Pause Mission',
                disabled: false
            }
        ]);
    });
});

function createMissionCommandGateway(actions: MissionActionListSnapshot): MissionCommandGateway {
    return {
        pauseMission: async () => createMissionAcknowledgement('pause'),
        resumeMission: async () => createMissionAcknowledgement('resume'),
        panicStopMission: async () => createMissionAcknowledgement('panic'),
        clearMissionPanic: async () => createMissionAcknowledgement('clearPanic'),
        restartLaunchQueue: async () => createMissionAcknowledgement('restartQueue'),
        deliverMission: async () => createMissionAcknowledgement('deliver'),
        getMissionProjection: async () => ({
            missionId: 'mission-29'
        }),
        getMissionActions: async () => actions,
        executeMissionAction: async () => createMissionAcknowledgement('executeAction'),
        readMissionDocument: async () => ({
            filePath: '/repo/root/README.md',
            content: ''
        }),
        writeMissionDocument: async () => ({
            filePath: '/repo/root/README.md',
            content: ''
        }),
        readMissionWorktree: async () => ({
            missionId: 'mission-29',
            rootPath: '/repo/root',
            nodes: []
        })
    };
}

function createMissionAcknowledgement(method: string) {
    return {
        ok: true as const,
        entity: 'Mission' as const,
        method,
        id: 'mission-29',
        missionId: 'mission-29'
    };
}

function createMissionSnapshot(): MissionSnapshot {
    const stages = [createStageSnapshot({
        lifecycle: 'running',
        tasks: [
            createTaskSnapshot('task-1', 'ready'),
            createTaskSnapshot('task-2', 'pending')
        ]
    })];
    return {
        mission: {
            missionId: 'mission-29',
            title: 'Mission 29',
            artifacts: [createArtifactSnapshot('verify', 'VERIFY.md')],
            stages,
            agentSessions: [createSessionSnapshot('session-1', 'running')]
        },
        status: {
            missionId: 'mission-29',
            title: 'Mission 29',
            artifacts: [createArtifactSnapshot('verify', 'VERIFY.md')],
            workflow: {
                lifecycle: 'running',
                currentStageId: 'implementation',
                stages
            }
        },
        workflow: {
            lifecycle: 'running',
            currentStageId: 'implementation',
            stages
        },
        stages,
        tasks: stages.flatMap((stage) => stage.tasks),
        artifacts: [createArtifactSnapshot('verify', 'VERIFY.md')],
        agentSessions: [createSessionSnapshot('session-1', 'running')]
    };
}

function createStageSnapshot(input: {
    lifecycle: string;
    tasks: MissionTaskSnapshot[];
}): MissionStageSnapshot {
    return {
        stageId: 'implementation',
        lifecycle: input.lifecycle,
        isCurrentStage: true,
        artifacts: [createArtifactSnapshot('verify', 'VERIFY.md')],
        tasks: input.tasks
    };
}

function createTaskSnapshot(taskId: string, lifecycle: string): MissionTaskSnapshot {
    return {
        taskId,
        stageId: 'implementation',
        sequence: taskId === 'task-1' ? 1 : 2,
        title: taskId === 'task-1' ? 'Task One' : 'Task Two',
        instruction: 'Do the work.',
        lifecycle,
        dependsOn: [],
        waitingOnTaskIds: [],
        agentRunner: 'copilot-cli',
        retries: 0
    };
}

function createArtifactSnapshot(artifactId: string, label: string): MissionArtifactSnapshot {
    return {
        artifactId,
        kind: 'mission',
        label,
        fileName: 'VERIFY.md',
        relativePath: 'VERIFY.md'
    };
}

function createSessionSnapshot(
    sessionId: string,
    lifecycleState: MissionAgentSessionSnapshot['lifecycleState']
): MissionAgentSessionSnapshot {
    return {
        sessionId,
        runnerId: 'copilot-cli',
        runnerLabel: 'Copilot CLI',
        lifecycleState
    };
}
