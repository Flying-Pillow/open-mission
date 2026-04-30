import { describe, expect, it } from 'vitest';
import { Repository } from './Repository.js';
import { createDefaultRepositorySettings } from './RepositorySchema.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';
import type { EntityExecutionContext } from '../Entity/Entity.js';

describe('Repository', () => {
    it('opens a local repository with default configuration', () => {
        const repository = Repository.open('/tmp/mission-proof-of-concept');

        expect(repository.id).toMatch(/^repository:local\/mission-proof-of-concept\/[a-f0-9]{8}$/u);
        expect(repository.toSchema().id).toBe(repository.id);
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
                read: async () => repository
            }
        } as Pick<EntityExecutionContext, 'entityFactory'> as EntityExecutionContext;

        await expect(Repository.resolve({
            id: repository.id,
            repositoryRootPath: repository.repositoryRootPath,
            issueNumber: 29
        }, context)).resolves.toBe(repository);
    });
});