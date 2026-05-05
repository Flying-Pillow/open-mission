import { describe, expect, it } from 'vitest';
import { Mission } from './Mission.svelte.js';
import type { EntityCommandInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/entities/Entity/EntityRemote';
import { AgentSessionCommandIds, type AgentSessionCommandAcknowledgementType, type AgentSessionDataType } from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import { ArtifactCommandIds, type ArtifactDataType } from '@flying-pillow/mission-core/entities/Artifact/ArtifactSchema';
import { MissionCommandIds, type MissionCommandAcknowledgementType, type MissionSnapshotType } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { StageDataType, StageCommandAcknowledgementType } from '@flying-pillow/mission-core/entities/Stage/StageSchema';
import { TaskCommandIds, type TaskDataType, type TaskCommandAcknowledgementType } from '@flying-pillow/mission-core/entities/Task/TaskSchema';
import type { MissionGatewayDependencies } from './Mission.svelte.js';

describe('Mission control view reconciliation', () => {
    it('reconciles targeted child entity snapshots without replacing unrelated mirrors', () => {
        const mission = createMission();
        mission.setRouteState({
            controlViewSnapshot: {
                missionId: 'mission-29',
                status: {
                    missionId: 'mission-29',
                    title: 'Mission 29',
                    artifacts: [createArtifactData('verify', 'VERIFY.md')],
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

        mission.applyTaskData(createTaskSnapshot('task-1', 'completed'));
        mission.applyArtifactData(createArtifactData('verify', 'Verification Evidence'));
        mission.applyAgentSessionData(createSessionSnapshot('session-1', 'completed'));

        expect(mission.getTask('task-1')?.lifecycle).toBe('completed');
        expect(mission.getTask('task-2')?.lifecycle).toBe('pending');
        expect(mission.getArtifact('artifact:mission-29/verify')?.label).toBe('Verification Evidence');
        expect(mission.getSession('session-1')?.lifecycleState).toBe('completed');
    });

    it('reconciles Stage snapshots as authoritative stage child Entity snapshots', () => {
        const mission = createMission();

        mission.applyStageData(createStageSnapshot({
            lifecycle: 'completed',
            tasks: [createTaskSnapshot('task-1', 'completed')]
        }));

        expect(mission.getStage('implementation')?.lifecycle).toBe('completed');
        expect(mission.getTask('task-1')?.lifecycle).toBe('completed');
        expect(mission.getTask('task-2')).toBeUndefined();
    });

    it('exposes Mission entity commands from the aggregate command view', () => {
        const mission = createMission(
            {
                ...createMissionSnapshot(),
                commandView: {
                    revision: 'commands-1',
                    commands: [{
                        owner: { entity: 'Mission' },
                        command: { commandId: MissionCommandIds.pause, label: 'Pause Mission', disabled: false }
                    }]
                }
            }
        );

        expect(mission.commands).toEqual([
            {
                commandId: MissionCommandIds.pause,
                label: 'Pause Mission',
                disabled: false
            }
        ]);
    });

    it('reads a selected Artifact with the reconciled id', async () => {
        const artifactBodyCalls: string[] = [];
        const mission = createMission(
            createMissionSnapshot(),
            createMissionGatewayDependencies(artifactBodyCalls)
        );
        mission.applyArtifactData({
            id: 'artifact:mission-29/mission-29:prd',
            kind: 'stage',
            label: 'Requirements',
            fileName: 'PRD.md',
            relativePath: 'PRD.md',
            stageId: 'prd'
        });
        const artifact = mission.getArtifact('artifact:mission-29/mission-29:prd');

        if (!artifact) {
            throw new Error('Expected PRD Artifact to be available.');
        }

        await artifact.refreshBody({ executionContext: 'render' });

        expect(artifactBodyCalls).toEqual(['artifact:mission-29/mission-29:prd']);
    });

    it('saves a selected Artifact body through the Artifact command surface', async () => {
        const artifactBodyCommandCalls: EntityCommandInvocation[] = [];
        const mission = createMission(
            createMissionSnapshot(),
            createMissionGatewayDependencies([], artifactBodyCommandCalls)
        );
        const artifact = mission.getArtifact('artifact:mission-29/verify');

        if (!artifact) {
            throw new Error('Expected verification Artifact to be available.');
        }

        await artifact.saveBody('# Updated verification');

        expect(artifactBodyCommandCalls).toEqual([
            {
                entity: 'Artifact',
                method: 'command',
                payload: {
                    missionId: 'mission-29',
                    id: 'artifact:mission-29/verify',
                    commandId: ArtifactCommandIds.body,
                    input: {
                        body: '# Updated verification'
                    }
                }
            }
        ]);
    });

    it('routes structured AgentSession prompts and commands through the AgentSession command surface', async () => {
        const agentSessionCommandCalls: EntityCommandInvocation[] = [];
        const mission = createMission(
            createMissionSnapshot({
                agentSessions: [createSessionSnapshot('session-1', 'awaiting-input', {
                    interactionCapabilities: {
                        mode: 'agent-message',
                        canSendTerminalInput: false,
                        canSendStructuredPrompt: true,
                        canSendStructuredCommand: true
                    },
                    runtimeMessages: [
                        { type: 'checkpoint', label: 'Checkpoint', delivery: 'best-effort', mutatesContext: false },
                        { type: 'resume', label: 'Resume', delivery: 'best-effort', mutatesContext: false }
                    ]
                })]
            }),
            createMissionGatewayDependencies([], [], agentSessionCommandCalls)
        );
        const session = mission.getSession('session-1');

        if (!session) {
            throw new Error('Expected session to be available.');
        }

        await session.sendPrompt({ source: 'operator', text: 'Continue with the next slice.' });
        await session.sendCommand({ type: 'resume', reason: 'Operator approved continuation.' });

        expect(agentSessionCommandCalls).toEqual([
            {
                entity: 'AgentSession',
                method: 'command',
                payload: {
                    missionId: 'mission-29',
                    sessionId: 'session-1',
                    commandId: AgentSessionCommandIds.sendPrompt,
                    input: {
                        source: 'operator',
                        text: 'Continue with the next slice.'
                    }
                }
            },
            {
                entity: 'AgentSession',
                method: 'command',
                payload: {
                    missionId: 'mission-29',
                    sessionId: 'session-1',
                    commandId: AgentSessionCommandIds.sendRuntimeMessage,
                    input: {
                        type: 'resume',
                        reason: 'Operator approved continuation.'
                    }
                }
            }
        ]);
    });
});

function createMission(
    snapshot: MissionSnapshotType = createMissionSnapshot(),
    gatewayDependencies: MissionGatewayDependencies = createMissionGatewayDependencies([])
): Mission {
    return new Mission({
        snapshot,
        loadData: async () => createMissionSnapshot(),
        gatewayDependencies
    });
}

function createMissionGatewayDependencies(
    artifactBodyCalls: string[],
    artifactBodyCommandCalls: EntityCommandInvocation[] = [],
    agentSessionCommandCalls: EntityCommandInvocation[] = []
): MissionGatewayDependencies {
    return {
        commandRemote: async (input) =>
            handleCommandInvocation(input, artifactBodyCommandCalls, agentSessionCommandCalls),
        queryRemote: async (input) => handleQueryInvocation(input, artifactBodyCalls)
    };
}

async function handleCommandInvocation(
    input: EntityCommandInvocation,
    artifactBodyCommandCalls: EntityCommandInvocation[],
    agentSessionCommandCalls: EntityCommandInvocation[]
): Promise<EntityRemoteResult> {
    if (input.entity === 'Stage' && input.method === 'command') {
        return createStageAcknowledgement();
    }

    if (input.entity === 'Task' && input.method === 'command') {
        return createTaskAcknowledgement();
    }

    if (input.entity === 'Artifact' && input.method === 'command') {
        const payload = input.payload as { id: string; commandId: string };
        artifactBodyCommandCalls.push(input);
        return {
            ok: true,
            entity: 'Artifact',
            method: 'command',
            id: payload.id,
            missionId: 'mission-29',
            commandId: payload.commandId
        };
    }

    if (input.entity === 'AgentSession' && input.method === 'command') {
        agentSessionCommandCalls.push(input);
        return createAgentSessionAcknowledgement('command');
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
    artifactBodyCalls: string[]
): Promise<EntityRemoteResult> {
    if (input.entity === 'Artifact' && input.method === 'body') {
        const payload = input.payload as { id: string };
        artifactBodyCalls.push(payload.id);
        return {
            body: '# PRD'
        };
    }

    if (input.entity === 'Mission' && input.method === 'readControlView') {
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

function createStageAcknowledgement(): StageCommandAcknowledgementType {
    return {
        ok: true,
        entity: 'Stage',
        method: 'command',
        id: 'stage-1',
        missionId: 'mission-29',
        stageId: 'stage-1',
        commandId: 'stage.generateTasks'
    };
}

function createTaskAcknowledgement(): TaskCommandAcknowledgementType {
    return {
        ok: true,
        entity: 'Task',
        method: 'command',
        id: 'task-1',
        missionId: 'mission-29',
        taskId: 'task-1',
        commandId: TaskCommandIds.start
    };
}

function createAgentSessionAcknowledgement(method: AgentSessionCommandAcknowledgementType['method']): AgentSessionCommandAcknowledgementType {
    return {
        ok: true,
        entity: 'AgentSession',
        method,
        id: 'session-1',
        missionId: 'mission-29',
        sessionId: 'session-1',
        commandId: AgentSessionCommandIds.cancel
    };
}

function createMissionAcknowledgement(method: MissionCommandAcknowledgementType['method']): MissionCommandAcknowledgementType {
    return {
        ok: true,
        entity: 'Mission',
        method,
        id: 'mission-29',
        missionId: 'mission-29'
    };
}

function createMissionSnapshot(overrides: Partial<MissionSnapshotType> = {}): MissionSnapshotType {
    const stages = [createStageSnapshot({
        lifecycle: 'running',
        tasks: [
            createTaskSnapshot('task-1', 'ready'),
            createTaskSnapshot('task-2', 'pending')
        ]
    })];
    return {
        mission: {
            id: 'mission:mission-29',
            missionId: 'mission-29',
            title: 'Mission 29',
            type: 'task',
            branchRef: 'mission-29',
            missionDir: '/tmp/mission-29',
            missionRootDir: '/tmp/mission-29/.mission/mission-29',
            artifacts: [createArtifactData('verify', 'VERIFY.md')],
            stages,
            agentSessions: [createSessionSnapshot('session-1', 'running')]
        },
        commandView: {
            revision: 'commands-1',
            commands: []
        },
        status: {
            missionId: 'mission-29',
            title: 'Mission 29',
            artifacts: [createArtifactData('verify', 'VERIFY.md')],
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
        artifacts: [createArtifactData('verify', 'VERIFY.md')],
        agentSessions: [createSessionSnapshot('session-1', 'running')],
        ...overrides
    };
}

function createStageSnapshot(input: {
    lifecycle: string;
    tasks: TaskDataType[];
}): StageDataType {
    return {
        id: 'stage:mission-29/implementation',
        stageId: 'implementation',
        lifecycle: input.lifecycle,
        isCurrentStage: true,
        artifacts: [createArtifactData('verify', 'VERIFY.md')],
        tasks: input.tasks
    };
}

function createTaskSnapshot(taskId: string, lifecycle: string): TaskDataType {
    return {
        id: `task:mission-29/${taskId}`,
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

function createArtifactData(id: string, label: string): ArtifactDataType {
    return {
        id: `artifact:mission-29/${id}`,
        kind: 'mission',
        label,
        fileName: 'VERIFY.md',
        relativePath: 'VERIFY.md'
    };
}

function createSessionSnapshot(
    sessionId: string,
    lifecycleState: AgentSessionDataType['lifecycleState'],
    overrides: Partial<AgentSessionDataType> = {}
): AgentSessionDataType {
    return {
        id: `agent_session:mission-29/${sessionId}`,
        sessionId,
        runnerId: 'copilot-cli',
        runnerLabel: 'Copilot CLI',
        lifecycleState,
        interactionCapabilities: {
            mode: 'pty-terminal',
            canSendTerminalInput: true,
            canSendStructuredPrompt: false,
            canSendStructuredCommand: false
        },
        context: { artifacts: [], instructions: [] },
        runtimeMessages: [],
        ...overrides
    };
}
