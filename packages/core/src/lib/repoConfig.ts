/**
 * @file packages/core/src/lib/repoConfig.ts
 * @description Defines workspace control-state path helpers under the local .missions directory.
 */

import * as path from 'node:path';

export const MISSION_DIRECTORY = '.missions';

export function getMissionDirectoryPath(controlRoot: string): string {
	return path.join(controlRoot, MISSION_DIRECTORY);
}

export function getMissionWorktreesPath(controlRoot: string): string {
	return getMissionActivePath(controlRoot);
}

export function getMissionPendingPath(controlRoot: string): string {
	return path.join(getMissionDirectoryPath(controlRoot), 'pending');
}

export function getMissionActivePath(controlRoot: string): string {
	return path.join(getMissionDirectoryPath(controlRoot), 'active');
}

export function getMissionCompletedPath(controlRoot: string): string {
	return path.join(getMissionDirectoryPath(controlRoot), 'completed');
}