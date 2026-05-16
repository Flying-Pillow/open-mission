import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTemplateFile } from '../../engine/templates/templateRepository.js';
import { renderTemplate } from '../../engine/templates/templateRenderer.js';
import { renderMissionTitle } from './common.js';
import { parseFrontmatterDocument } from '../../../lib/frontmatter.js';
import { Repository } from '../../../entities/Repository/Repository.js';
import { DEFAULT_REPOSITORY_AGENT_ADAPTER_ID } from '../../../entities/Repository/RepositorySchema.js';
import type { MissionTaskAgent } from '../../../entities/Mission/MissionDossierFilesystem.js';
import { getMissionArtifactDefinition, getMissionStageDefinition, type MissionArtifactKey } from '../../manifest.js';
import type {
    MissionProductTemplate,
    MissionStageTemplateDefinitions,
    MissionTaskTemplateRef,
    MissionTaskTemplate,
    MissionTemplateContext,
    MissionTemplateContextInput
} from './types.js';
import type { MissionTaskStatus } from '../../../entities/Mission/MissionSchema.js';
import { TaskContextArtifactReferenceSchema } from '../../../entities/Task/TaskSchema.js';

const packagedTemplateDirectory = path.dirname(fileURLToPath(import.meta.url));

export type {
    MissionProductTemplate,
    MissionStageTemplateDefinition,
    MissionStageTemplateDefinitions,
    MissionTemplateContext,
    MissionTemplateContextInput,
    MissionTaskTemplateRef,
    MissionTaskTemplate
} from './types.js';

export async function renderMissionBriefBody(input: MissionTemplateContextInput): Promise<string> {
    return renderMissionTemplate('BRIEF.md', input);
}

export async function renderMissionProductTemplate(
    template: MissionProductTemplate,
    input: MissionTemplateContextInput
): Promise<string> {
    return renderMissionTemplate(template.templatePath, input);
}

export async function renderMissionTaskTemplate(
    template: MissionTaskTemplateRef,
    input: MissionTemplateContextInput
): Promise<MissionTaskTemplate> {
    const templateText = await readTemplateFile(resolveMissionTemplateDirectory(input.repositoryRootPath), template.templatePath);
    const renderedText = renderTemplate(templateText, createMissionTemplateContext(input));
    const document = parseFrontmatterDocument(renderedText);

    const fileNameAttr = document.attributes['fileName'];
    const fileName = typeof fileNameAttr === 'string'
        ? fileNameAttr
        : template.templatePath.split('/').pop() || 'task.md';

    const subjectAttr = document.attributes['subject'];
    const agentAttr = document.attributes['agent'];
    const taskKindAttr = document.attributes['taskKind'];
    const pairedTaskIdAttr = document.attributes['pairedTaskId'];
    const dependsOnAttr = document.attributes['dependsOn'];
    const contextAttr = document.attributes['context'];
    const statusAttr = document.attributes['status'];
    const retriesAttr = document.attributes['retries'];

    const result: MissionTaskTemplate = {
        fileName,
        subject: String(subjectAttr || ''),
        instruction: document.body.trim(),
        agent: String(typeof agentAttr === 'string' && agentAttr.trim() ? agentAttr.trim() : DEFAULT_REPOSITORY_AGENT_ADAPTER_ID) as MissionTaskAgent,
    };

    if (Array.isArray(dependsOnAttr)) {
        result.dependsOn = dependsOnAttr.map(String);
    }

    if (Array.isArray(contextAttr)) {
        result.context = contextAttr.map((entry) => TaskContextArtifactReferenceSchema.parse(entry));
    }

    if (taskKindAttr === 'implementation' || taskKindAttr === 'verification') {
        result.taskKind = taskKindAttr;
    }

    if (typeof pairedTaskIdAttr === 'string' && pairedTaskIdAttr.trim().length > 0) {
        result.pairedTaskId = pairedTaskIdAttr.trim();
    }

    if (typeof statusAttr === 'string') {
        result.status = statusAttr as MissionTaskStatus;
    }

    if (typeof retriesAttr === 'number') {
        result.retries = retriesAttr;
    }

    return result;
}

