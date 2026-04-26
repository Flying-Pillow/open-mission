import { describe, expect, it } from 'vitest';
import { Repository } from './Repository.js';
import { createDefaultRepositorySettings } from '../../schemas/RepositorySettings.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';

describe('Repository', () => {
    it('opens a local repository with default configuration', () => {
        const repository = Repository.open('/tmp/mission-proof-of-concept');

        expect(repository.ownerId).toBe('local');
        expect(repository.repoName).toBe('mission-proof-of-concept');
        expect(repository.label).toBe('mission-proof-of-concept');
        expect(repository.isInitialized).toBe(false);
        expect(repository.workflowConfiguration).toEqual(createDefaultWorkflowSettings());
    });

    it('registers a GitHub repository and updates only its own configuration', () => {
        const repository = Repository.register({
            repositoryRootPath: '/workspaces/mission',
            githubRepository: 'Flying-Pillow/mission'
        });

        const settings = createDefaultRepositorySettings();
        settings.instructionsPath = '.copilot';

        repository.updateSettings(settings).markInitialized();

        expect(repository.ownerId).toBe('Flying-Pillow');
        expect(repository.repoName).toBe('mission');
        expect(repository.githubRepository).toBe('Flying-Pillow/mission');
        expect(repository.settings.instructionsPath).toBe('.copilot');
        expect(repository.isInitialized).toBe(true);
    });

    it('rejects extra fields in daemon-callable static payloads', async () => {
        await expect(Repository.find({ unexpected: true } as never)).rejects.toThrow();
    });

    it('rejects mismatched daemon-callable instance payloads', async () => {
        const repository = Repository.open('/tmp/mission-proof-of-concept');

        await expect(repository.read({
            repositoryId: 'other:repository',
            repositoryRootPath: repository.repositoryRootPath
        })).rejects.toThrow(/does not match/u);
    });
});