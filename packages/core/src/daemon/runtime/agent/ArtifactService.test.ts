import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactService } from './ArtifactService.js';

describe('ArtifactService', () => {
    const temporaryDirectories = new Set<string>();

    afterEach(async () => {
        await Promise.all([...temporaryDirectories].map(async (directory) => {
            await fs.rm(directory, { recursive: true, force: true });
            temporaryDirectories.delete(directory);
        }));
    });

    it('reads a repository-relative artifact without journaling concerns', async () => {
        const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-artifact-service-'));
        temporaryDirectories.add(repositoryRoot);
        await fs.mkdir(path.join(repositoryRoot, 'missions', '1-initial-setup'), { recursive: true });
        await fs.writeFile(path.join(repositoryRoot, 'missions', '1-initial-setup', 'BRIEF.md'), '# Brief\n', 'utf8');

        const service = new ArtifactService();
        const result = await service.readArtifact({
            repositoryRootPath: repositoryRoot,
            artifactPath: 'missions/1-initial-setup/BRIEF.md'
        });

        expect(result).toEqual({
            path: 'missions/1-initial-setup/BRIEF.md',
            content: '# Brief\n'
        });
    });
});