export function createMissionTemplateContext(input: MissionTemplateContextInput): MissionTemplateContext {
    const missionDossierPath = path.posix.join(Repository.missionDirectoryName, 'missions', input.missionId);
    return {
        mission: {
            id: input.missionId,
            title: renderMissionTitle(input.brief),
            branchRef: input.branchRef,
            issueLine: input.brief.issueId !== undefined ? `Issue: #${String(input.brief.issueId)}` : 'Issue: Unattached',
            dossierPath: missionDossierPath,
            briefPath: createMissionDossierArtifactPath(missionDossierPath, 'brief'),
            prdPath: createMissionDossierArtifactPath(missionDossierPath, 'prd'),
            specPath: createMissionDossierArtifactPath(missionDossierPath, 'spec'),
            verifyPath: createMissionDossierArtifactPath(missionDossierPath, 'verify'),
            auditPath: createMissionDossierArtifactPath(missionDossierPath, 'audit'),
            deliveryPath: createMissionDossierArtifactPath(missionDossierPath, 'delivery'),
            implementationTasksPath: path.posix.join(
                missionDossierPath,
                getMissionStageDefinition('implementation').stageFolder,
                'tasks'
            )
        },
        brief: {
            body: input.brief.body.trim()
        }
    };
}

function createMissionDossierArtifactPath(missionDossierPath: string, artifactKey: MissionArtifactKey): string {
    const artifact = getMissionArtifactDefinition(artifactKey);
    if (artifact.stageId) {
        return path.posix.join(
            missionDossierPath,
            getMissionStageDefinition(artifact.stageId).stageFolder,
            artifact.fileName
        );
    }
    return path.posix.join(missionDossierPath, artifact.fileName);
}

async function renderMissionTemplate(
    templatePath: string,
    input: MissionTemplateContextInput
): Promise<string> {
    const templateText = await readTemplateFile(resolveMissionTemplateDirectory(input.repositoryRootPath), templatePath);
    return renderTemplate(templateText, createMissionTemplateContext(input));
}

function resolveMissionTemplateDirectory(repositoryRoot: string): string {
    const repositoryTemplateDirectory = Repository.getMissionWorkflowTemplatesPath(repositoryRoot);
    if (path.isAbsolute(repositoryTemplateDirectory) && fs.existsSync(repositoryTemplateDirectory)) {
        return repositoryTemplateDirectory;
    }
    return packagedTemplateDirectory;
}

export const MISSION_STAGE_TEMPLATE_DEFINITIONS: MissionStageTemplateDefinitions = {
    prd: {
        artifacts: [{ key: 'prd', templatePath: 'stages/PRD.md' }],
        defaultTasks: [{ templatePath: 'tasks/PRD/01-prd-from-brief.md' }]
    },
    spec: {
        artifacts: [{ key: 'spec', templatePath: 'stages/SPEC.md' }],
        defaultTasks: [
            { templatePath: 'tasks/SPEC/01-spec-from-prd.md' },
            { templatePath: 'tasks/SPEC/02-plan.md' }
        ]
    },
    implementation: {
        artifacts: [{ key: 'verify', templatePath: 'stages/VERIFICATION.md' }],
        defaultTasks: []
    },
    audit: {
        artifacts: [{ key: 'audit', templatePath: 'stages/AUDIT.md' }],
        defaultTasks: [
            { templatePath: 'tasks/AUDIT/01-debrief.md' },
            { templatePath: 'tasks/AUDIT/02-touchdown.md' }
        ]
    },
    delivery: {
        artifacts: [{ key: 'delivery', templatePath: 'stages/DELIVERY.md' }],
        defaultTasks: []
    }
};
