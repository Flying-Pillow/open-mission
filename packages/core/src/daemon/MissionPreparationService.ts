import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Mission } from './mission/Mission.js';
import type { MissionWorkflowBindings } from './mission/Mission.js';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import { GitHubPlatformAdapter } from '../platforms/GitHubPlatformAdapter.js';
import type { MissionBrief, MissionDescriptor, MissionPreparationStatus } from '../types.js';

export class MissionPreparationService {
	public constructor(
		private readonly store: FilesystemAdapter,
		private readonly workflowBindings: MissionWorkflowBindings,
		private readonly githubRepository: string
	) { }

	public async prepareFromBrief(input: {
		brief: MissionBrief;
		branchRef?: string;
	}): Promise<MissionPreparationStatus> {
		const missionId = this.store.createMissionId(input.brief);
		const canonicalMissionRootDir = this.store.getTrackedMissionDir(missionId);
		const canonicalFlightDeckDir = this.store.getMissionFlightDeckPath(canonicalMissionRootDir);
		const branchRef =
			input.branchRef ??
			(input.brief.issueId !== undefined
				? this.store.deriveMissionBranchName(input.brief.issueId, input.brief.title)
				: this.store.deriveDraftMissionBranchName(input.brief.title));
		const baseBranch = this.store.getDefaultBranch();
		const createdAt = new Date().toISOString();

		const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-prepare-'));
		const proposalWorktreePath = path.join(temporaryRoot, missionId);
		let preparedMission: Mission | undefined;

		try {
			await this.store.materializeLinkedWorktree(proposalWorktreePath, branchRef, baseBranch);

			const proposalStore = new FilesystemAdapter(proposalWorktreePath);
			const missionRootDir = proposalStore.getTrackedMissionDir(missionId);
			const existingDossier = await fs.lstat(missionRootDir).then(
				(stats) => stats.isDirectory(),
				() => false
			);
			if (existingDossier) {
				throw new Error(`Mission dossier '${missionId}' already exists in the repository.`);
			}

			const descriptor: MissionDescriptor = {
				missionId,
				missionDir: missionRootDir,
				brief: input.brief,
				branchRef,
				createdAt
			};

			preparedMission = Mission.hydrate(
				proposalStore,
				missionRootDir,
				descriptor,
				this.workflowBindings
			);
			await preparedMission.initialize();
			preparedMission.dispose();
			preparedMission = undefined;

			proposalStore.stagePaths([
				path.relative(proposalWorktreePath, missionRootDir)
			], proposalWorktreePath);
			proposalStore.commit(this.buildCommitMessage(missionId, input.brief), proposalWorktreePath);
			proposalStore.pushBranch(branchRef, proposalWorktreePath);

			const github = new GitHubPlatformAdapter(proposalWorktreePath, this.githubRepository);
			const pullRequestUrl = await github.createPullRequest({
				title: this.buildPullRequestTitle(missionId, input.brief),
				body: this.buildPullRequestBody(missionId, branchRef, input.brief),
				headBranch: branchRef,
				baseBranch
			});

			return {
				kind: 'mission',
				state: 'pull-request-opened',
				missionId,
				branchRef,
				baseBranch,
				pullRequestUrl,
				missionRootDir: canonicalMissionRootDir,
				flightDeckDir: canonicalFlightDeckDir,
				...(input.brief.issueId !== undefined ? { issueId: input.brief.issueId } : {}),
				...(input.brief.url ? { issueUrl: input.brief.url } : {})
			};
		} finally {
			preparedMission?.dispose();
			await this.store.removeLinkedWorktree(proposalWorktreePath).catch(() => undefined);
			await fs.rm(temporaryRoot, { recursive: true, force: true });
		}
	}

	private buildCommitMessage(missionId: string, brief: MissionBrief): string {
		return `chore(mission): prepare ${missionId}${brief.issueId !== undefined ? ` for #${String(brief.issueId)}` : ''}`;
	}

	private buildPullRequestTitle(missionId: string, brief: MissionBrief): string {
		return brief.issueId !== undefined
			? `Prepare mission #${String(brief.issueId)}: ${brief.title}`
			: `Prepare mission ${missionId}: ${brief.title}`;
	}

	private buildPullRequestBody(missionId: string, branchRef: string, brief: MissionBrief): string {
		const issueLine = brief.issueId !== undefined
			? `Issue: #${String(brief.issueId)}`
			: 'Issue: Unattached';
		return [
			'## Mission Preparation',
			'',
			`This PR prepares the tracked mission dossier for \`${missionId}\`.`,
			'',
			`- ${issueLine}`,
			`- Branch: \`${branchRef}\``,
			'- Creates the initial tracked `flight-deck/` scaffold and brief descriptor.',
			'- Reserves the mission branch before local execution worktrees are materialized.',
			'',
			'## Brief',
			'',
			brief.body.trim()
		].join('\n');
	}
}
