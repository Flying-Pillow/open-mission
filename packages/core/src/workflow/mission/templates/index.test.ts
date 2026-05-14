import { describe, expect, it } from 'vitest';
import { renderMissionProductTemplate, renderMissionTaskTemplate } from './index.js';

describe('mission template resolution', () => {
    it('falls back to packaged templates when the repository template directory is missing', async () => {
        const rendered = await renderMissionProductTemplate(
            { key: 'spec', templatePath: 'stages/SPEC.md' },
            {
                missionId: 'mission-17',
                repositoryRootPath: '/',
                branchRef: 'mission/17-reconstruct-agent-runtime-unification',
                brief: {
                    title: 'Reconstruct agent adapter unification',
                    body: 'Reconstruct agent adapter unification body'
                }
            }
        );

        expect(rendered).toContain('Branch: mission/17-reconstruct-agent-runtime-unification');
        expect(rendered).toContain('## Architecture');
    });

    it('renders first PRD task instructions with mission dossier artifact paths', async () => {
        const rendered = await renderMissionTaskTemplate(
            { templatePath: 'tasks/PRD/01-prd-from-brief.md' },
            {
                missionId: '1-initial-setup',
                repositoryRootPath: '/',
                branchRef: 'mission/1-initial-setup',
                brief: {
                    title: 'Initial setup',
                    body: 'Initial setup body'
                }
            }
        );

        expect(rendered.instruction).toContain('Read .open-mission/missions/1-initial-setup/BRIEF.md as intake.');
        expect(rendered.instruction).toContain('Update only .open-mission/missions/1-initial-setup/01-PRD/PRD.md.');
    });

    it('renders SPEC task instructions with mission dossier artifact paths', async () => {
        const rendered = await renderMissionTaskTemplate(
            { templatePath: 'tasks/SPEC/01-spec-from-prd.md' },
            {
                missionId: '1-initial-setup',
                repositoryRootPath: '/',
                branchRef: 'mission/1-initial-setup',
                brief: {
                    title: 'Initial setup',
                    body: 'Initial setup body'
                }
            }
        );

        expect(rendered.instruction).toContain('Read .open-mission/missions/1-initial-setup/01-PRD/PRD.md');
        expect(rendered.instruction).toContain('update only .open-mission/missions/1-initial-setup/02-SPEC/SPEC.md');
        expect(rendered.instruction).toContain('Make .open-mission/missions/1-initial-setup/02-SPEC/SPEC.md ready');
    });

    it('renders planning task instructions with mission dossier task paths', async () => {
        const rendered = await renderMissionTaskTemplate(
            { templatePath: 'tasks/SPEC/02-plan.md' },
            {
                missionId: '1-initial-setup',
                repositoryRootPath: '/',
                branchRef: 'mission/1-initial-setup',
                brief: {
                    title: 'Initial setup',
                    body: 'Initial setup body'
                }
            }
        );

        expect(rendered.instruction).toContain('Read .open-mission/missions/1-initial-setup/02-SPEC/SPEC.md');
        expect(rendered.instruction).toContain('under .open-mission/missions/1-initial-setup/03-IMPLEMENTATION/tasks');
    });
});