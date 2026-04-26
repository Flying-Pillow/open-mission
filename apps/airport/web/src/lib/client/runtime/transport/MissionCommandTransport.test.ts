import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { MissionCommandTransport } from './MissionCommandTransport';

describe('MissionCommandTransport', () => {
    it('routes task commands through the mission entity remote and parses acknowledgements', async () => {
        const transport = new MissionCommandTransport({
            repositoryRootPath: '/repo/root',
            commandRemote: async (input) => {
                expect(input).toEqual({
                    entity: 'Mission',
                    method: 'taskCommand',
                    payload: {
                        missionId: 'mission-29',
                        repositoryRootPath: '/repo/root',
                        taskId: 'task-1',
                        command: {
                            action: 'start',
                            terminalSessionName: 'airport'
                        }
                    }
                });

                return {
                    ok: true,
                    entity: 'Mission',
                    method: 'taskCommand',
                    id: 'mission-29',
                    missionId: 'mission-29',
                    taskId: 'task-1'
                };
            }
        });

        const acknowledgement = await transport.startTask({
            missionId: 'mission-29',
            taskId: 'task-1',
            terminalSessionName: 'airport'
        });

        expect(acknowledgement).toEqual({
            ok: true,
            entity: 'Mission',
            method: 'taskCommand',
            id: 'mission-29',
            missionId: 'mission-29',
            taskId: 'task-1'
        });
    });

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
