/**
 * @file packages/core/src/lib/repoConfig.ts
 * @description Defines repo-scoped Mission control paths and local mission worktree roots.
 */

import * as os from 'node:os';
import * as path from 'node:path';

export const MISSION_DIRECTORY = '.mission';
export const DEFAULT_MISSION_WORKSPACE_ROOT = 'missions';

export function getMissionDirectoryPath(controlRoot: string): string {
	return path.join(controlRoot, MISSION_DIRECTORY);
}

export function getMissionCatalogPath(checkoutRoot: string): string {
	return path.join(getMissionDirectoryPath(checkoutRoot), 'missions');
}

export function resolveMissionWorkspaceRoot(
	configuredRoot = DEFAULT_MISSION_WORKSPACE_ROOT
): string {
	const normalizedRoot = configuredRoot.trim() || DEFAULT_MISSION_WORKSPACE_ROOT;
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
	return path.join(
		resolveMissionWorkspaceRoot(options.missionWorkspaceRoot),
		path.basename(path.resolve(controlRoot))
	);
}