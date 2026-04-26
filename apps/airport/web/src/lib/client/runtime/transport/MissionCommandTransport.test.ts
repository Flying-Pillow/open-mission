import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { ChildEntityCommandTransport } from './ChildEntityCommandTransport';
import { MissionCommandTransport } from './MissionCommandTransport';

describe('MissionCommandTransport', () => {
    it('exposes Mission methods only, not child entity command methods', () => {
        const transport = new MissionCommandTransport();

        expect('pauseMission' in transport).toBe(true);
        expect('listTaskCommands' in transport).toBe(false);
        expect('executeTaskCommand' in transport).toBe(false);
        expect('readArtifactDocument' in transport).toBe(false);
        expect('sendAgentSessionPrompt' in transport).toBe(false);
    });
});

describe('ChildEntityCommandTransport', () => {
    it('routes child entity command discovery and execution through child entity remotes', async () => {
        const queryCalls: unknown[] = [];
        const commandCalls: unknown[] = [];
        const transport = new ChildEntityCommandTransport({
            repositoryRootPath: '/repo/root',
            queryRemote: async (input) => {
                const payload = input.payload as Record<string, unknown>;
                queryCalls.push(input);
                return {
                    entity: input.entity,
                    entityId: typeof payload.taskId === 'string'
                        ? payload.taskId
                        : 'entity-1',
                    missionId: 'mission-29',
                    ...(typeof payload.taskId === 'string' ? { taskId: payload.taskId } : {}),
                    commands: [
                        {
                            commandId: 'task.start',
                            label: 'Start Task',
                            disabled: false
                        }
                    ]
                };
            },
            commandRemote: async (input) => {
                const payload = input.payload as Record<string, unknown>;
                commandCalls.push(input);
                return {
                    ok: true,
                    entity: input.entity,
                    method: input.method,
                    id: typeof payload.taskId === 'string'
                        ? payload.taskId
                        : 'entity-1',
                    missionId: 'mission-29',
                    ...(typeof payload.taskId === 'string' ? { taskId: payload.taskId } : {}),
                    ...(typeof payload.commandId === 'string' ? { commandId: payload.commandId } : {})
                };
            }
        });

        await expect(transport.listTaskCommands({
            missionId: 'mission-29',
            taskId: 'task-1'
        })).resolves.toMatchObject({
            entity: 'Task',
            taskId: 'task-1',
            commands: [{ commandId: 'task.start' }]
        });
        await expect(transport.executeTaskCommand({
            missionId: 'mission-29',
            taskId: 'task-1',
            commandId: 'task.start',
            input: { terminalSessionName: 'airport' }
        })).resolves.toMatchObject({
            entity: 'Task',
            method: 'executeCommand',
            taskId: 'task-1',
            commandId: 'task.start'
        });

        expect(queryCalls).toEqual([
            {
                entity: 'Task',
                method: 'listCommands',
                payload: {
                    missionId: 'mission-29',
                    repositoryRootPath: '/repo/root',
                    taskId: 'task-1'
                }
            }
        ]);
        expect(commandCalls).toEqual([
            {
                entity: 'Task',
                method: 'executeCommand',
                payload: {
                    missionId: 'mission-29',
                    repositoryRootPath: '/repo/root',
                    taskId: 'task-1',
                    commandId: 'task.start',
                    input: { terminalSessionName: 'airport' }
                }
            }
        ]);
    });

    it('routes artifact documents and agent session IO through child entity remotes', async () => {
        const calls: unknown[] = [];
        const transport = new ChildEntityCommandTransport({
            repositoryRootPath: '/repo/root',
            queryRemote: async (input) => {
                calls.push(input);
                return {
                    filePath: '/repo/root/.mission/VERIFY.md',
                    content: 'Verified',
                    updatedAt: '2026-04-26T14:30:00.000Z'
                };
            },
            commandRemote: async (input) => {
                calls.push(input);

                if (input.entity === 'Artifact') {
                    return {
                        filePath: '/repo/root/.mission/VERIFY.md',
                        content: 'Updated',
                        updatedAt: '2026-04-26T14:30:00.000Z'
                    };
                }

                return {
                    ok: true,
                    entity: 'AgentSession',
                    method: input.method,
                    id: 'session-1',
                    missionId: 'mission-29',
                    sessionId: 'session-1'
                };
            }
        });

        await expect(transport.readArtifactDocument({
            missionId: 'mission-29',
            artifactId: '03-IMPLEMENTATION/VERIFY.md'
        })).resolves.toMatchObject({ content: 'Verified' });
        await expect(transport.writeArtifactDocument({
            missionId: 'mission-29',
            artifactId: '03-IMPLEMENTATION/VERIFY.md',
            content: 'Updated'
        })).resolves.toMatchObject({ content: 'Updated' });
        await expect(transport.sendAgentSessionPrompt({
            missionId: 'mission-29',
            sessionId: 'session-1',
            prompt: { source: 'operator', text: 'continue' }
        })).resolves.toMatchObject({ entity: 'AgentSession', method: 'sendPrompt' });

        expect(calls).toEqual([
            {
                entity: 'Artifact',
                method: 'readDocument',
                payload: {
                    missionId: 'mission-29',
                    repositoryRootPath: '/repo/root',
                    artifactId: '03-IMPLEMENTATION/VERIFY.md'
                }
            },
            {
                entity: 'Artifact',
                method: 'writeDocument',
                payload: {
                    missionId: 'mission-29',
                    repositoryRootPath: '/repo/root',
                    artifactId: '03-IMPLEMENTATION/VERIFY.md',
                    content: 'Updated'
                }
            },
            {
                entity: 'AgentSession',
                method: 'sendPrompt',
                payload: {
                    missionId: 'mission-29',
                    repositoryRootPath: '/repo/root',
                    sessionId: 'session-1',
                    prompt: { source: 'operator', text: 'continue' }
                }
            }
        ]);
    });
});

