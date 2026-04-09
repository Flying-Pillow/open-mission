import * as fs from 'node:fs/promises';
import {
	getMissionDaemonSettingsPath,
} from './lib/daemonConfig.js';
import {
	getMissionCatalogPath,
	getMissionDirectoryPath,
	getMissionWorktreesPath
} from './lib/repoConfig.js';
import { WorkflowSettingsStore } from './settings/index.js';

export type MissionRepositoryInitialization = {
	controlDirectoryPath: string;
	daemonSettingsPath: string;
	worktreesRoot: string;
};

export type InitializeMissionRepositoryOptions = {
	includeRuntimeDirectories?: boolean;
};

export async function initializeMissionRepository(
	workspaceRoot: string,
	options: InitializeMissionRepositoryOptions = {}
): Promise<MissionRepositoryInitialization> {
	// This is the low-level scaffolder used inside temporary proposal worktrees and tests.
	// Operator-facing repository initialization is routed through RepositoryPreparationService.
	const controlDirectoryPath = getMissionDirectoryPath(workspaceRoot);
	const daemonSettingsPath = getMissionDaemonSettingsPath(workspaceRoot, {
		resolveWorkspaceRoot: false
	});
	const worktreesRoot = getMissionWorktreesPath(workspaceRoot);
	const missionsRoot = getMissionCatalogPath(workspaceRoot);
 	const includeRuntimeDirectories = options.includeRuntimeDirectories !== false;

	const directoriesToCreate = [
		fs.mkdir(controlDirectoryPath, { recursive: true }),
		fs.mkdir(missionsRoot, { recursive: true })
	];
	if (includeRuntimeDirectories) {
		directoriesToCreate.push(
			fs.mkdir(worktreesRoot, { recursive: true })
		);
	}

	await Promise.all(directoriesToCreate);
	await new WorkflowSettingsStore(workspaceRoot).initialize();

	return {
		controlDirectoryPath,
		daemonSettingsPath,
		worktreesRoot
	};
}