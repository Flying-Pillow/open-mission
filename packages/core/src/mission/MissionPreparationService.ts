import * as path from 'node:path';
import { MissionRuntime } from './Mission.js';
import type { MissionWorkflowBindings } from './Mission.js';
import { initializeRepository } from '../repository/initializeRepository.js';
import { readMissionDaemonSettings } from '../lib/daemonConfig.js';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import type { MissionBrief, MissionDescriptor, MissionPreparationStatus } from '../types.js';

export class MissionPreparationService {
	public constructor(
		private readonly store: FilesystemAdapter,
		private readonly workflowBindings: MissionWorkflowBindings
	) { }

	public async prepareFromBrief(input: {
		brief: MissionBrief;
		branchRef?: string;
	}): Promise<MissionPreparationStatus> {
		const missionId = this.store.createMissionId(input.brief);
		const canonicalMissionRootDir = this.store.getTrackedMissionDir(missionId);
		const branchRef =
			input.branchRef ??
			(input.brief.issueId !== undefined
				? this.store.deriveMissionBranchName(input.brief.issueId, input.brief.title)
				: this.store.deriveDraftMissionBranchName(input.brief.title));
		const baseBranch = this.store.getDefaultBranch();
		const createdAt = new Date().toISOString();
		const proposalWorktreePath = this.store.getMissionWorktreePath(missionId);
		let preparedMission: MissionRuntime | undefined;

		try {
			await this.store.materializeMissionWorktree(proposalWorktreePath, branchRef, baseBranch);

			const proposalStore = new FilesystemAdapter(proposalWorktreePath);
			const initialization = readMissionDaemonSettings(proposalWorktreePath)
				? undefined
				: await initializeRepository(proposalWorktreePath, {
					includeRuntimeDirectories: false
				});
			const missionRootDir = proposalStore.getTrackedMissionDir(missionId, proposalWorktreePath);
			const existingDescriptor = await proposalStore.readMissionDescriptor(missionRootDir);
			if (existingDescriptor) {
				return {
					kind: 'mission',
					state: 'branch-prepared',
					missionId,
					branchRef: existingDescriptor.branchRef,
					baseBranch,
					worktreePath: proposalWorktreePath,
					missionRootDir,
					...(input.brief.issueId !== undefined ? { issueId: input.brief.issueId } : {}),
					...(input.brief.url ? { issueUrl: input.brief.url } : {})
				};
			}

			const descriptor: MissionDescriptor = {
				missionId,
				missionDir: missionRootDir,
				brief: input.brief,
				branchRef,
				createdAt
			};

			preparedMission = MissionRuntime.hydrate(
				proposalStore,
				missionRootDir,
				descriptor,
				this.workflowBindings
			);
			await preparedMission.initialize();
			preparedMission.dispose();
			preparedMission = undefined;

			proposalStore.stagePaths(
				[
					...(initialization
						? [
							path.relative(proposalWorktreePath, initialization.daemonSettingsPath),
							path.relative(proposalWorktreePath, initialization.workflowDirectoryPath)
						]
						: []),
					path.relative(proposalWorktreePath, missionRootDir)
				],
				proposalWorktreePath,
				{ force: true }
			);
			proposalStore.commit(this.buildCommitMessage(missionId, input.brief), proposalWorktreePath);
			proposalStore.pushBranch(branchRef, proposalWorktreePath);

			return {
				kind: 'mission',
				state: 'branch-prepared',
				missionId,
				branchRef,
				baseBranch,
				worktreePath: proposalWorktreePath,
				missionRootDir: canonicalMissionRootDir,
				...(input.brief.issueId !== undefined ? { issueId: input.brief.issueId } : {}),
				...(input.brief.url ? { issueUrl: input.brief.url } : {})
			};
		} finally {
			preparedMission?.dispose();
		}
	}

	private buildCommitMessage(missionId: string, brief: MissionBrief): string {
		return `chore(mission): prepare ${missionId}${brief.issueId !== undefined ? ` for #${String(brief.issueId)}` : ''}`;
	}

}
