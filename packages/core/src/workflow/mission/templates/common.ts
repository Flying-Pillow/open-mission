import type { MissionBrief } from '../../../entities/Mission/MissionSchema.js';
import type { MissionArtifactKey } from '../../manifest.js';

export function renderMissionTitle(brief: MissionBrief): string {
	return brief.issueId !== undefined ? `#${String(brief.issueId)} - ${brief.title}` : brief.title;
}

export function renderMissionArtifactTitle(artifact: MissionArtifactKey, brief: MissionBrief): string {
	if (artifact === 'brief') {
		return brief.title;
	}
	const missionTitle = renderMissionTitle(brief);
	if (artifact === 'prd') {
		return `PRD: ${missionTitle}`;
	}
	if (artifact === 'spec') {
		return `SPEC: ${missionTitle}`;
	}
	if (artifact === 'verify') {
		return `VERIFY: ${missionTitle}`;
	}
	if (artifact === 'audit') {
		return `AUDIT: ${missionTitle}`;
	}
	return `DELIVERY: ${missionTitle}`;
}