describe('MissionCommandTransport remote routes', () => {

    it('routes Mission projection, actions, documents, and worktree through query remotes', async () => {
        const calls: unknown[] = [];
        const transport = new MissionCommandTransport({
            repositoryRootPath: '/repo/root',
            queryRemote: async (input) => {
                calls.push(input);
                switch (input.method) {
                    case 'readProjection':
                        return {
                            missionId: 'mission-29',
                            status: {
                                missionId: 'mission-29',
                                title: 'Mission 29'
                            },
                            updatedAt: '2026-04-26T14:30:00.000Z'
                        };
                    case 'listActions':
                        return {
                            missionId: 'mission-29',
                            actions: [
                                {
                                    actionId: 'pause',
                                    label: 'Pause Mission',
                                    kind: 'mission',
                                    disabled: false
                                }
                            ]
                        };
                    case 'readDocument':
                        return {
                            filePath: '/repo/root/README.md',
                            content: 'Mission document',
                            updatedAt: '2026-04-26T14:30:00.000Z'
                        };
                    case 'readWorktree':
                        return {
                            rootPath: '/repo/root/.mission/worktrees/mission-29',
                            fetchedAt: '2026-04-26T14:30:00.000Z',
                            tree: []
                        };
                    default:
                        throw new Error(`Unexpected query ${input.method}.`);
                }
            }
        });

        await expect(transport.getMissionProjection({ missionId: 'mission-29' })).resolves.toMatchObject({
            missionId: 'mission-29',
            status: {
                missionId: 'mission-29',
                title: 'Mission 29'
            }
        });
        await expect(transport.getMissionActions({ missionId: 'mission-29' })).resolves.toMatchObject({
            missionId: 'mission-29',
            actions: [
                {
                    actionId: 'pause',
                    label: 'Pause Mission'
                }
            ]
        });
        await expect(transport.readMissionDocument({
            missionId: 'mission-29',
            path: '/repo/root/README.md'
        })).resolves.toMatchObject({ filePath: '/repo/root/README.md' });
        await expect(transport.getMissionWorktree({ missionId: 'mission-29' })).resolves.toMatchObject({
            rootPath: '/repo/root/.mission/worktrees/mission-29'
        });

        expect(calls).toEqual([
            {
                entity: 'Mission',
                method: 'readProjection',
                payload: { missionId: 'mission-29', repositoryRootPath: '/repo/root' }
            },
            {
                entity: 'Mission',
                method: 'listActions',
                payload: { missionId: 'mission-29', repositoryRootPath: '/repo/root' }
            },
            {
                entity: 'Mission',
                method: 'readDocument',
                payload: {
                    missionId: 'mission-29',
                    repositoryRootPath: '/repo/root',
                    path: '/repo/root/README.md'
                }
            },
            {
                entity: 'Mission',
                method: 'readWorktree',
                payload: { missionId: 'mission-29', repositoryRootPath: '/repo/root' }
            }
        ]);
    });

    it('routes Mission document writes through the command remote', async () => {
        const transport = new MissionCommandTransport({
            repositoryRootPath: '/repo/root',
            commandRemote: async (input) => {
                expect(input).toEqual({
                    entity: 'Mission',
                    method: 'writeDocument',
                    payload: {
                        missionId: 'mission-29',
                        repositoryRootPath: '/repo/root',
                        path: '/repo/root/README.md',
                        content: 'Updated'
                    }
                });

                return {
                    filePath: '/repo/root/README.md',
                    content: 'Updated',
                    updatedAt: '2026-04-26T14:30:00.000Z'
                };
            }
        });

        await expect(transport.writeMissionDocument({
            missionId: 'mission-29',
            path: '/repo/root/README.md',
            content: 'Updated'
        })).resolves.toMatchObject({
            filePath: '/repo/root/README.md',
            content: 'Updated'
        });
    });

    it('throws a zod error when mission projection returns a malformed canonical result', async () => {
        const transport = new MissionCommandTransport({
            queryRemote: async () => ({
                missionId: 'mission-29',
                status: {
                    missionId: ''
                }
            })
        });

        let thrown: unknown;
        try {
            await transport.getMissionProjection({ missionId: 'mission-29' });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(ZodError);
    });
});
