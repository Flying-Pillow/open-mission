/**
 * @file apps/vscode-extension/src/MissionSettings.ts
 * @description Reads and resolves Mission workspace settings for operational root and repository content paths.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	getDefaultMissionRepoSettings,
	getMissionDirectoryPath,
	getMissionWorktreesPath,
	readMissionRepoSettings
} from '@flying-pillow/mission-core';

type MissionScope = vscode.WorkspaceFolder | vscode.Uri | undefined;

export class MissionSettings {
	public static getRootFolder(scope?: MissionScope): string | undefined {
		const rawValue = this.getConfiguration(scope).get<string>('rootFolder')?.trim();
		if (!rawValue) {
			return undefined;
		}

		const workspaceFolderPath = this.getWorkspaceFolder(scope)?.uri.fsPath;
		return this.resolvePath(rawValue, workspaceFolderPath ?? process.env.PWD ?? process.cwd(), scope);
	}

	public static resolveMissionFolderPath(rootPath: string, scope?: MissionScope): string {
		const configured = this.getConfiguration(scope).get<string>('missionFolder')?.trim();
		return this.resolvePath(configured || '.mission/worktrees', rootPath, scope) ?? getMissionWorktreesPath(rootPath);
	}

	public static resolveSkillsFolderPath(rootPath: string, scope?: MissionScope): string {
		const repoSettings = readMissionRepoSettings(rootPath);
		const configured = this.getConfiguration(scope).get<string>('skillsFolder')?.trim();
		const fallback = repoSettings?.skillsPath ?? getDefaultMissionRepoSettings().skillsPath ?? '.agents/skills';
		return this.resolvePath(configured || fallback, rootPath, scope) ?? path.join(rootPath, '.agents', 'skills');
	}

	public static resolveControlDirectoryPath(rootPath: string): string {
		return getMissionDirectoryPath(rootPath);
	}

	public static resolvePath(
		inputPath: string,
		basePath: string,
		scope?: MissionScope
	): string | undefined {
		const normalizedInput = inputPath.trim();
		if (!normalizedInput) {
			return undefined;
		}

		const workspaceFolderPath = this.getWorkspaceFolder(scope)?.uri.fsPath;
		const expandedInput = normalizedInput
			.replaceAll('${workspaceFolder}', workspaceFolderPath ?? '')
			.replaceAll('${PWD}', process.env.PWD ?? process.cwd());

		if (!expandedInput.trim()) {
			return undefined;
		}

		return path.isAbsolute(expandedInput)
			? path.normalize(expandedInput)
			: path.normalize(path.resolve(basePath, expandedInput));
	}

	private static getConfiguration(scope?: MissionScope): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration('mission', scope);
	}

	private static getWorkspaceFolder(scope?: MissionScope): vscode.WorkspaceFolder | undefined {
		if (!scope) {
			const activeUri = vscode.window.activeTextEditor?.document.uri;
			return activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
		}

		if ('uri' in scope && 'name' in scope && 'index' in scope) {
			return scope;
		}

		return vscode.workspace.getWorkspaceFolder(scope);
	}
}