/**
 * @file packages/core/src/lib/repoConfig.ts
 * @description Defines repo-scoped Mission control paths and local mission worktree roots.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { deriveRepositoryIdentity } from './repositoryIdentity.js';

export const MISSION_DIRECTORY = '.mission';
export const DEFAULT_MISSION_WORKSPACE_ROOT = 'missions';
export const MISSION_WORKFLOW_DIRECTORY = 'workflow';
export const MISSION_WORKFLOW_DEFINITION_FILE = 'workflow.json';

export function getMissionDirectoryPath(controlRoot: string): string {
	return path.join(controlRoot, MISSION_DIRECTORY);
}

export function getMissionCatalogPath(checkoutRoot: string): string {
	return path.join(getMissionDirectoryPath(checkoutRoot), 'missions');
}

export function getMissionWorkflowPath(controlRoot: string): string {
	return path.join(getMissionDirectoryPath(controlRoot), MISSION_WORKFLOW_DIRECTORY);
}

export function getMissionWorkflowDefinitionPath(controlRoot: string): string {
	return path.join(getMissionWorkflowPath(controlRoot), MISSION_WORKFLOW_DEFINITION_FILE);
}

export function getMissionWorkflowTemplatesPath(controlRoot: string): string {
	return path.join(getMissionWorkflowPath(controlRoot), 'templates');
}

export function getMissionControlRootFromMissionDir(missionDir: string): string {
	return path.resolve(missionDir, '..', '..', '..');
}

export function resolveMissionWorkspaceRoot(
	configuredRoot = DEFAULT_MISSION_WORKSPACE_ROOT
): string {
	const normalizedRoot = configuredRoot.trim() || DEFAULT_MISSION_WORKSPACE_ROOT;
	const configuredMissionsPath = process.env['MISSIONS_PATH']?.trim();
	if (normalizedRoot === DEFAULT_MISSION_WORKSPACE_ROOT && configuredMissionsPath) {
		return path.resolve(configuredMissionsPath);
	}
	if (path.isAbsolute(normalizedRoot)) {
		return path.resolve(normalizedRoot);
	}
	if (normalizedRoot === '~') {
		return os.homedir();
	}
	if (normalizedRoot.startsWith(`~${path.sep}`)) {
		return path.join(os.homedir(), normalizedRoot.slice(2));
	}
	return path.resolve(os.homedir(), normalizedRoot);
}

export function getMissionWorktreesPath(
	controlRoot: string,
	options: { missionWorkspaceRoot?: string } = {}
): string {
	const repositoryIdentity = deriveRepositoryIdentity(controlRoot);
	if (repositoryIdentity.githubRepository) {
		const [owner, repository] = repositoryIdentity.githubRepository.split('/');
		if (owner && repository) {
			return path.join(
				resolveMissionWorkspaceRoot(options.missionWorkspaceRoot),
				owner,
				repository
			);
		}
	}

	return path.join(
		resolveMissionWorkspaceRoot(options.missionWorkspaceRoot),
		path.basename(path.resolve(controlRoot))
	);
}