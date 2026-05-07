import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkflowDefinition } from '../engine/types.js';
import { Repository } from '../../entities/Repository/Repository.js';
import { createDefaultWorkflowSettings } from './workflow.js';

const packagedTemplateDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

export type MissionWorkflowPresetScaffold = {
	workflowDirectoryPath: string;
	workflowDefinitionPath: string;
	workflowTemplatesPath: string;
};

export async function scaffoldMissionWorkflowPreset(
	repositoryRoot: string,
	options: { overwrite?: boolean } = {}
): Promise<MissionWorkflowPresetScaffold> {
	const workflowDirectoryPath = Repository.getMissionWorkflowPath(repositoryRoot);
	const workflowDefinitionPath = Repository.getMissionWorkflowDefinitionPath(repositoryRoot);
	const workflowTemplatesPath = Repository.getMissionWorkflowTemplatesPath(repositoryRoot);

	await fsp.mkdir(workflowDirectoryPath, { recursive: true });
	await fsp.mkdir(workflowTemplatesPath, { recursive: true });
	if (options.overwrite === true) {
		await fsp.rm(workflowTemplatesPath, { recursive: true, force: true });
		await fsp.mkdir(workflowTemplatesPath, { recursive: true });
	}
	await fsp.cp(packagedTemplateDirectory, workflowTemplatesPath, {
		recursive: true,
		force: options.overwrite === true
	});
	await writeMissionWorkflowDefinition(repositoryRoot, createDefaultWorkflowSettings());

	return {
		workflowDirectoryPath,
		workflowDefinitionPath,
		workflowTemplatesPath
	};
}

export function readMissionWorkflowDefinition(repositoryRoot: string): unknown | undefined {
	const workflowPath = Repository.getMissionWorkflowDefinitionPath(repositoryRoot);
	try {
		const content = fs.readFileSync(workflowPath, 'utf8').trim();
		if (!content) {
			return undefined;
		}
		return JSON.parse(content) as unknown;
	} catch {
		return undefined;
	}
}

export async function writeMissionWorkflowDefinition(
	repositoryRoot: string,
	workflow: WorkflowDefinition
): Promise<WorkflowDefinition> {
	const workflowPath = Repository.getMissionWorkflowDefinitionPath(repositoryRoot);
	const temporaryPath = `${workflowPath}.${process.pid.toString(36)}.${Date.now().toString(36)}.tmp`;
	await fsp.mkdir(path.dirname(workflowPath), { recursive: true });
	await fsp.writeFile(temporaryPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
	await fsp.rename(temporaryPath, workflowPath);
	return workflow;
}