import * as fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
	getMissionDirectoryPath,
	getMissionMissionsPath,
	getMissionSettingsPath,
	readMissionRepoSettings,
	type MissionRepoSettings
} from '@flying-pillow/mission-core';

export type CockpitRepoState = {
	repoRoot: string;
	missionDirectoryPath: string;
	missionsRoot: string;
	settingsPath: string;
	isGitRepository: boolean;
	currentBranch?: string;
	isMissionInitialized: boolean;
	settings?: MissionRepoSettings;
	trackingEnabled: boolean;
	hasDetachedHead: boolean;
};

export async function detectCockpitRepoState(repoRoot: string): Promise<CockpitRepoState> {
	const missionDirectoryPath = getMissionDirectoryPath(repoRoot);
	const missionsRoot = getMissionMissionsPath(repoRoot);
	const settingsPath = getMissionSettingsPath(repoRoot);
	const settings = readMissionRepoSettings(repoRoot);
	const isMissionInitialized = await pathExists(settingsPath);
	const isGitRepository = runGit(repoRoot, ['rev-parse', '--is-inside-work-tree']) === 'true';
	const rawBranch = isGitRepository ? runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) : undefined;
	const currentBranch = rawBranch && rawBranch.length > 0 ? rawBranch : undefined;

	return {
		repoRoot,
		missionDirectoryPath,
		missionsRoot,
		settingsPath,
		isGitRepository,
		...(currentBranch ? { currentBranch } : {}),
		isMissionInitialized,
		...(settings ? { settings } : {}),
		trackingEnabled: settings?.trackingProvider === 'github',
		hasDetachedHead: currentBranch === 'HEAD'
	};
}

async function pathExists(candidatePath: string): Promise<boolean> {
	try {
		await fs.access(candidatePath);
		return true;
	} catch {
		return false;
	}
}

function runGit(repoRoot: string, args: string[]): string | undefined {
	const result = spawnSync('git', args, {
		cwd: repoRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore']
	});
	if (result.status !== 0) {
		return undefined;
	}
	const output = result.stdout.trim();
	return output.length > 0 ? output : undefined;
}