/**
 * @file apps/vscode-extension/src/MissionWorkspaceResolver.ts
 * @description Resolves the operational Mission workspace root from the current VS Code workspace context.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	resolveGitWorkspaceRoot,
	resolveMissionWorkspaceContext,
	type MissionWorkspaceContext
} from '@flying-pillow/mission-core';
import { MissionSettings } from './MissionSettings.js';

type WorkspaceCandidate = {
	path: string;
	scope?: vscode.WorkspaceFolder | vscode.Uri;
};

export type ResolvedMissionWorkspace = {
	workspaceRoot: string;
	workspaceContext: MissionWorkspaceContext;
	resolvedPath: string;
};

export class MissionWorkspaceResolver {
	public static async resolveOperationalRoot(preferredUri?: vscode.Uri): Promise<string | undefined> {
		return (await this.resolveWorkspaceContext(preferredUri))?.workspaceRoot;
	}

	public static async resolveWorkspaceContext(
		preferredUri?: vscode.Uri
	): Promise<ResolvedMissionWorkspace | undefined> {
		const candidates = this.collectCandidates(preferredUri);
		for (const candidate of candidates) {
			const configuredRoot = MissionSettings.getRootFolder(candidate.scope);
			if (configuredRoot && (await this.pathExists(configuredRoot))) {
				const workspaceRoot =
					resolveGitWorkspaceRoot(candidate.path)
					?? resolveGitWorkspaceRoot(configuredRoot)
					?? configuredRoot;
				return {
					workspaceRoot,
					workspaceContext: resolveMissionWorkspaceContext(candidate.path, workspaceRoot),
					resolvedPath: candidate.path
				};
			}

			const controlGitWorkspaceRoot = resolveGitWorkspaceRoot(candidate.path);
			if (controlGitWorkspaceRoot) {
				return {
					workspaceRoot: controlGitWorkspaceRoot,
					workspaceContext: resolveMissionWorkspaceContext(candidate.path, controlGitWorkspaceRoot),
					resolvedPath: candidate.path
				};
			}

			const localWorkspaceRoot = await this.findAncestor(candidate.path, async (currentPath) =>
				this.pathExists(MissionSettings.resolveControlDirectoryPath(currentPath))
			);
			if (localWorkspaceRoot) {
				return {
					workspaceRoot: localWorkspaceRoot,
					workspaceContext: resolveMissionWorkspaceContext(candidate.path, localWorkspaceRoot),
					resolvedPath: candidate.path
				};
			}

			const configuredMarkerRoot = await this.findAncestor(candidate.path, async (currentPath) => {
				const missionFolderPath = MissionSettings.resolveMissionFolderPath(
					currentPath,
					candidate.scope
				);
				if (await this.pathExists(missionFolderPath)) {
					return true;
				}

				const skillsFolderPath = MissionSettings.resolveSkillsFolderPath(
					currentPath,
					candidate.scope
				);
				return this.pathExists(skillsFolderPath);
			});
			if (configuredMarkerRoot) {
				return {
					workspaceRoot: configuredMarkerRoot,
					workspaceContext: resolveMissionWorkspaceContext(candidate.path, configuredMarkerRoot),
					resolvedPath: candidate.path
				};
			}

			const monorepoWorkspaceRoot = await this.findAncestor(candidate.path, async (currentPath) =>
				this.pathExists(path.join(currentPath, 'pnpm-workspace.yaml'))
			);
			if (monorepoWorkspaceRoot) {
				return {
					workspaceRoot: monorepoWorkspaceRoot,
					workspaceContext: resolveMissionWorkspaceContext(candidate.path, monorepoWorkspaceRoot),
					resolvedPath: candidate.path
				};
			}

			const gitRoot = await this.findAncestor(candidate.path, async (currentPath) =>
				this.pathExists(path.join(currentPath, '.git'))
			);
			if (gitRoot) {
				return {
					workspaceRoot: gitRoot,
					workspaceContext: resolveMissionWorkspaceContext(candidate.path, gitRoot),
					resolvedPath: candidate.path
				};
			}
		}

		const fallbackPath = candidates[0]?.path;
		if (!fallbackPath) {
			return undefined;
		}
		return {
			workspaceRoot: fallbackPath,
			workspaceContext: resolveMissionWorkspaceContext(fallbackPath, fallbackPath),
			resolvedPath: fallbackPath
		};
	}

	private static collectCandidates(preferredUri?: vscode.Uri): WorkspaceCandidate[] {
		const candidates: WorkspaceCandidate[] = [];
		const addCandidate = (candidatePath: string | undefined, scope?: vscode.WorkspaceFolder | vscode.Uri) => {
			if (!candidatePath) {
				return;
			}

			if (!candidates.some((candidate) => candidate.path === candidatePath)) {
				candidates.push({ path: candidatePath, scope });
			}
		};

		if (preferredUri?.scheme === 'file') {
			const preferredWorkspaceFolder = vscode.workspace.getWorkspaceFolder(preferredUri);
			addCandidate(path.dirname(preferredUri.fsPath), preferredWorkspaceFolder ?? preferredUri);
			addCandidate(preferredWorkspaceFolder?.uri.fsPath, preferredWorkspaceFolder);
		}

		const activeDocumentUri = vscode.window.activeTextEditor?.document.uri;
		if (activeDocumentUri?.scheme === 'file') {
			const activeWorkspaceFolder = vscode.workspace.getWorkspaceFolder(activeDocumentUri);
			addCandidate(path.dirname(activeDocumentUri.fsPath), activeWorkspaceFolder ?? activeDocumentUri);
			addCandidate(activeWorkspaceFolder?.uri.fsPath, activeWorkspaceFolder);
		}

		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			addCandidate(folder.uri.fsPath, folder);
		}

		return candidates;
	}

	private static async findAncestor(
		startPath: string,
		predicate: (candidatePath: string) => Promise<boolean>
	): Promise<string | undefined> {
		let currentPath = startPath;
		while (true) {
			if (await predicate(currentPath)) {
				return currentPath;
			}

			const parentPath = path.dirname(currentPath);
			if (parentPath === currentPath) {
				return undefined;
			}

			currentPath = parentPath;
		}
	}

	private static async pathExists(candidatePath: string): Promise<boolean> {
		try {
			await fs.stat(candidatePath);
			return true;
		} catch {
			return false;
		}
	}
}