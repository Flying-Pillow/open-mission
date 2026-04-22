import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolveGitHubRepositoryFromWorkspace } from '../platforms/GitHubPlatformAdapter.js';

export type RepositoryIdentity = {
	repositoryId: string;
	repositoryRootPath: string;
	githubRepository?: string;
};

export function deriveRepositoryIdentity(repositoryRootPath: string): RepositoryIdentity {
	const normalizedRepositoryRootPath = path.resolve(repositoryRootPath);
	const githubRepository = normalizeGitHubRepositoryName(
		resolveGitHubRepositoryFromWorkspace(normalizedRepositoryRootPath)
	);
	if (githubRepository) {
		return {
			repositoryId: buildGitHubRepositoryId(githubRepository),
			repositoryRootPath: normalizedRepositoryRootPath,
			githubRepository
		};
	}

	return {
		repositoryId: buildLocalRepositoryId(normalizedRepositoryRootPath),
		repositoryRootPath: normalizedRepositoryRootPath
	};
}

export function buildGitHubRepositoryId(githubRepository: string): string {
	const normalizedRepository = normalizeGitHubRepositoryName(githubRepository);
	if (!normalizedRepository) {
		throw new Error(`GitHub repository '${githubRepository}' is invalid.`);
	}
	return `github:${normalizedRepository.replace('/', ':')}`;
}

export function slugRepositoryIdentitySegment(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function normalizeGitHubRepositoryName(value: string | undefined): string | undefined {
	const [owner, repository, ...rest] = value?.trim().split('/').map((segment) => segment.trim()) ?? [];
	if (!owner || !repository || rest.length > 0) {
		return undefined;
	}
	return `${owner}/${repository}`;
}

function buildLocalRepositoryId(repositoryRootPath: string): string {
	const repositoryLabel = slugRepositoryIdentitySegment(path.basename(repositoryRootPath) || 'repository') || 'repository';
	const repositoryHash = createHash('sha1').update(repositoryRootPath).digest('hex').slice(0, 8);
	return `local:${repositoryLabel}:${repositoryHash}`;
}