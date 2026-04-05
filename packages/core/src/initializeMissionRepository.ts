import * as fs from 'node:fs/promises';
import {
	ensureMissionDaemonSettings,
	getMissionDaemonSettingsPath,
} from './lib/daemonConfig.js';
import {
	getMissionActivePath,
	getMissionCompletedPath,
	getMissionDirectoryPath,
	getMissionPendingPath,
	getMissionWorktreesPath
} from './lib/repoConfig.js';

export type MissionRepositoryInitialization = {
	controlDirectoryPath: string;
	daemonSettingsPath: string;
	worktreesRoot: string;
};

export async function initializeMissionRepository(
	workspaceRoot: string
): Promise<MissionRepositoryInitialization> {
	const controlDirectoryPath = getMissionDirectoryPath(workspaceRoot);
	const daemonSettingsPath = getMissionDaemonSettingsPath(workspaceRoot);
	const worktreesRoot = getMissionWorktreesPath(workspaceRoot);
	const pendingRoot = getMissionPendingPath(workspaceRoot);
	const activeRoot = getMissionActivePath(workspaceRoot);
	const completedRoot = getMissionCompletedPath(workspaceRoot);

	await Promise.all([
		fs.mkdir(controlDirectoryPath, { recursive: true }),
		fs.mkdir(worktreesRoot, { recursive: true }),
		fs.mkdir(pendingRoot, { recursive: true }),
		fs.mkdir(activeRoot, { recursive: true }),
		fs.mkdir(completedRoot, { recursive: true })
	]);
	await ensureMissionDaemonSettings(workspaceRoot);

	return {
		controlDirectoryPath,
		daemonSettingsPath,
		worktreesRoot
	};
}