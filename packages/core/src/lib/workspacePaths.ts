/**
 * @file packages/core/src/lib/workspacePaths.ts
 * @description Resolves local control-root and mission workspace paths for the Mission runtime.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repository } from '../entities/Repository/Repository.js';
import type { MissionSelector } from '../types.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export type MissionWorkspaceContext =
    | {
        kind: 'control-root';
        workspaceRoot: string;
        selector: MissionSelector;
    }
    | {
        kind: 'mission-worktree';
        workspaceRoot: string;
        missionId: string;
        missionRootDir: string;
        missionDir: string;
        selector: MissionSelector;
    };

export function getWorkspaceRoot(startPath = process.cwd()): string {
    return resolveGitWorkspaceRoot(startPath) ?? path.resolve(currentDirectory, '../..');
}

export function resolveMissionWorkspaceContext(
    startPath = process.cwd(),
    workspaceRoot = getWorkspaceRoot(startPath)
): MissionWorkspaceContext {
    const absoluteStartPath = path.resolve(startPath);
    const checkoutRoot = resolveGitCheckoutRoot(startPath);
    if (checkoutRoot && path.resolve(checkoutRoot) !== path.resolve(workspaceRoot)) {
        const missionContext = resolveMissionCheckoutContext(checkoutRoot);
        if (missionContext) {
            return {
                kind: 'mission-worktree',
                workspaceRoot,
                missionId: missionContext.missionId,
                missionRootDir: missionContext.missionRootDir,
                missionDir: checkoutRoot,
                selector: { missionId: missionContext.missionId }
            };
        }
    }
    const worktreesRoot = path.resolve(Repository.getMissionWorktreesPath(workspaceRoot));
    const relativeToWorktrees = path.relative(worktreesRoot, absoluteStartPath);
    if (
        relativeToWorktrees.length > 0
        && !relativeToWorktrees.startsWith('..')
        && !path.isAbsolute(relativeToWorktrees)
    ) {
        const [missionId] = relativeToWorktrees.split(path.sep).filter(Boolean);
        if (missionId) {
            const missionDir = path.join(worktreesRoot, missionId);
            const missionRootDir = path.join(Repository.getMissionCatalogPath(missionDir), missionId);
            return {
                kind: 'mission-worktree',
                workspaceRoot,
                missionId,
                missionRootDir,
                missionDir,
                selector: { missionId }
            };
        }
    }

    return {
        kind: 'control-root',
        workspaceRoot,
        selector: {}
    };
}

export function resolveGitWorkspaceRoot(startPath = process.cwd()): string | undefined {
    const commonDirectory = runGit(startPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (commonDirectory) {
        return path.basename(commonDirectory) === '.git'
            ? path.dirname(commonDirectory)
            : commonDirectory;
    }

    return runGit(startPath, ['rev-parse', '--path-format=absolute', '--show-toplevel']);
}

function resolveGitCheckoutRoot(startPath = process.cwd()): string | undefined {
    return runGit(startPath, ['rev-parse', '--path-format=absolute', '--show-toplevel']);
}

function resolveMissionCheckoutContext(checkoutRoot: string): { missionId: string; missionRootDir: string } | undefined {
    const missionsRoot = Repository.getMissionCatalogPath(checkoutRoot);
    try {
        const entries = fs.readdirSync(missionsRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory());
        if (entries.length !== 1) {
            return undefined;
        }
        const missionId = entries[0]!.name;
        return {
            missionId,
            missionRootDir: path.join(missionsRoot, missionId)
        };
    } catch {
        return undefined;
    }
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