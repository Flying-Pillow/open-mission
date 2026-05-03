import type {
	MissionBrief,
	MissionArtifactKey,
	MissionStageId,
	MissionTaskAgent,
	MissionTaskStatus
} from '../../../types.js';
import type { TemplateObject } from '../../engine/templates/templateRenderer.js';

export type MissionProductTemplate = {
	key: MissionArtifactKey;
	templatePath: string;
};

export type MissionTaskTemplate = {
	fileName: string;
	subject: string;
	instruction: string;
	taskKind?: 'implementation' | 'verification';
	pairedTaskId?: string;
	dependsOn?: string[];
	agent: MissionTaskAgent;
	status?: MissionTaskStatus;
	retries?: number;
};

export type MissionTaskTemplateRef = {
	templatePath: string;
};

export type MissionStageTemplateDefinition = {
	artifacts: MissionProductTemplate[];
	defaultTasks: MissionTaskTemplateRef[];
};

export type MissionStageTemplateDefinitions = Record<
	MissionStageId,
	MissionStageTemplateDefinition
>;

export type MissionTemplateContext = TemplateObject & {
	mission: {
		id: string;
		title: string;
		branchRef: string;
		issueLine: string;
		dossierPath: string;
		briefPath: string;
		prdPath: string;
		specPath: string;
		verifyPath: string;
		auditPath: string;
		deliveryPath: string;
		implementationTasksPath: string;
	};
	brief: {
		body: string;
	};
};

export type MissionTemplateContextInput = {
	missionId: string;
	controlRoot: string;
	brief: MissionBrief;
	branchRef: string;
};