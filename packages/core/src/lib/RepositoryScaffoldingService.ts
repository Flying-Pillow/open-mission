import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
    getRepositorySettingsPath,
} from './daemonConfig.js';
import {
    getMissionDirectoryPath,
    getMissionWorktreesPath
} from './repositoryPaths.js';
import { WorkflowSettingsStore } from '../settings/index.js';

export type RepositoryScaffolding = {
    controlDirectoryPath: string;
    settingsDocumentPath: string;
    workflowDirectoryPath: string;
    workflowDefinitionPath: string;
    workflowTemplatesPath: string;
    worktreesRoot: string;
};

export class RepositoryScaffoldingService {
    public constructor(private readonly workspaceRoot: string) { }

    public async initialize(): Promise<RepositoryScaffolding> {
        const controlDirectoryPath = getMissionDirectoryPath(this.workspaceRoot);
        const settingsDocumentPath = getRepositorySettingsPath(this.workspaceRoot, {
            resolveWorkspaceRoot: false
        });
        const worktreesRoot = getMissionWorktreesPath(this.workspaceRoot);

        await fs.mkdir(controlDirectoryPath, { recursive: true });
        await new WorkflowSettingsStore(this.workspaceRoot).initialize();
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
}