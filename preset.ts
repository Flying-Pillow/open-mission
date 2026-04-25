import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkflowGlobalSettings } from '../engine/types.js';
import {
	createDefaultRepositoryWorkflowSettingsDocument
} from '../../entities/Repository/RepositorySettingsDocument.js';
import {
	resolveWorkflowSettingsDocument,
	writeWorkflowSettingsDocument
} from '../../lib/daemonConfig.js';
import {
	getMissionWorkflowDefinitionPath,
	getMissionWorkflowPath,
	getMissionWorkflowTemplatesPath
} from '../../lib/repoConfig.js';

const packagedTemplateDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

export type MissionWorkflowPresetScaffold = {
	workflowDirectoryPath: string;
	workflowDefinitionPath: string;
	workflowTemplatesPath: string;
};

export async function scaffoldMissionWorkflowPreset(
	controlRoot: string,
	options: { overwrite?: boolean } = {}
): Promise<MissionWorkflowPresetScaffold> {
	const workflowDirectoryPath = getMissionWorkflowPath(controlRoot);
	const workflowDefinitionPath = getMissionWorkflowDefinitionPath(controlRoot);
	const workflowTemplatesPath = getMissionWorkflowTemplatesPath(controlRoot);

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
	await writeWorkflowSettingsDocument(createDefaultRepositoryWorkflowSettingsDocument(), controlRoot, {
		resolveWorkspaceRoot: false
	});

	return {
		workflowDirectoryPath,
		workflowDefinitionPath,
		workflowTemplatesPath
	};
}

export function readMissionWorkflowDefinition(controlRoot: string): unknown | undefined {
	const workflowPath = getMissionWorkflowDefinitionPath(controlRoot);
	try {
		const content = fs.readFileSync(workflowPath, 'utf8').trim();
		if (!content) {
			return undefined;
		}
		const parsed = resolveWorkflowSettingsDocument(JSON.parse(content) as unknown);
		return parsed.workflow;
	} catch {
		return undefined;
	}
}

export async function writeMissionWorkflowDefinition(
	controlRoot: string,
	workflow: WorkflowGlobalSettings
): Promise<WorkflowGlobalSettings> {
	const currentDocument = resolveWorkflowSettingsDocument(
		readMissionWorkflowDefinitionDocument(controlRoot) ?? createDefaultRepositoryWorkflowSettingsDocument()
	);
	const nextDocument = resolveWorkflowSettingsDocument({
		...currentDocument,
		workflow
	});
	await writeWorkflowSettingsDocument(nextDocument, controlRoot, {
		resolveWorkspaceRoot: false
	});
	return nextDocument.workflow;
}

function readMissionWorkflowDefinitionDocument(controlRoot: string): unknown | undefined {
	const workflowPath = getMissionWorkflowDefinitionPath(controlRoot);
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