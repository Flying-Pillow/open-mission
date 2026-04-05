import { readMissionTemplate } from './templateRepository.js';
import { renderTemplate } from './templateRenderer.js';
import { renderMissionTitle } from './common.js';
import { parseFrontmatterDocument } from '../../lib/frontmatter.js';
import type {
MissionProductTemplate,
MissionStageTemplateDefinitions,
MissionTaskTemplateRef,
MissionTaskTemplate,
MissionTemplateContext,
MissionTemplateContextInput
} from './types.js';
import type { MissionTaskAgent, MissionTaskStatus } from '../../types.js';

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
const templateText = await readMissionTemplate(template.templatePath);
const renderedText = renderTemplate(templateText, createMissionTemplateContext(input));
const document = parseFrontmatterDocument(renderedText);

const fileNameAttr = document.attributes['fileName'];
const fileName = typeof fileNameAttr === 'string' 
? fileNameAttr 
: template.templatePath.split('/').pop() || 'task.md';

const subjectAttr = document.attributes['subject'];
const agentAttr = document.attributes['agent'];
const dependsOnAttr = document.attributes['dependsOn'];
const statusAttr = document.attributes['status'];
const retriesAttr = document.attributes['retries'];

const result: MissionTaskTemplate = {
fileName,
subject: String(subjectAttr || ''),
instruction: document.body.trim(),
agent: String(agentAttr || 'copilot') as MissionTaskAgent,
};

if (Array.isArray(dependsOnAttr)) {
result.dependsOn = dependsOnAttr.map(String);
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
const templateText = await readMissionTemplate(templatePath);
return renderTemplate(templateText, createMissionTemplateContext(input));
}

export const MISSION_STAGE_TEMPLATE_DEFINITIONS: MissionStageTemplateDefinitions = {
prd: {
artifacts: [{ key: 'prd', templatePath: 'products/PRD.md' }],
defaultTasks: [{ templatePath: 'tasks/PRD/01-prd-from-brief.md' }]
},
spec: {
artifacts: [{ key: 'spec', templatePath: 'products/SPEC.md' }],
defaultTasks: [
{ templatePath: 'tasks/SPEC/01-spec-from-prd.md' },
{ templatePath: 'tasks/SPEC/02-plan.md' }
]
},
implementation: {
artifacts: [{ key: 'verify', templatePath: 'products/VERIFICATION.md' }],
defaultTasks: []
},
audit: {
artifacts: [{ key: 'audit', templatePath: 'products/AUDIT.md' }],
defaultTasks: [
{ templatePath: 'tasks/AUDIT/01-debrief.md' },
{ templatePath: 'tasks/AUDIT/02-touchdown.md' }
]
},
delivery: {
artifacts: [{ key: 'delivery', templatePath: 'products/DELIVERY.md' }],
defaultTasks: []
}
};
