import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { Repository } from './Repository.js';
import { createDefaultRepositorySettings } from './RepositorySchema.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';
import type { EntityExecutionContext } from '../Entity/Entity.js';

describe('Repository', () => {
    it('opens a local repository with default configuration', () => {
        const repository = Repository.open('/tmp/mission-proof-of-concept');

        expect(repository.id).toMatch(/^repository:local\/mission-proof-of-concept\/[a-f0-9]{8}$/u);
        expect(repository.toStorage().id).toBe(repository.id);
        expect(repository.ownerId).toBe('local');
        expect(repository.repoName).toBe('mission-proof-of-concept');
        expect(repository.isInitialized).toBe(false);
        expect(repository.workflowConfiguration).toEqual(createDefaultWorkflowSettings());
    });

    it('opens a GitHub repository and updates only its own configuration', () => {
        const repository = Repository.create({
            repositoryRootPath: '/workspaces/mission',
            platformRepositoryRef: 'Flying-Pillow/mission'
        });

        const settings = createDefaultRepositorySettings();
        settings.instructionsPath = '.copilot';

        repository.updateSettings(settings).markInitialized();

        expect(repository.ownerId).toBe('Flying-Pillow');
        expect(repository.repoName).toBe('mission');
        expect(repository.id).toBe('repository:github/Flying-Pillow/mission');
        expect(repository.platformRepositoryRef).toBe('Flying-Pillow/mission');
        expect(repository.settings.instructionsPath).toBe('.copilot');
        expect(repository.isInitialized).toBe(true);
    });

    it('rejects extra fields in daemon-callable static payloads', async () => {
        await expect(Repository.find({ unexpected: true } as never)).rejects.toThrow();
    });

    it('rejects mismatched daemon-callable instance payloads', async () => {
        const repository = Repository.open('/tmp/mission-proof-of-concept');

        await expect(repository.read({
            id: 'repository:other',
            repositoryRootPath: repository.repositoryRootPath
        })).rejects.toThrow(/does not match/u);
    });

    it('rejects cloning a platform repository that is already checked out', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-already-cloned-'));
        const repositoryRootPath = path.join(tempRoot, 'already-cloned');
        git(tempRoot, ['init', repositoryRootPath]);
        const repository = Repository.create({
            repositoryRootPath,
            platformRepositoryRef: 'Flying-Pillow/already-cloned'
        });
        const read = vi.fn().mockResolvedValue(repository);
        const context = {
            surfacePath: '/repositories',
            entityFactory: {
                has: () => true,
                register: () => undefined,
                read
            }
        } as unknown as EntityExecutionContext;

        try {
            await expect(Repository.add({
                platform: 'github',
                repositoryRef: 'Flying-Pillow/already-cloned',
                destinationPath: repositoryRootPath
            }, context)).rejects.toThrow(`Repository 'Flying-Pillow/already-cloned' is already checked out at '${repositoryRootPath}'.`);

            expect(read).toHaveBeenCalledWith(Repository, 'repository:github/Flying-Pillow/already-cloned');
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('allows cloning when a persisted Repository record points at a missing root', async () => {
        const repository = Repository.create({
            repositoryRootPath: '/repositories/Flying-Pillow/missing-repository',
            platformRepositoryRef: 'Flying-Pillow/missing-repository'
        });
        const read = vi.fn().mockResolvedValue(repository);
        const remove = vi.fn().mockResolvedValue(undefined);
        const context = {
            surfacePath: '/repositories',
            entityFactory: {
                has: () => true,
                register: () => undefined,
                read,
                remove
            }
        } as unknown as EntityExecutionContext;

        const view = await Repository.classCommands({
            commandInput: {
                platform: 'github',
                repositoryRef: 'Flying-Pillow/missing-repository',
                destinationPath: '/repositories/Flying-Pillow/missing-repository'
            }
        }, context);

        expect(view.commands).toEqual([
            expect.objectContaining({
                commandId: 'repository.add',
                disabled: false
            })
        ]);
        expect(remove).toHaveBeenCalledWith(Repository, repository.id);
    });

    it('hydrates class command descriptors from contract metadata and availability rules', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-class-commands-'));
        const repositoryRootPath = path.join(tempRoot, 'already-cloned');
        git(tempRoot, ['init', repositoryRootPath]);
        const repository = Repository.create({
            repositoryRootPath,
            platformRepositoryRef: 'Flying-Pillow/already-cloned'
        });
        const context = {
            surfacePath: '/repositories',
            entityFactory: {
                has: () => true,
                register: () => undefined,
                read: async () => repository
            }
        } as unknown as EntityExecutionContext;

        try {
            const view = await Repository.classCommands({
                commandInput: {
                    platform: 'github',
                    repositoryRef: 'Flying-Pillow/already-cloned',
                    destinationPath: repositoryRootPath
                }
            }, context);

            expect(view.entity).toBe('Repository');
            expect(view.commands).toEqual([
                expect.objectContaining({
                    commandId: 'repository.add',
                    label: 'Clone Repository',
                    disabled: true,
                    disabledReason: `Repository 'Flying-Pillow/already-cloned' is already checked out at '${repositoryRootPath}'.`
                })
            ]);
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('resolves identity from extended method payloads', async () => {
        const repository = Repository.open('/tmp/mission-proof-of-concept');
        const context = {
            entityFactory: {
                has: () => true,
                register: () => undefined,
                read: async () => repository
            }
        } as unknown as EntityExecutionContext;

        await expect(Repository.resolve({
            id: repository.id,
            repositoryRootPath: repository.repositoryRootPath,
            issueNumber: 29
        }, context)).resolves.toBe(repository);
    });

    it('hydrates instance command descriptors from contract metadata and availability rules', async () => {
        const repository = Repository.create({
            repositoryRootPath: '/tmp/mission-proof-of-concept',
            platformRepositoryRef: 'Flying-Pillow/mission'
        });

        const view = await repository.commands({
            id: repository.id,
            repositoryRootPath: repository.repositoryRootPath
        });

        expect(view.commands.map((command) => command.commandId)).toEqual([
            'repository.prepare',
            'repository.fetchExternalState',
            'repository.fastForwardFromExternal',
            'repository.remove'
        ]);
        expect(view.commands.find((command) => command.commandId === 'repository.prepare')).toMatchObject({
            disabled: false
        });
        expect(view.commands.find((command) => command.commandId === 'repository.remove')).toMatchObject({
            disabled: false,
            confirmation: {
                required: true,
                prompt: 'Remove this Repository from Mission and delete its Repository root from disk? This cannot be undone.'
            }
        });
        expect(view.commands.find((command) => command.commandId === 'repository.fetchExternalState')).toMatchObject({
            disabled: true,
            disabledReason: 'Repository root does not exist.'
        });
    });

    it('reports Repository sync status and fast-forwards safely from external state', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-sync-'));
        const remotePath = path.join(tempRoot, 'remote.git');
        const seedPath = path.join(tempRoot, 'seed');
        const localPath = path.join(tempRoot, 'local');

        try {
            git(tempRoot, ['init', '--bare', remotePath]);
            git(tempRoot, ['init', seedPath]);
            git(seedPath, ['config', 'user.email', 'mission@example.test']);
            git(seedPath, ['config', 'user.name', 'Mission Test']);
            await fsp.writeFile(path.join(seedPath, 'README.md'), 'initial\n', 'utf8');
            git(seedPath, ['add', 'README.md']);
            git(seedPath, ['commit', '-m', 'initial']);
            git(seedPath, ['branch', '-M', 'main']);
            git(seedPath, ['remote', 'add', 'origin', remotePath]);
            git(seedPath, ['push', '-u', 'origin', 'main']);
            git(tempRoot, ['--git-dir', remotePath, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
            git(tempRoot, ['clone', remotePath, localPath]);
            git(localPath, ['checkout', 'main']);

            const repository = Repository.create({
                repositoryRootPath: localPath,
                platformRepositoryRef: 'Flying-Pillow/sync-test'
            });

            await fsp.writeFile(path.join(seedPath, 'README.md'), 'initial\nremote\n', 'utf8');
            git(seedPath, ['add', 'README.md']);
            git(seedPath, ['commit', '-m', 'remote update']);
            git(seedPath, ['push', 'origin', 'main']);

            await expect(repository.syncStatus({
                id: repository.id,
                repositoryRootPath: repository.repositoryRootPath
            })).resolves.toMatchObject({
                branchRef: 'main',
                worktree: { clean: true },
                external: { status: 'behind', aheadCount: 0, behindCount: 1 }
            });

            await expect(repository.fetchExternalState({
                id: repository.id,
                repositoryRootPath: repository.repositoryRootPath
            })).resolves.toMatchObject({
                ok: true,
                method: 'fetchExternalState',
                syncStatus: {
                    external: { status: 'behind', aheadCount: 0, behindCount: 1 }
                }
            });

            await expect(repository.fastForwardFromExternal({
                id: repository.id,
                repositoryRootPath: repository.repositoryRootPath
            })).resolves.toMatchObject({
                ok: true,
                method: 'fastForwardFromExternal',
                syncStatus: {
                    external: { status: 'up-to-date', aheadCount: 0, behindCount: 0 }
                }
            });
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('removes Repository storage and deletes its Repository root from disk', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-remove-'));
        const repositoryRootPath = path.join(tempRoot, 'repository');
        await fsp.mkdir(path.join(repositoryRootPath, '.git'), { recursive: true });
        const repository = Repository.open(repositoryRootPath);
        const remove = vi.fn().mockResolvedValue(undefined);
        const context = {
            entityFactory: {
                has: () => true,
                register: () => undefined,
                remove
            }
        } as unknown as EntityExecutionContext;

        try {
            await expect(repository.remove({
                id: repository.id,
                repositoryRootPath
            }, context)).resolves.toMatchObject({
                ok: true,
                entity: 'Repository',
                method: 'remove',
                id: repository.id
            });

            await expect(fsp.lstat(repositoryRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(remove).toHaveBeenCalledWith(Repository, repository.id);
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('refuses to remove a path that is not a Git Repository root', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-remove-'));
        const repositoryRootPath = path.join(tempRoot, 'not-a-repository');
        await fsp.mkdir(repositoryRootPath, { recursive: true });
        const repository = Repository.open(repositoryRootPath);
        const remove = vi.fn().mockResolvedValue(undefined);
        const context = {
            entityFactory: {
                has: () => true,
                register: () => undefined,
                remove
            }
        } as unknown as EntityExecutionContext;

        try {
            await expect(repository.remove({
                id: repository.id,
                repositoryRootPath
            }, context)).rejects.toThrow(`Repository root '${repositoryRootPath}' must contain a .git entry before it can be removed.`);

            await expect(fsp.lstat(repositoryRootPath)).resolves.toBeDefined();
            expect(remove).not.toHaveBeenCalled();
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('marks prepare unavailable after Repository control state is initialized', async () => {
        const repository = Repository.create({
            repositoryRootPath: '/tmp/mission-proof-of-concept',
            platformRepositoryRef: 'Flying-Pillow/mission',
            isInitialized: true
        });

        const view = await repository.commands({
            id: repository.id,
            repositoryRootPath: repository.repositoryRootPath
        });

        expect(view.commands.find((command) => command.commandId === 'repository.prepare')).toMatchObject({
            disabled: true,
            disabledReason: 'Repository control state is already initialized.'
        });
    });
});

function git(cwd: string, args: string[]): string {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'Mission Test',
            GIT_AUTHOR_EMAIL: 'mission@example.test',
            GIT_COMMITTER_NAME: 'Mission Test',
            GIT_COMMITTER_EMAIL: 'mission@example.test'
        }
    });
    if (result.status !== 0) {
        throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n'));
    }
    return result.stdout.trim();
}