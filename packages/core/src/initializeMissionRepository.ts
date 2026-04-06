import * as fs from 'node:fs/promises';
import {
	getMissionDaemonSettingsPath,
} from './lib/daemonConfig.js';
import {
	getMissionActivePath,
	getMissionCatalogPath,
	getMissionCompletedPath,
	getMissionDirectoryPath,
	getMissionPendingPath,
	getMissionWorktreesPath
} from './lib/repoConfig.js';
import { WorkflowSettingsStore } from './settings/index.js';

export type MissionRepositoryInitialization = {
	controlDirectoryPath: string;
	daemonSettingsPath: string;
	worktreesRoot: string;
};

export async function initializeMissionRepository(
	workspaceRoot: string
): Promise<MissionRepositoryInitialization> {
	// This is the low-level scaffolder used inside temporary proposal worktrees and tests.
	// Operator-facing repository initialization is routed through RepositoryPreparationService.
	const controlDirectoryPath = getMissionDirectoryPath(workspaceRoot);
	const daemonSettingsPath = getMissionDaemonSettingsPath(workspaceRoot, {
		resolveWorkspaceRoot: false
	});
	const worktreesRoot = getMissionWorktreesPath(workspaceRoot);
	const missionsRoot = getMissionCatalogPath(workspaceRoot);
	const pendingRoot = getMissionPendingPath(workspaceRoot);
	const activeRoot = getMissionActivePath(workspaceRoot);
	const completedRoot = getMissionCompletedPath(workspaceRoot);

	await Promise.all([
		fs.mkdir(controlDirectoryPath, { recursive: true }),
		fs.mkdir(missionsRoot, { recursive: true }),
		fs.mkdir(worktreesRoot, { recursive: true }),
		fs.mkdir(pendingRoot, { recursive: true }),
		fs.mkdir(activeRoot, { recursive: true }),
		fs.mkdir(completedRoot, { recursive: true })
	]);
	await new WorkflowSettingsStore(workspaceRoot).initialize();

	return {
		controlDirectoryPath,
		daemonSettingsPath,
		worktreesRoot
	};
}