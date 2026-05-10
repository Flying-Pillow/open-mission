import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type ArtifactReadResultType = {
    path: string;
    content: string;
};

export class ArtifactService {
    public async readArtifact(input: {
        repositoryRootPath: string;
        artifactPath: string;
    }): Promise<ArtifactReadResultType> {
        const normalizedArtifactPath = normalizeRepositoryRelativeArtifactPath(input.repositoryRootPath, input.artifactPath);
        const content = await fs.readFile(path.join(path.resolve(input.repositoryRootPath), normalizedArtifactPath), 'utf8');
        return {
            path: normalizedArtifactPath,
            content
        };
    }
}

export function normalizeRepositoryRelativeArtifactPath(repositoryRootPath: string, artifactPath: string): string {
    const trimmedArtifactPath = artifactPath.trim();
    if (!trimmedArtifactPath) {
        throw new Error('ArtifactService.readArtifact requires a repository-relative path.');
    }
    if (path.isAbsolute(trimmedArtifactPath)) {
        throw new Error('ArtifactService.readArtifact only accepts repository-relative paths.');
    }
    const resolvedRepositoryRoot = path.resolve(repositoryRootPath);
    const resolvedArtifactPath = path.resolve(resolvedRepositoryRoot, trimmedArtifactPath);
    const relativeArtifactPath = path.relative(resolvedRepositoryRoot, resolvedArtifactPath);
    if (!relativeArtifactPath || relativeArtifactPath.startsWith('..') || path.isAbsolute(relativeArtifactPath)) {
        throw new Error(`ArtifactService.readArtifact path '${artifactPath}' escapes repository scope.`);
    }
    return relativeArtifactPath.split(path.sep).join('/');
}