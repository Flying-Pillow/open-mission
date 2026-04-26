import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTemplateFile } from '../../engine/templates/templateRepository.js';
import { renderTemplate } from '../../engine/templates/templateRenderer.js';
import { renderMissionTitle } from './common.js';
import { parseFrontmatterDocument } from '../../../lib/frontmatter.js';
import { DEFAULT_AGENT_RUNNER_ID } from '../../../agent/runtimes/AgentRuntimeIds.js';
import { getMissionWorkflowTemplatesPath } from '../../../entities/Repository/RepositoryPaths.js';
import type {
    MissionProductTemplate,
    MissionStageTemplateDefinitions,
    MissionTaskTemplateRef,
    MissionTaskTemplate,
    MissionTemplateContext,
    MissionTemplateContextInput
} from './types.js';
import type { MissionTaskAgent, MissionTaskStatus } from '../../../types.js';

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
    const templateText = await readTemplateFile(resolveMissionTemplateDirectory(input.controlRoot), template.templatePath);
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
    const statusAttr = document.attributes['status'];
    const retriesAttr = document.attributes['retries'];

    const result: MissionTaskTemplate = {
        fileName,
        subject: String(subjectAttr || ''),
        instruction: document.body.trim(),
        agent: String(typeof agentAttr === 'string' && agentAttr.trim() ? agentAttr.trim() : DEFAULT_AGENT_RUNNER_ID) as MissionTaskAgent,
    };

    if (Array.isArray(dependsOnAttr)) {
        result.dependsOn = dependsOnAttr.map(String);
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
    return {
        mission: {
            title: renderMissionTitle(input.brief),
            branchRef: input.branchRef,
            issueLine: input.brief.issueId !== undefined ? `Issue: #${String(input.brief.issueId)}` : 'Issue: Unattached'
        },
        brief: {
            body: input.brief.body.trim()
        }
    };
}

async function renderMissionTemplate(
    templatePath: string,
    input: MissionTemplateContextInput
): Promise<string> {
    const templateText = await readTemplateFile(resolveMissionTemplateDirectory(input.controlRoot), templatePath);
    return renderTemplate(templateText, createMissionTemplateContext(input));
}

function resolveMissionTemplateDirectory(controlRoot: string): string {
    const repositoryTemplateDirectory = getMissionWorkflowTemplatesPath(controlRoot);
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
