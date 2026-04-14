import type { MissionResolvedSelection, PaneBinding } from '@flying-pillow/mission-core';

export function resolvePanelBindingsFromSelection(
	selection: MissionResolvedSelection | undefined,
	missionId: string | undefined
): Partial<Record<'briefingRoom' | 'runway', PaneBinding>> | undefined {
	const normalizedMissionId = missionId?.trim();
	const artifactId = selection?.activeInstructionArtifactId ?? selection?.activeStageResultArtifactId;
	const activeAgentSessionId = selection?.activeAgentSessionId?.trim();
	const runwayBinding: PaneBinding = activeAgentSessionId
		? {
			targetKind: 'agentSession',
			targetId: activeAgentSessionId,
			mode: 'view'
		}
		: {
			targetKind: 'empty'
		};
	if (!artifactId) {
		if (!normalizedMissionId) {
			return undefined;
		}
		return {
			briefingRoom: {
				targetKind: 'mission',
				targetId: normalizedMissionId,
				mode: 'view'
			},
			runway: runwayBinding
		};
	}

	return {
		briefingRoom: {
			targetKind: 'artifact',
			targetId: artifactId,
			mode: 'view'
		},
		runway: runwayBinding
	};
}