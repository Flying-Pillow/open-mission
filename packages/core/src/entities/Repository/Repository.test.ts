import { describe, expect, it } from 'vitest';
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
            'repository.startMissionFromIssue',
            'repository.startMissionFromBrief',
            'repository.remove'
        ]);
        expect(view.commands.find((command) => command.commandId === 'repository.prepare')).toMatchObject({
            disabled: false
        });
        expect(view.commands.find((command) => command.commandId === 'repository.startMissionFromBrief')).toMatchObject({
            disabled: true,
            disabledReason: 'Repository control state is not initialized.'
        });
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