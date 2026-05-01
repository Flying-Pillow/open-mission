import { describe, expect, it } from 'vitest';
import { Mission } from './Mission.svelte.js';
import type { EntityCommandInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/daemon/protocol/entityRemote';
import type { AgentSessionCommandAcknowledgementType as AgentSessionCommandAcknowledgement, AgentSessionDataType as MissionAgentSessionSnapshot } from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import type { ArtifactDataType as MissionArtifactSnapshot } from '@flying-pillow/mission-core/entities/Artifact/ArtifactSchema';
import type { MissionCommandAcknowledgementType as MissionCommandAcknowledgement, MissionSnapshotType as MissionSnapshot } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { StageDataType as MissionStageSnapshot, StageCommandAcknowledgementType as StageCommandAcknowledgement } from '@flying-pillow/mission-core/entities/Stage/StageSchema';
import type { TaskDataType as MissionTaskSnapshot, TaskCommandAcknowledgementType as TaskCommandAcknowledgement } from '@flying-pillow/mission-core/entities/Task/TaskSchema';
import type { MissionGatewayDependencies } from './Mission.svelte.js';

describe('Mission projection reconciliation', () => {
    it('reconciles targeted child entity snapshots without replacing unrelated mirrors', () => {
        const mission = createMission();
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
        const mission = createMission();

        mission.applyStageSnapshot(createStageSnapshot({
            lifecycle: 'completed',
            tasks: [createTaskSnapshot('task-1', 'completed')]
        }));

        expect(mission.getStage('implementation')?.lifecycle).toBe('completed');
        expect(mission.getTask('task-1')?.lifecycle).toBe('completed');
        expect(mission.getTask('task-2')).toBeUndefined();
    });

    it('exposes Mission entity commands from the entity snapshot', () => {
        const mission = createMission(
            {
                ...createMissionSnapshot(),
                mission: {
                    ...createMissionSnapshot().mission,
                    commands: [{ commandId: 'mission.pause', label: 'Pause Mission', disabled: false }]
                }
            }
        );

        expect(mission.commands).toEqual([
            {
                commandId: 'mission.pause',
                label: 'Pause Mission',
                disabled: false
            }
        ]);
    });

    it('reads a preselected placeholder artifact with the reconciled artifact id', async () => {
        const readArtifactDocumentCalls: string[] = [];
        const mission = createMission(
            createMissionSnapshot(),
            createMissionGatewayDependencies(readArtifactDocumentCalls)
        );
        const placeholderArtifact = mission.resolveArtifact({
            filePath: 'PRD.md',
            label: 'Requirements',
            stageId: 'prd'
        });

        mission.applyArtifactSnapshot({
            artifactId: 'mission-29:prd',
            kind: 'stage',
            label: 'Requirements',
            fileName: 'PRD.md',
            relativePath: 'PRD.md',
            stageId: 'prd'
        });

        await placeholderArtifact.read({ executionContext: 'render' });

        expect(readArtifactDocumentCalls).toEqual(['mission-29:prd']);
    });
});

function createMission(
    snapshot: MissionSnapshot = createMissionSnapshot(),
    gatewayDependencies: MissionGatewayDependencies = createMissionGatewayDependencies([])
): Mission {
    return new Mission({
        snapshot,
        loadData: async () => createMissionSnapshot(),
        gatewayDependencies
    });
}

function createMissionGatewayDependencies(readArtifactDocumentCalls: string[]): MissionGatewayDependencies {
    return {
        commandRemote: async (input) => handleCommandInvocation(input),
        queryRemote: async (input) => handleQueryInvocation(input, readArtifactDocumentCalls)
    };
}

async function handleCommandInvocation(input: EntityCommandInvocation): Promise<EntityRemoteResult> {
    if (input.entity === 'Stage' && input.method === 'executeCommand') {
        return createStageAcknowledgement();
    }

    if (input.entity === 'Task' && input.method === 'executeCommand') {
        return createTaskAcknowledgement();
    }

    if (input.entity === 'Artifact' && input.method === 'writeDocument') {
        return {
            filePath: 'PRD.md',
            content: '# PRD'
        };
    }

    if (input.entity === 'AgentSession' && input.method === 'executeCommand') {
        return createAgentSessionAcknowledgement('executeCommand');
    }

    if (input.entity === 'AgentSession' && input.method === 'sendPrompt') {
        return createAgentSessionAcknowledgement('sendPrompt');
    }

    if (input.entity === 'AgentSession' && input.method === 'sendCommand') {
        return createAgentSessionAcknowledgement('sendCommand');
    }

    if (input.entity === 'Mission' && input.method === 'command') {
        return createMissionAcknowledgement('command');
    }

    if (input.entity === 'Mission' && input.method === 'writeDocument') {
        return {
            filePath: '/repo/root/README.md',
            content: ''
        };
    }

    throw new Error(`Unexpected command invocation: ${input.entity}.${input.method}`);
}

async function handleQueryInvocation(
    input: EntityQueryInvocation,
    readArtifactDocumentCalls: string[]
): Promise<EntityRemoteResult> {
    if (input.entity === 'Artifact' && input.method === 'readDocument') {
        const payload = input.payload as { artifactId: string };
        readArtifactDocumentCalls.push(payload.artifactId);
        return {
            filePath: 'PRD.md',
            content: '# PRD'
        };
    }

    if (input.entity === 'Mission' && input.method === 'readProjection') {
        return {
            missionId: 'mission-29'
        };
    }

    if (input.entity === 'Mission' && input.method === 'readDocument') {
        return {
            filePath: '/repo/root/README.md',
            content: ''
        };
    }

    if (input.entity === 'Mission' && input.method === 'readWorktree') {
        return {
            rootPath: '/repo/root',
            fetchedAt: '2026-04-27T00:00:00.000Z',
            tree: []
        };
    }

    throw new Error(`Unexpected query invocation: ${input.entity}.${input.method}`);
}

function createStageAcknowledgement(): StageCommandAcknowledgement {
    return {
        ok: true,
        entity: 'Stage',
        method: 'executeCommand',
        id: 'stage-1',
        missionId: 'mission-29',
        stageId: 'stage-1',
        commandId: 'stage.generateTasks'
    };
}

function createTaskAcknowledgement(): TaskCommandAcknowledgement {
    return {
        ok: true,
        entity: 'Task',
        method: 'executeCommand',
        id: 'task-1',
        missionId: 'mission-29',
        taskId: 'task-1',
        commandId: 'task.start'
    };
}

function createAgentSessionAcknowledgement(method: AgentSessionCommandAcknowledgement['method']): AgentSessionCommandAcknowledgement {
    return {
        ok: true,
        entity: 'AgentSession',
        method,
        id: 'session-1',
        missionId: 'mission-29',
        sessionId: 'session-1',
        ...(method === 'executeCommand' ? { commandId: 'agentSession.cancel' } : {})
    };
}

function createMissionAcknowledgement(method: MissionCommandAcknowledgement['method']): MissionCommandAcknowledgement {
    return {
        ok: true,
        entity: 'Mission',
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
            type: 'task',
            branchRef: 'mission-29',
            missionDir: '/tmp/mission-29',
            missionRootDir: '/tmp/mission-29/.mission/mission-29',
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
