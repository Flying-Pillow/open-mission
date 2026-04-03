import * as fs from 'node:fs/promises';
import {
	getDefaultMissionRepoSettingsWithOverrides,
	getMissionDirectoryPath,
	getMissionWorktreesPath,
	getMissionSettingsPath
} from './lib/repoConfig.js';

export type MissionRepositoryInitialization = {
	controlDirectoryPath: string;
	settingsPath: string;
	worktreesRoot: string;
};

export async function initializeMissionRepository(
	repoRoot: string
): Promise<MissionRepositoryInitialization> {
	const controlDirectoryPath = getMissionDirectoryPath(repoRoot);
	const settingsPath = getMissionSettingsPath(repoRoot);
	const worktreesRoot = getMissionWorktreesPath(repoRoot);

	await Promise.all([
		fs.mkdir(controlDirectoryPath, { recursive: true }),
		fs.mkdir(worktreesRoot, { recursive: true })
	]);

	const settings = getDefaultMissionRepoSettingsWithOverrides();

	await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

	return {
		controlDirectoryPath,
		settingsPath,
		worktreesRoot
	};
}