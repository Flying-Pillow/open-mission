import * as fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
	getMissionDaemonSettingsPath,
	getMissionDirectoryPath,
	getMissionWorktreesPath,
	readMissionDaemonSettings,
	type MissionDaemonSettings
} from '@flying-pillow/mission-core';

export type CockpitRepoState = {
	workspaceRoot: string;
	missionDirectoryPath: string;
	missionsRoot: string;
	settingsPath: string;
	isGitRepository: boolean;
	currentBranch?: string;
	isMissionInitialized: boolean;
	settings?: MissionDaemonSettings;
	trackingEnabled: boolean;
	hasDetachedHead: boolean;
};

export async function detectCockpitRepoState(workspaceRoot: string): Promise<CockpitRepoState> {
	const missionDirectoryPath = getMissionDirectoryPath(workspaceRoot);
	const missionsRoot = getMissionWorktreesPath(workspaceRoot);
	const settingsPath = getMissionDaemonSettingsPath(workspaceRoot);
	const settings = readMissionDaemonSettings(workspaceRoot);
	const isMissionInitialized = await Promise.all([
		pathExists(missionDirectoryPath),
		pathExists(missionsRoot)
	]).then(([hasMissionDirectory, hasMissionsRoot]) => hasMissionDirectory && hasMissionsRoot);
	const isGitRepository = runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree']) === 'true';
	const rawBranch = isGitRepository ? runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) : undefined;
	const currentBranch = rawBranch && rawBranch.length > 0 ? rawBranch : undefined;

	return {
		workspaceRoot,
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

function runGit(workspaceRoot: string, args: string[]): string | undefined {
	const result = spawnSync('git', args, {
		cwd: workspaceRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore']
	});
	if (result.status !== 0) {
		return undefined;
	}
	const output = result.stdout.trim();
	return output.length > 0 ? output : undefined;
}
