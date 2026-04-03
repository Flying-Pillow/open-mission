/**
 * @file packages/core/src/lib/repoPaths.ts
 * @description Resolves repository-root paths for the Mission package runtime.
 */

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MissionSelector } from '../types.js';
import { getMissionWorktreesPath } from './repoConfig.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export type MissionWorkspaceContext =
	| {
			kind: 'control-root';
			repoRoot: string;
			selector: MissionSelector;
	  }
	| {
			kind: 'mission-worktree';
			repoRoot: string;
			missionId: string;
			missionDir: string;
			selector: MissionSelector;
	  };

export function getRepoRoot(startPath = process.cwd()): string {
	return resolveGitControlRepoRoot(startPath) ?? path.resolve(currentDirectory, '../..');
}

export function resolveMissionWorkspaceContext(
	startPath = process.cwd(),
	repoRoot = getRepoRoot(startPath)
): MissionWorkspaceContext {
	const absoluteStartPath = path.resolve(startPath);
	const worktreesRoot = path.resolve(getMissionWorktreesPath(repoRoot));
	const relativeToWorktrees = path.relative(worktreesRoot, absoluteStartPath);
	if (
		relativeToWorktrees.length > 0 &&
		!relativeToWorktrees.startsWith('..') &&
		!path.isAbsolute(relativeToWorktrees)
	) {
		const [missionId] = relativeToWorktrees.split(path.sep).filter(Boolean);
		if (missionId) {
			return {
				kind: 'mission-worktree',
				repoRoot,
				missionId,
				missionDir: path.join(worktreesRoot, missionId),
				selector: { missionId }
			};
		}
	}

	return {
		kind: 'control-root',
		repoRoot,
		selector: {}
	};
}

export function resolveGitControlRepoRoot(startPath = process.cwd()): string | undefined {
	const commonDirectory = runGit(startPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
	if (commonDirectory) {
		return path.basename(commonDirectory) === '.git'
			? path.dirname(commonDirectory)
			: commonDirectory;
	}

	return runGit(startPath, ['rev-parse', '--path-format=absolute', '--show-toplevel']);
}

function runGit(startPath: string, args: string[]): string | undefined {
	try {
		const output = execFileSync('git', args, {
			cwd: startPath,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
		return output.length > 0 ? output : undefined;
	} catch {
		return undefined;
	}
}