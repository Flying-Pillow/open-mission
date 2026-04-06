import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import {
	getMissionCatalogPath,
	getMissionDirectoryPath,
	getMissionWorktreesPath
} from '../lib/repoConfig.js';
import { getMissionDaemonSettingsPath } from '../lib/daemonConfig.js';
import { initializeMissionRepository } from '../initializeMissionRepository.js';
import { GitHubPlatformAdapter } from '../platforms/GitHubPlatformAdapter.js';
import type { MissionPreparationStatus } from '../types.js';

export class RepositoryPreparationService {
	public constructor(
		private readonly store: FilesystemAdapter,
		private readonly githubRepository: string
	) { }

	public async prepareRepository(): Promise<MissionPreparationStatus> {
		const branchRef = this.store.deriveRepositoryBootstrapBranchName();
		const baseBranch = this.store.getDefaultBranch();
		const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-bootstrap-'));
		const proposalWorktreePath = path.join(temporaryRoot, 'bootstrap');

		try {
			await this.store.materializeLinkedWorktree(proposalWorktreePath, branchRef, baseBranch);
			await initializeMissionRepository(proposalWorktreePath);

			const proposalStore = new FilesystemAdapter(proposalWorktreePath);
			proposalStore.stagePaths(['.missions'], proposalWorktreePath);
			proposalStore.commit(this.buildCommitMessage(), proposalWorktreePath);
			proposalStore.pushBranch(branchRef, proposalWorktreePath);

			const github = new GitHubPlatformAdapter(proposalWorktreePath, this.githubRepository);
			const pullRequestUrl = await github.createPullRequest({
				title: 'Initialize Mission repository scaffolding',
				body: this.buildPullRequestBody(branchRef),
				headBranch: branchRef,
				baseBranch
			});

			return {
				kind: 'repository-bootstrap',
				state: 'pull-request-opened',
				branchRef,
				baseBranch,
				pullRequestUrl,
				controlDirectoryPath: getMissionDirectoryPath(this.store.getWorkspaceRoot()),
				settingsPath: getMissionDaemonSettingsPath(this.store.getWorkspaceRoot()),
				worktreesPath: getMissionWorktreesPath(this.store.getWorkspaceRoot()),
				missionsPath: getMissionCatalogPath(this.store.getWorkspaceRoot())
			};
		} finally {
			await this.store.removeLinkedWorktree(proposalWorktreePath).catch(() => undefined);
			await fs.rm(temporaryRoot, { recursive: true, force: true });
		}
	}

	private buildCommitMessage(): string {
		return 'chore(mission): initialize repository scaffolding';
	}

	private buildPullRequestBody(branchRef: string): string {
		return [
			'## Repository Bootstrap',
			'',
			'This PR initializes the tracked Mission repository scaffolding.',
			'',
			`- Branch: \`${branchRef}\``,
			'- Creates `.missions/` control directories.',
			'- Seeds `.missions/settings.json` with repository workflow defaults.',
			'- Prepares the repository for later mission authorization pull requests.',
			'',
			'After merge, pull the default branch before preparing a mission.'
		].join('\n');
	}
}
