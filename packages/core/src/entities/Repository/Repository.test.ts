import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { Repository } from './Repository.js';
import { createDefaultRepositorySettings, RepositoryDataSchema } from './RepositorySchema.js';
import { AgentExecutionSchema, type AgentExecutionType } from '../AgentExecution/AgentExecutionSchema.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';
import { resolveRepositoriesRoot } from '../../settings/OpenMissionInstall.js';
import { writeOpenMissionConfig } from '../../settings/OpenMissionInstall.js';
import type { EntityExecutionContext } from '../Entity/Entity.js';
import { MissionDossierFilesystem } from '../Mission/MissionDossierFilesystem.js';
import { createInitialWorkflowRuntimeState, createWorkflowStateData, createWorkflowConfigurationSnapshot } from '../../workflow/engine/index.js';

type LegacyAgentExecutionAddress = { kind: string;[key: string]: unknown };

function createTestAgentExecution(input: {
    id: string;
    ownerId: string;
    agentExecutionId: string;
    agentId: string;
    scope: LegacyAgentExecutionAddress;
}): AgentExecutionType {
    const updatedAt = '2026-05-14T10:00:00.000Z';
    const progress = { state: 'working' as const, updatedAt };
    const interactionCapabilities = {
        mode: 'agent-message' as const,
        canSendTerminalInput: false,
        canSendStructuredPrompt: true,
        canSendStructuredCommand: true
    };
    return AgentExecutionSchema.parse({
        id: input.id,
        ownerId: input.ownerId,
        agentExecutionId: input.agentExecutionId,
        agentId: input.agentId,
        process: {
            agentId: input.agentId,
            agentExecutionId: input.agentExecutionId,
            scope: input.scope,
            workingDirectory: input.ownerId,
            status: 'running',
            progress,
            waitingForInput: false,
            acceptsPrompts: true,
            acceptedCommands: ['interrupt', 'checkpoint', 'nudge'],
            interactionPosture: 'structured-headless',
            interactionCapabilities,
            reference: {
                agentId: input.agentId,
                agentExecutionId: input.agentExecutionId
            },
            startedAt: updatedAt,
            updatedAt
        },
        adapterLabel: 'Test Agent',
        lifecycleState: 'running',
        interactionCapabilities,
        context: {
            artifacts: [],
            instructions: []
        },
        supportedMessages: [],
        scope: input.scope,
        progress,
        waitingForInput: false,
        acceptsPrompts: true,
        acceptedCommands: ['interrupt', 'checkpoint', 'nudge'],
        interactionPosture: 'structured-headless',
        reference: {
            agentId: input.agentId,
            agentExecutionId: input.agentExecutionId
        },
        createdAt: updatedAt,
        lastUpdatedAt: updatedAt
    });
}

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

    it('resolves the Repository root from inside a linked Mission worktree', async () => {
        const repositoryRootPath = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-root-'));
        const missionWorktreePath = path.join(repositoryRootPath, '..', 'mission-worktree');

        try {
            git(repositoryRootPath, ['init']);
            await fsp.writeFile(path.join(repositoryRootPath, 'README.md'), '# Mission Test\n', 'utf8');
            git(repositoryRootPath, ['add', 'README.md']);
            git(repositoryRootPath, ['commit', '-m', 'init']);
            git(repositoryRootPath, ['worktree', 'add', missionWorktreePath, '-b', 'mission/test-root']);

            expect(Repository.resolveRepositoryRoot(missionWorktreePath)).toBe(repositoryRootPath);
        } finally {
            git(repositoryRootPath, ['worktree', 'remove', '--force', missionWorktreePath]);
            await fsp.rm(repositoryRootPath, { recursive: true, force: true });
        }
    });

    it('classifies linked worktrees as non-repository discovery roots', async () => {
        const repositoryRootPath = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-root-'));
        const linkedWorktreePath = path.join(repositoryRootPath, '..', 'linked-worktree');

        try {
            git(repositoryRootPath, ['init']);
            await fsp.writeFile(path.join(repositoryRootPath, 'README.md'), '# Mission Test\n', 'utf8');
            git(repositoryRootPath, ['add', 'README.md']);
            git(repositoryRootPath, ['commit', '-m', 'init']);
            git(repositoryRootPath, ['worktree', 'add', linkedWorktreePath, '-b', 'linked/test']);

            const repositoryInternals = Repository as unknown as {
                isCanonicalCheckoutRoot(repositoryRootPath: string): boolean;
            };
            expect(repositoryInternals.isCanonicalCheckoutRoot(repositoryRootPath)).toBe(true);
            expect(repositoryInternals.isCanonicalCheckoutRoot(linkedWorktreePath)).toBe(false);
        } finally {
            try {
                git(repositoryRootPath, ['worktree', 'remove', '--force', linkedWorktreePath]);
            } catch {
                // Ignore cleanup failures after partial setup.
            }
            await fsp.rm(repositoryRootPath, { recursive: true, force: true });
        }
    });

    it('falls back to the provided path when no Git Repository can be resolved', async () => {
        const directoryPath = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-non-git-root-'));

        try {
            expect(Repository.resolveRepositoryRoot(directoryPath)).toBe(directoryPath);
        } finally {
            await fsp.rm(directoryPath, { recursive: true, force: true });
        }
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

    it('accepts repository data with the retired workflow panic key', () => {
        const workflowConfiguration = createDefaultWorkflowSettings();
        const parsed = RepositoryDataSchema.parse({
            ...Repository.create({
                repositoryRootPath: '/workspaces/connect-four',
                platformRepositoryRef: 'Flying-Pillow/connect-four'
            }).toData(),
            workflowConfiguration: {
                ...workflowConfiguration,
                panic: {
                    terminateSessions: true,
                    clearLaunchQueue: true,
                    haltMission: true
                }
            }
        });

        expect(parsed.workflowConfiguration).toEqual(workflowConfiguration);
    });

    it('starts a mission when tracked repository setup exists but persisted Entity state is stale', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-start-stale-'));
        const repositoryRootPath = path.join(tempRoot, 'example');
        const remoteRootPath = path.join(tempRoot, 'remote.git');
        const repository = Repository.create({
            repositoryRootPath,
            platformRepositoryRef: 'Flying-Pillow/example',
            isInitialized: false
        });
        const issueBrief = {
            issueId: 1,
            title: 'Issue 1',
            body: 'Issue body'
        };
        const repositoryInternals = repository as unknown as {
            requireRepositoryPlatformAdapter(authToken?: string): {
                fetchIssue(issueId: string): Promise<typeof issueBrief>;
            };
            prepareMission(
                brief: typeof issueBrief,
                method: 'startMissionFromIssue' | 'startMissionFromBrief'
            ): Promise<unknown>;
        };
        const fetchIssue = vi.fn().mockResolvedValue(issueBrief);
        const requireRepositoryPlatformAdapterSpy = vi
            .spyOn(repositoryInternals, 'requireRepositoryPlatformAdapter')
            .mockReturnValue({ fetchIssue });
        const prepareMissionSpy = vi
            .spyOn(repositoryInternals, 'prepareMission')
            .mockResolvedValue({
                ok: true,
                entity: 'Repository',
                method: 'startMissionFromIssue',
                id: 'mission-1'
            });

        try {
            git(tempRoot, ['init', '--bare', remoteRootPath]);
            git(tempRoot, ['init', repositoryRootPath]);
            git(repositoryRootPath, ['remote', 'add', 'origin', remoteRootPath]);
            await fsp.writeFile(path.join(repositoryRootPath, 'README.md'), 'initial\n', 'utf8');
            git(repositoryRootPath, ['add', 'README.md']);
            git(repositoryRootPath, ['commit', '-m', 'initial']);
            git(repositoryRootPath, ['branch', '-M', 'main']);
            git(repositoryRootPath, ['push', '--set-upstream', 'origin', 'main']);
            await Repository.initializeScaffolding(repositoryRootPath, {
                settings: createDefaultRepositorySettings()
            });
            git(repositoryRootPath, ['add', '.open-mission']);
            git(repositoryRootPath, ['commit', '-m', 'setup']);
            git(repositoryRootPath, ['push']);

            await expect(repository.startMissionFromIssue({
                id: repository.id,
                repositoryRootPath,
                issueNumber: 1
            })).resolves.toMatchObject({
                ok: true,
                entity: 'Repository',
                method: 'startMissionFromIssue',
                id: 'mission-1'
            });

            expect(repository.isInitialized).toBe(true);
            expect(fetchIssue).toHaveBeenCalledWith('1');
            expect(prepareMissionSpy).toHaveBeenCalledWith(issueBrief, 'startMissionFromIssue');
        } finally {
            requireRepositoryPlatformAdapterSpy.mockRestore();
            prepareMissionSpy.mockRestore();
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('rejects mission start when repository setup exists only as untracked local files', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-start-unsynced-'));
        const repositoryRootPath = path.join(tempRoot, 'example');
        const remoteRootPath = path.join(tempRoot, 'remote.git');
        const repository = Repository.create({
            repositoryRootPath,
            platformRepositoryRef: 'Flying-Pillow/example',
            isInitialized: false
        });

        try {
            git(tempRoot, ['init', '--bare', remoteRootPath]);
            git(tempRoot, ['init', repositoryRootPath]);
            git(repositoryRootPath, ['remote', 'add', 'origin', remoteRootPath]);
            await fsp.writeFile(path.join(repositoryRootPath, 'README.md'), 'initial\n', 'utf8');
            git(repositoryRootPath, ['add', 'README.md']);
            git(repositoryRootPath, ['commit', '-m', 'initial']);
            git(repositoryRootPath, ['branch', '-M', 'main']);
            git(repositoryRootPath, ['push', '--set-upstream', 'origin', 'main']);
            await Repository.initializeScaffolding(repositoryRootPath, {
                settings: createDefaultRepositorySettings()
            });

            await expect(repository.startMissionFromIssue({
                id: repository.id,
                repositoryRootPath,
                issueNumber: 1
            })).rejects.toThrow('Complete Repository setup and sync the default branch to GitHub before starting regular missions.');

            expect((await repository.read({
                id: repository.id,
                repositoryRootPath
            })).isInitialized).toBe(false);
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('treats an invalid legacy settings document as Repository setup state', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-legacy-settings-'));
        const repositoryRootPath = path.join(tempRoot, 'example');
        const settingsPath = path.join(repositoryRootPath, '.open-mission', 'settings.json');
        const repository = Repository.create({
            repositoryRootPath,
            platformRepositoryRef: 'Flying-Pillow/example'
        });

        try {
            await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
            await fsp.writeFile(settingsPath, JSON.stringify({
                missionsRoot: path.join(repositoryRootPath, 'mission-worktrees'),
                trackingProvider: 'github',
                instructionsPath: '.agents',
                skillsPath: '.agents/skills',
                agentRunner: 'copilot-cli'
            }), 'utf8');

            const data = await repository.read({
                id: repository.id,
                repositoryRootPath
            });

            expect(data.operationalMode).toBe('setup');
            expect(data.invalidState).toBeUndefined();
            expect(data.isInitialized).toBe(false);
            expect(repository.canSetup()).toEqual({ available: true });
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('surfaces an out-of-date workflow definition as recoverable invalid control state', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-legacy-workflow-'));
        const repositoryRootPath = path.join(tempRoot, 'example');
        const workflowPath = path.join(repositoryRootPath, '.open-mission', 'workflow', 'workflow.json');
        const repository = Repository.create({
            repositoryRootPath,
            platformRepositoryRef: 'Flying-Pillow/example'
        });

        try {
            await Repository.writeSettingsDocument(createDefaultRepositorySettings(), repositoryRootPath, {
                resolveWorkspaceRoot: false
            });
            await fsp.mkdir(path.dirname(workflowPath), { recursive: true });
            await fsp.writeFile(workflowPath, JSON.stringify({
                autostart: { mission: false },
                humanInLoop: { enabled: false, pauseOnMissionStart: false },
                execution: {
                    maxParallelTasks: 1,
                    maxParallelSessions: 1
                },
                stageOrder: ['prd', 'spec', 'implementation', 'audit', 'delivery'],
                stages: {
                    prd: { stageId: 'prd', displayName: 'PRD', taskLaunchPolicy: { defaultAutostart: false } },
                    spec: { stageId: 'spec', displayName: 'Spec', taskLaunchPolicy: { defaultAutostart: false } },
                    implementation: { stageId: 'implementation', displayName: 'Implementation', taskLaunchPolicy: { defaultAutostart: false } },
                    audit: { stageId: 'audit', displayName: 'Audit', taskLaunchPolicy: { defaultAutostart: false } },
                    delivery: { stageId: 'delivery', displayName: 'Delivery', taskLaunchPolicy: { defaultAutostart: false } }
                },
                taskGeneration: [],
                gates: []
            }), 'utf8');

            const data = await repository.read({
                id: repository.id,
                repositoryRootPath
            });

            expect(data.operationalMode).toBe('setup');
            expect(data.invalidState).toEqual(expect.objectContaining({
                code: 'invalid-workflow-definition',
                path: workflowPath,
                message: expect.stringContaining('/execution/maxParallelAgentExecutions')
            }));
            expect(data.settings).toEqual(expect.objectContaining({
                agentAdapter: 'codex',
                enabledAgentAdapters: []
            }));
            expect(data.isInitialized).toBe(false);
            expect(repository.canSetup()).toEqual({ available: true });
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('returns updated repository settings even when the workflow definition is invalid', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-invalid-workflow-settings-'));
        const repositoryRootPath = path.join(tempRoot, 'example');
        const workflowPath = path.join(repositoryRootPath, '.open-mission', 'workflow', 'workflow.json');
        const repository = Repository.create({
            repositoryRootPath,
            platformRepositoryRef: 'Flying-Pillow/example'
        });
        const settings = createDefaultRepositorySettings();
        settings.agentAdapter = 'codex';
        settings.enabledAgentAdapters = ['codex'];

        try {
            await Repository.writeSettingsDocument(settings, repositoryRootPath, {
                resolveWorkspaceRoot: false
            });
            await fsp.mkdir(path.dirname(workflowPath), { recursive: true });
            await fsp.writeFile(workflowPath, JSON.stringify({
                autostart: { mission: false },
                humanInLoop: { enabled: false, pauseOnMissionStart: false },
                execution: {
                    maxParallelTasks: 1,
                    maxParallelSessions: 1
                },
                stageOrder: ['prd', 'spec', 'implementation', 'audit', 'delivery'],
                stages: {
                    prd: { stageId: 'prd', displayName: 'PRD', taskLaunchPolicy: { defaultAutostart: false } },
                    spec: { stageId: 'spec', displayName: 'Spec', taskLaunchPolicy: { defaultAutostart: false } },
                    implementation: { stageId: 'implementation', displayName: 'Implementation', taskLaunchPolicy: { defaultAutostart: false } },
                    audit: { stageId: 'audit', displayName: 'Audit', taskLaunchPolicy: { defaultAutostart: false } },
                    delivery: { stageId: 'delivery', displayName: 'Delivery', taskLaunchPolicy: { defaultAutostart: false } }
                },
                taskGeneration: [],
                gates: []
            }), 'utf8');

            const data = await repository.configureDisplay({
                id: repository.id,
                repositoryRootPath,
                icon: 'logos:github-icon'
            });

            expect(data.invalidState).toEqual(expect.objectContaining({
                code: 'invalid-workflow-definition',
                path: workflowPath
            }));
            expect(data.settings).toEqual(expect.objectContaining({
                agentAdapter: 'codex',
                enabledAgentAdapters: ['codex'],
                icon: 'logos:github-icon'
            }));
            expect(Repository.requireSettingsDocument(repositoryRootPath, {
                resolveWorkspaceRoot: false
            })).toEqual(expect.objectContaining({
                agentAdapter: 'codex',
                enabledAgentAdapters: ['codex'],
                icon: 'logos:github-icon'
            }));
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('initializes repository control state without completing Repository setup', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-prepare-'));
        const repositoryRootPath = path.join(tempRoot, 'example');

        try {
            git(tempRoot, ['init', repositoryRootPath]);
            const repository = Repository.create({
                repositoryRootPath,
                platformRepositoryRef: 'Flying-Pillow/example'
            });

            const ensureIndex = vi.fn().mockResolvedValue(undefined);
            const result = await repository.initialize({
                id: repository.id,
                repositoryRootPath
            }, {
                surfacePath: repositoryRootPath,
                codeIntelligenceService: { ensureIndex }
            });
            const settings = Repository.requireSettingsDocument(repositoryRootPath, {
                resolveWorkspaceRoot: false
            });
            const data = await repository.read({
                id: repository.id,
                repositoryRootPath
            });

            expect(result).toMatchObject({
                ok: true,
                entity: 'Repository',
                method: 'initialize',
                id: repository.id,
                state: 'initialized',
                defaultAgentAdapter: settings.agentAdapter
            });
            expect(result.enabledAgentAdapters).toEqual(settings.enabledAgentAdapters);
            expect(settings.agentAdapter).toBeTruthy();
            expect(ensureIndex).toHaveBeenCalledWith({ rootPath: repositoryRootPath });
            expect(await exists(Repository.getMissionWorkflowDefinitionPath(repositoryRootPath))).toBe(false);
            expect(data.operationalMode).toBe('setup');
            expect(data.isInitialized).toBe(false);
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('starts a manual Code intelligence index for a Repository root', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-index-code-'));
        const repositoryRootPath = path.join(tempRoot, 'example');

        try {
            git(tempRoot, ['init', repositoryRootPath]);
            const repository = Repository.create({
                repositoryRootPath,
                platformRepositoryRef: 'Flying-Pillow/example'
            });
            const ensureIndex = vi.fn().mockResolvedValue({
                snapshot: {
                    id: 'code_index_snapshot:test',
                    indexedAt: '2026-05-12T00:00:00.000Z',
                    fileCount: 3,
                    symbolCount: 2,
                    relationCount: 1
                }
            });

            await expect(repository.indexCode({
                id: repository.id,
                repositoryRootPath
            }, {
                codeIntelligenceService: { ensureIndex }
            })).resolves.toEqual({
                ok: true,
                entity: 'Repository',
                method: 'indexCode',
                id: repository.id,
                snapshotId: 'code_index_snapshot:test',
                indexedAt: '2026-05-12T00:00:00.000Z',
                fileCount: 3,
                symbolCount: 2,
                relationCount: 1
            });
            expect(ensureIndex).toHaveBeenCalledWith({ rootPath: repositoryRootPath });
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('initializes local repository control state when a Repository is added to Mission', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-add-local-'));
        const repositoryRootPath = path.join(tempRoot, 'example');

        try {
            git(tempRoot, ['init', repositoryRootPath]);

            const data = await Repository.add({
                repositoryPath: repositoryRootPath
            });
            const settings = Repository.requireSettingsDocument(repositoryRootPath, {
                resolveWorkspaceRoot: false
            });

            expect(data.repositoryRootPath).toBe(repositoryRootPath);
            expect(settings.agentAdapter).toBeTruthy();
            expect(data.isInitialized).toBe(false);
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('reads Repository settings from the repository settings document for fresh instances', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-settings-read-'));
        const repositoryRootPath = path.join(tempRoot, 'example');
        const settings = createDefaultRepositorySettings();
        settings.agentAdapter = 'codex';
        settings.enabledAgentAdapters = ['codex', 'copilot'];
        settings.icon = 'logos:github-icon';

        try {
            git(tempRoot, ['init', repositoryRootPath]);
            await Repository.initializeScaffolding(repositoryRootPath, { settings });

            const data = await Repository.open(repositoryRootPath).read({
                id: Repository.open(repositoryRootPath).id,
                repositoryRootPath
            });

            expect(data.settings.agentAdapter).toBe('codex');
            expect(data.settings.enabledAgentAdapters).toEqual(['codex', 'copilot']);
            expect(data.settings.icon).toBe('logos:github-icon');
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('updates repository icon in the repository settings document', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-display-config-'));
        const repositoryRootPath = path.join(tempRoot, 'example');
        const settings = createDefaultRepositorySettings();

        try {
            git(tempRoot, ['init', repositoryRootPath]);
            await Repository.initializeScaffolding(repositoryRootPath, { settings });
            const repository = Repository.open(repositoryRootPath);

            const data = await repository.configureDisplay({
                id: repository.id,
                repositoryRootPath,
                icon: 'logos:github-icon'
            });

            expect(data.settings.icon).toBe('logos:github-icon');
            expect(Repository.requireSettingsDocument(repositoryRootPath, {
                resolveWorkspaceRoot: false
            }).icon).toBe('logos:github-icon');
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('ensures repository AgentExecution for an initialized Repository', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-setup-agent-'));
        const repositoryRootPath = path.join(tempRoot, 'example');
        const settings = createDefaultRepositorySettings();
        const execution = createTestAgentExecution({
            id: 'agent_execution:setup-test',
            ownerId: repositoryRootPath,
            agentExecutionId: 'setup-test',
            agentId: settings.agentAdapter,
            scope: {
                kind: 'repository',
                repositoryRootPath
            }
        });
        const ensureExecution = vi.fn().mockResolvedValue(execution);

        try {
            git(tempRoot, ['init', repositoryRootPath]);
            await Repository.initializeScaffolding(repositoryRootPath, { settings });
            const repository = Repository.create({
                repositoryRootPath,
                platformRepositoryRef: 'Flying-Pillow/example',
                settings,
                isInitialized: true
            });

            const result = await repository.ensureRepositoryAgentExecution({
                id: repository.id,
                repositoryRootPath
            }, {
                surfacePath: repositoryRootPath,
                agentExecutionRegistry: { ensureExecution }
            } as unknown as EntityExecutionContext);

            expect(result).toEqual(execution);
            expect(ensureExecution).toHaveBeenCalledWith(expect.objectContaining({
                ownerKey: `Repository.agentExecution:${repositoryRootPath}`,
                config: expect.objectContaining({
                    requestedAdapterId: settings.agentAdapter,
                    workingDirectory: repositoryRootPath,
                    initialPrompt: expect.objectContaining({
                        source: 'system',
                        text: expect.stringContaining("Wait for the operator's first task.")
                    }),
                    scope: {
                        kind: 'repository',
                        repositoryRootPath
                    }
                })
            }));
            expect(ensureExecution.mock.calls[0]?.[0].config.initialPrompt.text).toContain('Keep the conversation concise and focused on the requested repository task.');
            expect(ensureExecution.mock.calls[0]?.[0].config.initialPrompt.text).toContain('Repository initialization and recovery tasks may be requested later in this session.');
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('hydrates repository AgentExecution prompt from repo-native setup when persisted state is stale', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-stale-setup-agent-'));
        const repositoryRootPath = path.join(tempRoot, 'example');
        const settings = createDefaultRepositorySettings();
        const execution = createTestAgentExecution({
            id: 'agent_execution:stale-setup-test',
            ownerId: repositoryRootPath,
            agentExecutionId: 'stale-setup-test',
            agentId: settings.agentAdapter,
            scope: {
                kind: 'repository',
                repositoryRootPath
            }
        });
        const ensureExecution = vi.fn().mockResolvedValue(execution);

        try {
            git(tempRoot, ['init', repositoryRootPath]);
            await Repository.initializeScaffolding(repositoryRootPath, { settings });
            const repository = Repository.create({
                repositoryRootPath,
                platformRepositoryRef: 'Flying-Pillow/example',
                isInitialized: false
            });

            await repository.ensureRepositoryAgentExecution({
                id: repository.id,
                repositoryRootPath
            }, {
                surfacePath: repositoryRootPath,
                agentExecutionRegistry: { ensureExecution }
            } as unknown as EntityExecutionContext);

            expect(ensureExecution.mock.calls[0]?.[0].config.initialPrompt.text).toContain("Wait for the operator's first task.");
            expect(ensureExecution.mock.calls[0]?.[0].config.initialPrompt.text).not.toContain('Repository control state is not fully initialized yet.');
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('reuses an active repository AgentExecution without rebuilding the prompt', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-reuse-agent-'));
        const repositoryRootPath = path.join(tempRoot, 'example');
        const settings = createDefaultRepositorySettings();
        const execution = createTestAgentExecution({
            id: 'agent_execution:setup-test',
            ownerId: repositoryRootPath,
            agentExecutionId: 'setup-test',
            agentId: settings.agentAdapter,
            scope: {
                kind: 'repository',
                repositoryRootPath
            }
        });
        const readReusableExecution = vi.fn().mockReturnValue(execution);
        const ensureExecution = vi.fn();

        try {
            git(tempRoot, ['init', repositoryRootPath]);
            await Repository.initializeScaffolding(repositoryRootPath, { settings });
            const repository = Repository.create({
                repositoryRootPath,
                platformRepositoryRef: 'Flying-Pillow/example',
                settings,
                isInitialized: true
            });
            const buildPromptSpy = vi.spyOn(repository as unknown as {
                buildRepositoryAgentPrompt: (context?: EntityExecutionContext) => Promise<string>;
            }, 'buildRepositoryAgentPrompt');

            const result = await repository.ensureRepositoryAgentExecution({
                id: repository.id,
                repositoryRootPath
            }, {
                surfacePath: repositoryRootPath,
                agentExecutionRegistry: {
                    readReusableExecution,
                    ensureExecution
                } as unknown as EntityExecutionContext['agentExecutionRegistry']
            } as EntityExecutionContext);

            expect(result).toEqual(execution);
            expect(readReusableExecution).toHaveBeenCalledWith({
                ownerKey: `Repository.agentExecution:${repositoryRootPath}`,
                requestedAgentId: settings.agentAdapter
            });
            expect(buildPromptSpy).not.toHaveBeenCalled();
            expect(ensureExecution).not.toHaveBeenCalled();
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('refreshes repository AgentExecution by replacing the active execution', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-refresh-agent-'));
        const repositoryRootPath = path.join(tempRoot, 'example');
        const settings = createDefaultRepositorySettings();
        const execution = createTestAgentExecution({
            id: 'agent_execution:refresh-test',
            ownerId: repositoryRootPath,
            agentExecutionId: 'refresh-test',
            agentId: settings.agentAdapter,
            scope: {
                kind: 'repository',
                repositoryRootPath
            }
        });
        const replaceActiveExecution = vi.fn().mockResolvedValue(execution);
        const ensureExecution = vi.fn();

        try {
            git(tempRoot, ['init', repositoryRootPath]);
            await Repository.initializeScaffolding(repositoryRootPath, { settings });
            const repository = Repository.create({
                repositoryRootPath,
                platformRepositoryRef: 'Flying-Pillow/example',
                settings,
                isInitialized: true
            });

            const result = await repository.refreshRepositoryAgentExecution({
                id: repository.id,
                repositoryRootPath
            }, {
                surfacePath: repositoryRootPath,
                agentExecutionRegistry: {
                    replaceActiveExecution,
                    ensureExecution
                } as unknown as EntityExecutionContext['agentExecutionRegistry']
            } as EntityExecutionContext);

            expect(result).toEqual(execution);
            expect(replaceActiveExecution).toHaveBeenCalledWith(expect.objectContaining({
                ownerKey: `Repository.agentExecution:${repositoryRootPath}`,
                config: expect.objectContaining({
                    requestedAdapterId: settings.agentAdapter,
                    workingDirectory: repositoryRootPath,
                    initialPrompt: expect.objectContaining({
                        source: 'system',
                        text: expect.stringContaining("Wait for the operator's first task.")
                    }),
                    scope: {
                        kind: 'repository',
                        repositoryRootPath
                    }
                })
            }));
            expect(ensureExecution).not.toHaveBeenCalled();
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('rejects repository AgentExecution from a linked worktree root', async () => {
        const repositoryRootPath = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-agent-worktree-'));
        const linkedWorktreePath = path.join(repositoryRootPath, '..', 'linked-worktree');

        try {
            git(repositoryRootPath, ['init']);
            await fsp.writeFile(path.join(repositoryRootPath, 'README.md'), '# Mission Test\n', 'utf8');
            git(repositoryRootPath, ['add', 'README.md']);
            git(repositoryRootPath, ['commit', '-m', 'init']);
            git(repositoryRootPath, ['worktree', 'add', linkedWorktreePath, '-b', 'linked/test']);
            await Repository.initializeScaffolding(linkedWorktreePath, {
                settings: createDefaultRepositorySettings()
            });

            const repository = Repository.create({
                repositoryRootPath: linkedWorktreePath,
                platformRepositoryRef: 'Flying-Pillow/example',
                settings: createDefaultRepositorySettings(),
                isInitialized: true
            });

            await expect(repository.ensureRepositoryAgentExecution({
                id: repository.id,
                repositoryRootPath: linkedWorktreePath
            })).rejects.toThrow(/linked worktree/i);
        } finally {
            try {
                git(repositoryRootPath, ['worktree', 'remove', '--force', linkedWorktreePath]);
            } catch {
                // Ignore cleanup failures after partial setup.
            }
            await fsp.rm(repositoryRootPath, { recursive: true, force: true });
        }
    });

    it('ensures a system-scoped repositories AgentExecution', async () => {
        process.env['XDG_CONFIG_HOME'] = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-system-config-'));
        await writeOpenMissionConfig({
            missionsRoot: '/missions',
            repositoriesRoot: '/repositories',
            defaultAgentAdapter: 'copilot-cli'
        });
        const repositoriesRootPath = resolveRepositoriesRoot({
            version: 1,
            missionsRoot: '/missions',
            repositoriesRoot: '/repositories',
            defaultAgentAdapter: 'copilot-cli',
            enabledAgentAdapters: []
        });
        const execution = createTestAgentExecution({
            id: 'agent_execution:repositories-system',
            ownerId: '/repositories',
            agentExecutionId: 'repositories-system',
            agentId: 'copilot-cli',
            scope: {
                kind: 'system',
                label: '/repositories'
            }
        });
        const ensureExecution = vi.fn().mockResolvedValue(execution);

        const result = await Repository.ensureSystemAgentExecution({}, {
            surfacePath: '/mission',
            agentExecutionRegistry: { ensureExecution }
        } as unknown as EntityExecutionContext);

        expect(result).toEqual(execution);
        expect(ensureExecution).toHaveBeenCalledWith(expect.objectContaining({
            ownerKey: `Repository.systemAgentExecution:${repositoriesRootPath}`,
            config: expect.objectContaining({
                workingDirectory: repositoriesRootPath,
                scope: {
                    kind: 'system',
                    label: '/repositories'
                },
                requestedAdapterId: 'copilot-cli',
                initialPrompt: expect.objectContaining({
                    source: 'system',
                    text: expect.stringContaining('Checked out repositories:')
                })
            })
        }));
    });

    it('starts a mission when Mission worktrees live outside the Repository root', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-external-worktrees-'));
        const repositoriesRoot = path.join(tempRoot, 'repositories');
        const missionsRoot = path.join(tempRoot, 'missions');
        const repositoryRootPath = path.join(repositoriesRoot, 'Flying-Pillow', 'mission');
        const remoteRootPath = path.join(tempRoot, 'remote.git');
        const settings = createDefaultRepositorySettings();
        settings.missionsRoot = missionsRoot;

        try {
            await fsp.mkdir(path.dirname(repositoryRootPath), { recursive: true });
            git(tempRoot, ['init', '--bare', remoteRootPath]);
            git(tempRoot, ['init', repositoryRootPath]);
            await fsp.writeFile(path.join(repositoryRootPath, 'README.md'), 'initial\n', 'utf8');
            await Repository.initializeScaffolding(repositoryRootPath, { settings });
            git(repositoryRootPath, ['add', 'README.md', '.open-mission']);
            git(repositoryRootPath, ['commit', '-m', 'initial']);
            git(repositoryRootPath, ['branch', '-M', 'main']);
            git(repositoryRootPath, ['remote', 'add', 'origin', remoteRootPath]);
            git(repositoryRootPath, ['push', '--set-upstream', 'origin', 'main']);

            const repository = Repository.open(repositoryRootPath);
            const result = await repository.startMissionFromBrief({
                id: repository.id,
                repositoryRootPath,
                title: 'Adopt Sandcastle AgentProviderAdapter for four agent coders',
                body: 'Use Sandcastle providers behind Mission runtime boundaries.',
                type: 'refactor'
            });
            const missionWorktreePath = path.join(missionsRoot, 'mission', result.id);

            expect(result).toMatchObject({
                ok: true,
                entity: 'Repository',
                method: 'startMissionFromBrief'
            });
            await expect(fsp.stat(path.join(missionWorktreePath, '.open-mission', 'settings.json'))).resolves.toBeDefined();
            expect(git(missionWorktreePath, ['status', '--porcelain'])).toBe('');
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('rejects an existing Mission dossier with stale runtime data during start', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-existing-stale-runtime-'));
        const repositoryRootPath = path.join(tempRoot, 'example');
        const missionDir = path.join(repositoryRootPath, '.open-mission', 'missions', '1-initial-setup');
        const repository = Repository.create({ repositoryRootPath });
        const repositoryInternals = repository as unknown as {
            assertExistingMissionRuntimeDataValid(
                adapter: MissionDossierFilesystem,
                missionDir: string,
                missionId: string
            ): Promise<void>;
        };

        try {
            await fsp.mkdir(missionDir, { recursive: true });
            await fsp.writeFile(path.join(missionDir, 'mission.json'), JSON.stringify({
                schemaVersion: 1,
                missionId: '1-initial-setup',
                configuration: {
                    createdAt: '2026-04-28T14:42:35.582Z',
                    source: 'global-settings',
                    workflowVersion: 'mission-workflow-v1',
                    workflow: createDefaultWorkflowSettings()
                },
                runtime: {
                    lifecycle: 'draft',
                    pause: { paused: false },
                    stages: [],
                    tasks: [],
                    sessions: [],
                    gates: [],
                    launchQueue: [],
                    updatedAt: '2026-04-28T14:42:35.582Z'
                }
            }, null, 2), 'utf8');

            await expect(repositoryInternals.assertExistingMissionRuntimeDataValid(
                new MissionDossierFilesystem(repositoryRootPath),
                missionDir,
                '1-initial-setup'
            )).rejects.toThrow(/does not fallback-load or implicitly migrate stale runtime data/u);
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('adopts an existing Mission worktree on the expected branch', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-adopt-worktree-'));
        const repositoryRootPath = path.join(tempRoot, 'repository');
        const worktreePath = path.join(tempRoot, 'mission-worktree');
        const branchRef = 'mission/1-initial-setup';
        const repository = Repository.create({ repositoryRootPath });
        const repositoryInternals = repository as unknown as {
            ensureMissionWorktreeOnBranch(
                store: MissionDossierFilesystem,
                missionWorktreePath: string,
                branchRef: string,
                baseBranch: string
            ): Promise<void>;
        };

        try {
            git(tempRoot, ['init', repositoryRootPath]);
            await fsp.writeFile(path.join(repositoryRootPath, 'README.md'), 'initial\n', 'utf8');
            git(repositoryRootPath, ['add', 'README.md']);
            git(repositoryRootPath, ['commit', '-m', 'initial']);
            git(repositoryRootPath, ['branch', '-M', 'main']);
            git(repositoryRootPath, ['worktree', 'add', '-b', branchRef, worktreePath, 'main']);

            await expect(repositoryInternals.ensureMissionWorktreeOnBranch(
                new MissionDossierFilesystem(repositoryRootPath),
                worktreePath,
                branchRef,
                'main'
            )).resolves.toBeUndefined();

            expect(git(worktreePath, ['branch', '--show-current'])).toBe(branchRef);
        } finally {
            await fsp.rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
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

        expect(view.commands).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    commandId: 'repository.add',
                    available: true
                }),
                expect.objectContaining({
                    commandId: 'repository.createPlatformRepository',
                    available: true
                })
            ])
        );
        expect(remove).toHaveBeenCalledWith(Repository, repository.id);
    });

    it('creates a new platform repository and initializes Mission control state', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-create-'));
        const repositoryRootPath = path.join(tempRoot, 'created-repository');
        const remoteRootPath = path.join(tempRoot, 'remote.git');
        git(tempRoot, ['init', '--bare', remoteRootPath]);
        git(tempRoot, ['init', repositoryRootPath]);
        git(repositoryRootPath, ['remote', 'add', 'origin', remoteRootPath]);
        await fsp.writeFile(path.join(repositoryRootPath, 'README.md'), 'initial\n', 'utf8');
        git(repositoryRootPath, ['add', 'README.md']);
        git(repositoryRootPath, ['commit', '-m', 'initial']);
        git(repositoryRootPath, ['branch', '-M', 'main']);
        git(repositoryRootPath, ['push', '--set-upstream', 'origin', 'main']);

        const repositoryStatics = Repository as unknown as {
            createPlatformRepositoryAfterDuplicateCheck(
                input: {
                    platform: 'github';
                    ownerLogin: string;
                    repositoryName: string;
                    destinationPath: string;
                    visibility: 'private' | 'public' | 'internal';
                },
                context?: EntityExecutionContext
            ): Promise<string>;
        };
        const createPlatformRepositorySpy = vi
            .spyOn(repositoryStatics, 'createPlatformRepositoryAfterDuplicateCheck')
            .mockResolvedValue(repositoryRootPath);
        const context = {
            surfacePath: '/repositories',
            entityFactory: {
                has: () => true,
                register: () => undefined,
                read: async () => undefined,
                save: async (_entityClass: unknown, repository: ReturnType<Repository['toStorage']>) => new Repository(repository)
            }
        } as unknown as EntityExecutionContext;

        try {
            const data = await Repository.createPlatformRepository({
                platform: 'github',
                ownerLogin: 'Flying-Pillow',
                repositoryName: 'created-repository',
                destinationPath: tempRoot,
                visibility: 'private'
            }, context);

            expect(createPlatformRepositorySpy).toHaveBeenCalledWith({
                platform: 'github',
                ownerLogin: 'Flying-Pillow',
                repositoryName: 'created-repository',
                destinationPath: tempRoot,
                visibility: 'private'
            }, context);
            expect(data.id).toMatch(/^repository:local\/created-repository\/[a-f0-9]{8}$/u);
            expect(data.repositoryRootPath).toBe(repositoryRootPath);
            expect(data.isInitialized).toBe(true);
            await expect(fsp.access(path.join(repositoryRootPath, '.open-mission', 'settings.json'))).resolves.toBeUndefined();
            expect(git(repositoryRootPath, ['ls-tree', '-r', '--name-only', 'HEAD', '--', '.open-mission']).split(/\r?\n/u)).toEqual(expect.arrayContaining([
                '.open-mission/settings.json',
                '.open-mission/workflow/workflow.json'
            ]));
            expect(git(repositoryRootPath, ['ls-tree', '-r', '--name-only', 'origin/main', '--', '.open-mission']).split(/\r?\n/u)).toEqual(expect.arrayContaining([
                '.open-mission/settings.json',
                '.open-mission/workflow/workflow.json'
            ]));
        } finally {
            createPlatformRepositorySpy.mockRestore();
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
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
            expect(view.commands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        commandId: 'repository.add',
                        label: 'Clone',
                        available: false,
                        unavailableReason: `Repository 'Flying-Pillow/already-cloned' is already checked out at '${repositoryRootPath}'.`
                    }),
                    expect.objectContaining({
                        commandId: 'repository.createPlatformRepository',
                        label: 'Create repository',
                        available: true
                    })
                ])
            );
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
            'repository.fetchExternalState',
            'repository.fastForwardFromExternal',
            'repository.indexCode',
            'repository.remove'
        ]);
        expect(view.commands.find((command) => command.commandId === 'repository.remove')).toMatchObject({
            available: true,
            confirmation: {
                required: true,
                prompt: 'Remove this repository from Mission and delete its files from this computer? This cannot be undone.'
            }
        });
        expect(view.commands.find((command) => command.commandId === 'repository.fetchExternalState')).toMatchObject({
            available: false,
            unavailableReason: 'Repository root does not exist.'
        });
        expect(view.commands.find((command) => command.commandId === 'repository.indexCode')).toMatchObject({
            label: 'Index code',
            available: false,
            unavailableReason: 'Repository root does not exist.'
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
                external: { status: 'up-to-date', aheadCount: 0, behindCount: 0 }
            });

            const commandsBeforeFetch = await repository.commands({
                id: repository.id,
                repositoryRootPath: repository.repositoryRootPath
            });
            expect(commandsBeforeFetch.commands.find((command) => command.commandId === 'repository.fastForwardFromExternal')).toMatchObject({
                available: false,
                unavailableReason: 'Repository is already up to date with its external tracking branch.'
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

            await fsp.writeFile(path.join(localPath, 'LOCAL.md'), 'operator change\n', 'utf8');
            const commands = await repository.commands({
                id: repository.id,
                repositoryRootPath: repository.repositoryRootPath
            });
            expect(commands.commands.find((command) => command.commandId === 'repository.fastForwardFromExternal')).toMatchObject({
                available: true
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
            expect(await fsp.readFile(path.join(localPath, 'LOCAL.md'), 'utf8')).toBe('operator change\n');
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

    it('removes external Mission worktrees before deleting the Repository root', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-remove-external-worktrees-'));
        const repositoriesRoot = path.join(tempRoot, 'repositories');
        const missionsRoot = path.join(tempRoot, 'missions');
        const repositoryRootPath = path.join(repositoriesRoot, 'example');
        const remoteRootPath = path.join(tempRoot, 'remote.git');
        const settings = createDefaultRepositorySettings();
        settings.missionsRoot = missionsRoot;
        const remove = vi.fn().mockResolvedValue(undefined);
        const context = {
            entityFactory: {
                has: () => true,
                register: () => undefined,
                remove
            }
        } as unknown as EntityExecutionContext;

        try {
            await fsp.mkdir(path.dirname(repositoryRootPath), { recursive: true });
            git(tempRoot, ['init', '--bare', remoteRootPath]);
            git(tempRoot, ['init', repositoryRootPath]);
            await fsp.writeFile(path.join(repositoryRootPath, 'README.md'), 'initial\n', 'utf8');
            await Repository.initializeScaffolding(repositoryRootPath, { settings });
            git(repositoryRootPath, ['add', 'README.md', '.open-mission']);
            git(repositoryRootPath, ['commit', '-m', 'initial']);
            git(repositoryRootPath, ['branch', '-M', 'main']);
            git(repositoryRootPath, ['remote', 'add', 'origin', remoteRootPath]);
            git(repositoryRootPath, ['push', '--set-upstream', 'origin', 'main']);

            const repository = Repository.open(repositoryRootPath);
            const missionStart = await repository.startMissionFromBrief({
                id: repository.id,
                repositoryRootPath,
                title: 'Remove external worktree regression',
                body: 'Ensure Repository.remove cleans repo-scoped mission worktrees.',
                type: 'task'
            });
            const missionWorktreesPath = path.join(missionsRoot, 'example');
            const missionWorktreePath = path.join(missionWorktreesPath, missionStart.id);

            await expect(fsp.stat(path.join(missionWorktreePath, '.open-mission', 'settings.json'))).resolves.toBeDefined();

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
            await expect(fsp.lstat(missionWorktreesPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(remove).toHaveBeenCalledWith(Repository, repository.id);
        } finally {
            await fsp.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('summarizes repository removal inventory with mission runtime and worktree details', async () => {
        const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mission-repository-removal-summary-'));
        const repositoriesRoot = path.join(tempRoot, 'repositories');
        const missionsRoot = path.join(tempRoot, 'missions');
        const repositoryRootPath = path.join(repositoriesRoot, 'example');
        const remoteRootPath = path.join(tempRoot, 'remote.git');
        const settings = createDefaultRepositorySettings();
        settings.missionsRoot = missionsRoot;

        try {
            await fsp.mkdir(path.dirname(repositoryRootPath), { recursive: true });
            git(tempRoot, ['init', '--bare', remoteRootPath]);
            git(tempRoot, ['init', repositoryRootPath]);
            await fsp.writeFile(path.join(repositoryRootPath, 'README.md'), 'initial\n', 'utf8');
            git(repositoryRootPath, ['add', 'README.md']);
            git(repositoryRootPath, ['commit', '-m', 'initial']);
            git(repositoryRootPath, ['branch', '-M', 'main']);
            git(repositoryRootPath, ['remote', 'add', 'origin', remoteRootPath]);
            git(repositoryRootPath, ['push', '--set-upstream', 'origin', 'main']);
            await Repository.initializeScaffolding(repositoryRootPath, { settings });
            git(repositoryRootPath, ['add', '.open-mission']);
            git(repositoryRootPath, ['commit', '-m', 'setup']);
            git(repositoryRootPath, ['push']);

            const repository = Repository.open(repositoryRootPath);
            const missionStart = await repository.startMissionFromBrief({
                id: repository.id,
                repositoryRootPath,
                title: 'Tidy repository removal',
                body: 'Capture what the removal will delete.',
                type: 'task'
            });
            const store = new MissionDossierFilesystem(repositoryRootPath);
            const missionId = missionStart.id;
            const missionRootPath = store.getMissionDir(missionId);
            const missionWorktreePath = store.getMissionWorktreePath(missionId);
            const now = new Date().toISOString();
            const configuration = createWorkflowConfigurationSnapshot({
                createdAt: now,
                workflowVersion: 'test-workflow',
                workflow: repository.workflowConfiguration
            });
            const missionState = createWorkflowStateData({
                missionId,
                configuration,
                runtime: createInitialWorkflowRuntimeState(configuration, now),
                createdAt: now
            });
            missionState.runtime.lifecycle = 'running';
            missionState.runtime.activeStageId = 'implementation';
            missionState.runtime.agentExecutions = [{
                agentExecutionId: 'agent-1',
                taskId: 'task-1',
                agentId: 'codex',
                lifecycle: 'running',
                launchedAt: now,
                updatedAt: now
            }];
            await store.writeWorkflowStateDataFile(missionRootPath, missionState);
            await fsp.writeFile(path.join(missionWorktreePath, 'notes.txt'), 'dirty\n', 'utf8');
            await fsp.writeFile(path.join(repositoryRootPath, 'repo-change.txt'), 'dirty\n', 'utf8');

            const summary = await repository.readRemovalSummary({
                id: repository.id,
                repositoryRootPath
            });

            expect(summary).toMatchObject({
                id: repository.id,
                repositoryRootPath,
                missionWorktreesPath: path.join(missionsRoot, 'example'),
                hasExternalMissionWorktrees: true,
                missionCount: 1,
                dirtyMissionCount: 1,
                missionsWithActiveAgentExecutionsCount: 1,
                activeAgentExecutionCount: 1,
                repositoryWorktree: expect.objectContaining({
                    clean: false
                })
            });
            expect(summary.missions).toEqual([
                expect.objectContaining({
                    missionId,
                    title: 'Tidy repository removal',
                    lifecycle: 'running',
                    currentStageId: 'implementation',
                    activeAgentExecutionCount: 1,
                    missionRootPath,
                    missionWorktreePath,
                    worktree: expect.objectContaining({
                        clean: false,
                        untrackedCount: 1
                    })
                })
            ]);
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

    it('keeps setup out of generic command descriptors after Repository control state is initialized', async () => {
        const repository = Repository.create({
            repositoryRootPath: '/tmp/mission-proof-of-concept',
            platformRepositoryRef: 'Flying-Pillow/mission',
            isInitialized: true
        });

        const view = await repository.commands({
            id: repository.id,
            repositoryRootPath: repository.repositoryRootPath
        });

        expect(view.commands.find((command) => command.commandId === 'repository.setup')).toBeUndefined();
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

async function exists(filePath: string): Promise<boolean> {
    return fsp.access(filePath).then(
        () => true,
        () => false
    );
}
