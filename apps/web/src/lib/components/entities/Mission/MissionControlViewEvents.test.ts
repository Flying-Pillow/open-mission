import { describe, expect, it } from 'vitest';
import { Mission } from './Mission.svelte.js';
import type { EntityCommandInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/open-mission-core/entities/Entity/EntityInvocation';
import { AgentExecutionCommandIds, type AgentExecutionCommandAcknowledgementType, type AgentExecutionDataType } from '@flying-pillow/open-mission-core/entities/AgentExecution/AgentExecutionSchema';
import { ArtifactCommandIds, type ArtifactDataType } from '@flying-pillow/open-mission-core/entities/Artifact/ArtifactSchema';
import { MissionCommandIds, type MissionCommandAcknowledgementType, type MissionType } from '@flying-pillow/open-mission-core/entities/Mission/MissionSchema';
import type { StageDataType, StageCommandAcknowledgementType } from '@flying-pillow/open-mission-core/entities/Stage/StageSchema';
import { TaskCommandIds, type TaskDataType, type TaskCommandAcknowledgementType } from '@flying-pillow/open-mission-core/entities/Task/TaskSchema';
import type { MissionGatewayDependencies } from './Mission.svelte.js';

describe('Mission control data reconciliation', () => {
    it('reconciles targeted child entity snapshots without replacing unrelated mirrors', () => {
        const mission = createMission();
        mission.setRouteState({
            controlData: {
                missionId: 'mission-29',
                mission: createMissionSnapshot({
                    artifacts: [createArtifactData('verify', 'VERIFY.md')],
                    workflow: {
                        lifecycle: 'running',
                        currentStageId: 'implementation',
                    },
                }),
                updatedAt: '2026-04-26T15:00:00.000Z'
            }
        });

        mission.applyTaskData(createTaskSnapshot('task-1', 'completed'));
        mission.applyArtifactData(createArtifactData('verify', 'Verification Evidence'));
        mission.applyAgentExecutionData(createAgentExecutionSnapshot('session-1', 'completed'));

        expect(mission.getTask('task-1')?.lifecycle).toBe('completed');
        expect(mission.getTask('task-2')?.lifecycle).toBe('pending');
        expect(mission.getArtifact('artifact:mission-29/verify')?.label).toBe('Verification Evidence');
        expect(mission.getAgentExecution('session-1')?.lifecycleState).toBe('completed');
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
        const mission = createMission();
        mission.setRouteState({
            controlData: {
                missionId: 'mission-29',
                mission: createMissionSnapshot({
                    commands: [{
                        commandId: MissionCommandIds.pause,
                        entity: 'Mission',
                        method: 'pause',
                        targetId: 'mission:mission-29',
                        label: 'Pause Mission',
                        available: true
                    }]
                })
            }
        });

        expect(mission.commands).toEqual([
            {
                commandId: MissionCommandIds.pause,
                entity: 'Mission',
                method: 'pause',
                targetId: 'mission:mission-29',
                label: 'Pause Mission',
                available: true
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

    it('routes structured AgentExecution prompts and commands through the AgentExecution command surface', async () => {
        const agentExecutionCommandCalls: EntityCommandInvocation[] = [];
        const mission = createMission(
            createMissionSnapshot({
                agentExecutions: [createAgentExecutionSnapshot('session-1', 'running', {
                    currentInputRequestId: 'observation-1',
                    interactionCapabilities: {
                        mode: 'agent-message',
                        canSendTerminalInput: false,
                        canSendStructuredPrompt: true,
                        canSendStructuredCommand: true
                    },
                    supportedMessages: [
                        { type: 'checkpoint', label: 'Checkpoint', delivery: 'best-effort', mutatesContext: false, portability: 'cross-agent' },
                        { type: 'resume', label: 'Resume', delivery: 'best-effort', mutatesContext: false, portability: 'cross-agent' }
                    ]
                })]
            }),
            createMissionGatewayDependencies([], [], agentExecutionCommandCalls)
        );
        const agentExecution = mission.getAgentExecution('session-1');

        if (!agentExecution) {
            throw new Error('Expected session to be available.');
        }

        await agentExecution.sendPrompt({ source: 'operator', text: 'Continue with the next slice.' });
        await agentExecution.sendCommand({ type: 'resume', reason: 'Operator approved continuation.' });

        expect(agentExecutionCommandCalls).toEqual([
            {
                entity: 'AgentExecution',
                method: 'command',
                payload: {
                    ownerId: 'mission-29',
                    agentExecutionId: 'session-1',
                    commandId: AgentExecutionCommandIds.sendPrompt,
                    input: {
                        source: 'operator',
                        text: 'Continue with the next slice.'
                    }
                }
            },
            {
                entity: 'AgentExecution',
                method: 'command',
                payload: {
                    ownerId: 'mission-29',
                    agentExecutionId: 'session-1',
                    commandId: AgentExecutionCommandIds.sendRuntimeMessage,
                    input: {
                        type: 'resume',
                        reason: 'Operator approved continuation.'
                    }
                }
            }
        ]);
    });

    it('resolves AgentExecution slash shorthand before dispatching a supported message command', async () => {
        const agentExecutionCommandCalls: EntityCommandInvocation[] = [];
        const mission = createMission(
            createMissionSnapshot({
                agentExecutions: [createAgentExecutionSnapshot('session-1', 'running', {
                    interactionCapabilities: {
                        mode: 'agent-message',
                        canSendTerminalInput: false,
                        canSendStructuredPrompt: true,
                        canSendStructuredCommand: true
                    },
                    supportedMessages: [
                        { type: 'checkpoint', label: 'Checkpoint', delivery: 'best-effort', mutatesContext: false, portability: 'cross-agent' }
                    ]
                })]
            }),
            createMissionGatewayDependencies([], [], agentExecutionCommandCalls)
        );
        const agentExecution = mission.getAgentExecution('session-1');

        if (!agentExecution) {
            throw new Error('Expected session to be available.');
        }

        await agentExecution.sendMessageText('/checkpoint before refactor');

        expect(agentExecutionCommandCalls).toEqual([
            {
                entity: 'AgentExecution',
                method: 'command',
                payload: {
                    ownerId: 'mission-29',
                    agentExecutionId: 'session-1',
                    commandId: AgentExecutionCommandIds.sendRuntimeMessage,
                    input: {
                        type: 'checkpoint',
                        reason: 'before refactor'
                    }
                }
            }
        ]);
    });

    it('routes Mission-native read shorthand to an AgentExecution semantic operation', async () => {
        const agentExecutionCommandCalls: EntityCommandInvocation[] = [];
        const mission = createMission(
            createMissionSnapshot({
                agentExecutions: [createAgentExecutionSnapshot('session-1', 'running', {
                    interactionCapabilities: {
                        mode: 'agent-message',
                        canSendTerminalInput: false,
                        canSendStructuredPrompt: true,
                        canSendStructuredCommand: true
                    }
                })]
            }),
            createMissionGatewayDependencies([], [], agentExecutionCommandCalls)
        );
        const agentExecution = mission.getAgentExecution('session-1');

        if (!agentExecution) {
            throw new Error('Expected session to be available.');
        }

        await agentExecution.sendMessageText('/read docs/architecture/agent-interaction-structured-first-spec.md');

        expect(agentExecutionCommandCalls).toEqual([
            {
                entity: 'AgentExecution',
                method: 'invokeSemanticOperation',
                payload: {
                    ownerId: 'mission-29',
                    agentExecutionId: 'session-1',
                    name: 'read_artifact',
                    input: {
                        path: 'docs/architecture/agent-interaction-structured-first-spec.md'
                    }
                }
            }
        ]);
    });

    it('dispatches adapter-scoped supported messages with descriptor ownership fields', async () => {
        const agentExecutionCommandCalls: EntityCommandInvocation[] = [];
        const mission = createMission(
            createMissionSnapshot({
                agentExecutions: [createAgentExecutionSnapshot('session-1', 'running', {
                    interactionCapabilities: {
                        mode: 'agent-message',
                        canSendTerminalInput: false,
                        canSendStructuredPrompt: true,
                        canSendStructuredCommand: true
                    },
                    supportedMessages: [
                        {
                            type: 'compact-provider-context',
                            label: 'Compact Provider Context',
                            delivery: 'best-effort',
                            mutatesContext: false,
                            portability: 'adapter-scoped',
                            adapterId: 'descriptor-agent'
                        }
                    ]
                })]
            }),
            createMissionGatewayDependencies([], [], agentExecutionCommandCalls)
        );
        const agentExecution = mission.getAgentExecution('session-1');

        if (!agentExecution) {
            throw new Error('Expected session to be available.');
        }

        await agentExecution.sendCommand(agentExecution.createSupportedMessageCommand({
            descriptor: agentExecution.supportedMessages[0],
            reason: 'before verification'
        }));

        expect(agentExecutionCommandCalls).toEqual([
            {
                entity: 'AgentExecution',
                method: 'command',
                payload: {
                    ownerId: 'mission-29',
                    agentExecutionId: 'session-1',
                    commandId: AgentExecutionCommandIds.sendRuntimeMessage,
                    input: {
                        type: 'compact-provider-context',
                        portability: 'adapter-scoped',
                        adapterId: 'descriptor-agent',
                        reason: 'before verification'
                    }
                }
            }
        ]);
    });
});

function createMission(
    snapshot: MissionType = createMissionSnapshot(),
    gatewayDependencies: MissionGatewayDependencies = createMissionGatewayDependencies([])
): Mission {
    return new Mission({
        data: snapshot,
        loadData: async () => createMissionSnapshot(),
        gatewayDependencies
    });
}

function createMissionGatewayDependencies(
    artifactBodyCalls: string[],
    artifactBodyCommandCalls: EntityCommandInvocation[] = [],
    agentExecutionCommandCalls: EntityCommandInvocation[] = []
): MissionGatewayDependencies {
    return {
        commandRemote: async (input) =>
            handleCommandInvocation(input, artifactBodyCommandCalls, agentExecutionCommandCalls),
        queryRemote: async (input) => handleQueryInvocation(input, artifactBodyCalls)
    };
}

async function handleCommandInvocation(
    input: EntityCommandInvocation,
    artifactBodyCommandCalls: EntityCommandInvocation[],
    agentExecutionCommandCalls: EntityCommandInvocation[]
): Promise<EntityRemoteResult> {
    if (input.entity === 'Stage' && input.method === 'command') {
        return createStageAcknowledgement();
    }

    if (input.entity === 'Stage' && input.method === 'generateTasks') {
        return createStageAcknowledgement('generateTasks');
    }

    if (input.entity === 'Task' && input.method === 'command') {
        return createTaskAcknowledgement();
    }

    if (input.entity === 'Task' && input.method === 'start') {
        return createTaskAcknowledgement('start');
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

    if (input.entity === 'AgentExecution' && input.method === 'command') {
        agentExecutionCommandCalls.push(input);
        return createAgentExecutionAcknowledgement('command');
    }

    if (input.entity === 'AgentExecution' && input.method === 'invokeSemanticOperation') {
        agentExecutionCommandCalls.push(input);
        return {
            operationName: 'read_artifact',
            agentExecutionId: 'session-1',
            eventId: 'event-1',
            path: 'docs/architecture/agent-interaction-structured-first-spec.md',
            content: '# Spec',
            factType: 'artifact-read'
        };
    }

    if (input.entity === 'Mission' && input.method === 'command') {
        return createMissionAcknowledgement('pause');
    }

    if (input.entity === 'Mission' && ['pause', 'resume', 'restartQueue', 'deliver'].includes(input.method)) {
        return createMissionAcknowledgement(input.method as MissionCommandAcknowledgementType['method']);
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

    if (input.entity === 'Mission' && input.method === 'readControl') {
        return {
            missionId: 'mission-29',
            mission: createMissionSnapshot()
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

    if (input.entity === 'AgentExecution' && input.method === 'resolveMessageShorthand') {
        const payload = input.payload as { text: string };
        if (payload.text.startsWith('/checkpoint')) {
            return {
                kind: 'runtime-message',
                commandId: AgentExecutionCommandIds.sendRuntimeMessage,
                input: {
                    type: 'checkpoint',
                    reason: payload.text.replace(/^\/checkpoint\s*/u, '')
                },
                descriptor: {
                    type: 'checkpoint',
                    label: 'Checkpoint',
                    delivery: 'best-effort',
                    mutatesContext: false,
                    portability: 'cross-agent'
                }
            };
        }
        if (payload.text.startsWith('/read ')) {
            return {
                kind: 'semantic-operation',
                method: 'invokeSemanticOperation',
                input: {
                    name: 'read_artifact',
                    input: {
                        path: payload.text.replace(/^\/read\s*/u, '')
                    }
                },
                descriptor: {
                    type: 'read',
                    label: 'Read Artifact',
                    delivery: 'best-effort',
                    mutatesContext: false,
                    portability: 'mission-native'
                }
            };
        }
        return {
            kind: 'prompt',
            commandId: AgentExecutionCommandIds.sendPrompt,
            input: {
                source: 'operator',
                text: payload.text
            }
        };
    }

    throw new Error(`Unexpected query invocation: ${input.entity}.${input.method}`);
}

function createStageAcknowledgement(method: StageCommandAcknowledgementType['method'] = 'command'): StageCommandAcknowledgementType {
    return {
        ok: true,
        entity: 'Stage',
        method,
        id: 'stage-1',
        missionId: 'mission-29',
        stageId: 'stage-1',
        commandId: 'stage.generateTasks'
    };
}

function createTaskAcknowledgement(method: TaskCommandAcknowledgementType['method'] = 'command'): TaskCommandAcknowledgementType {
    return {
        ok: true,
        entity: 'Task',
        method,
        id: 'task-1',
        missionId: 'mission-29',
        taskId: 'task-1',
        commandId: TaskCommandIds.start
    };
}

function createAgentExecutionAcknowledgement(method: AgentExecutionCommandAcknowledgementType['method']): AgentExecutionCommandAcknowledgementType {
    return {
        ok: true,
        entity: 'AgentExecution',
        method,
        id: 'session-1',
        ownerId: 'mission-29',
        agentExecutionId: 'session-1',
        commandId: AgentExecutionCommandIds.cancel
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

function createMissionSnapshot(overrides: Partial<MissionType> = {}): MissionType {
    const stages = [createStageSnapshot({
        lifecycle: 'running',
        tasks: [
            createTaskSnapshot('task-1', 'ready'),
            createTaskSnapshot('task-2', 'pending')
        ]
    })];
    return {
        id: 'mission:mission-29',
        missionId: 'mission-29',
        title: 'Mission 29',
        type: 'task',
        branchRef: 'mission-29',
        missionDir: '/tmp/mission-29',
        missionRootDir: '/tmp/mission-29/.mission/mission-29',
        lifecycle: 'running',
        currentStageId: 'implementation',
        stages,
        tasks: stages.flatMap((stage) => stage.tasks),
        artifacts: [createArtifactData('verify', 'VERIFY.md')],
        agentExecutions: [createAgentExecutionSnapshot('session-1', 'running')],
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
        agentAdapter: 'copilot-cli',
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

function createAgentExecutionSnapshot(
    agentExecutionId: string,
    lifecycleState: AgentExecutionDataType['lifecycleState'],
    overrides: Partial<AgentExecutionDataType> = {}
): AgentExecutionDataType {
    return {
        id: `agent_execution:mission-29/${agentExecutionId}`,
        ownerId: 'mission-29',
        agentExecutionId,
        agentId: 'copilot-cli',
        adapterLabel: 'Copilot CLI',
        lifecycleState,
        interactionCapabilities: {
            mode: 'pty-terminal',
            canSendTerminalInput: true,
            canSendStructuredPrompt: false,
            canSendStructuredCommand: false
        },
        context: { artifacts: [], instructions: [] },
        projection: { timelineItems: [] },
        supportedMessages: [],
        ...overrides
    };
}
