import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTemplateFile } from '../engine/templates/templateRepository.js';
import { renderTemplate } from '../engine/templates/templateRenderer.js';

const packagedTemplateDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

export const REPOSITORY_PREPARATION_ISSUE_TITLE = 'Prepare repo for Mission';

export async function renderRepositoryPreparationIssueBody(input: {
    repositoryRef: string;
    repositoryRootPath: string;
    defaultBranch: string;
}): Promise<string> {
    const template = await readTemplateFile(packagedTemplateDirectory, 'issues/prepare-repository.md');
    return renderTemplate(template, {
        repository: {
            ref: input.repositoryRef,
            rootPath: input.repositoryRootPath,
            defaultBranch: input.defaultBranch
        }
    });
}