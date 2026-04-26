import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
	getRepositorySettingsPath,
} from '../../lib/daemonConfig.js';
import {
	getMissionDirectoryPath,
	getMissionWorktreesPath
} from './RepositoryPaths.js';
import { WorkflowSettingsStore } from '../../settings/index.js';

export type RepositoryInitialization = {
	controlDirectoryPath: string;
	settingsDocumentPath: string;
	workflowDirectoryPath: string;
	workflowDefinitionPath: string;
	workflowTemplatesPath: string;
	worktreesRoot: string;
};

export type InitializeRepositoryOptions = {
	includeRuntimeDirectories?: boolean;
};

export async function initializeRepository(
	workspaceRoot: string,
	options: InitializeRepositoryOptions = {}
): Promise<RepositoryInitialization> {
	// This is the low-level scaffolder used inside temporary proposal worktrees and tests.
	// Operator-facing repository initialization is routed through RepositoryPreparationService.
	const controlDirectoryPath = getMissionDirectoryPath(workspaceRoot);
	const settingsDocumentPath = getRepositorySettingsPath(workspaceRoot, {
		resolveWorkspaceRoot: false
	});
	const worktreesRoot = getMissionWorktreesPath(workspaceRoot);
	void options;

	const directoriesToCreate = [
		fs.mkdir(controlDirectoryPath, { recursive: true })
	];

	await Promise.all(directoriesToCreate);
	await new WorkflowSettingsStore(workspaceRoot).initialize();
	const workflowDirectoryPath = path.join(controlDirectoryPath, 'workflow');
	const workflowDefinitionPath = path.join(workflowDirectoryPath, 'workflow.json');
	const workflowTemplatesPath = path.join(workflowDirectoryPath, 'templates');

	return {
		controlDirectoryPath,
		settingsDocumentPath,
		workflowDirectoryPath,
		workflowDefinitionPath,
		workflowTemplatesPath,
		worktreesRoot
	};
}