import type { PaneBinding } from '@flying-pillow/mission-core';
import type { TreeTargetKind } from './missionControlDomain.js';

export function resolvePanelBindingsFromTreeTarget(
	target: {
		kind: TreeTargetKind;
		sourcePath?: string;
	} | undefined,
	missionId: string | undefined
): Partial<Record<'briefingRoom', PaneBinding>> | undefined {
	const normalizedMissionId = missionId?.trim();
	if (!target) {
		if (!normalizedMissionId) {
			return undefined;
		}
		return {
			briefingRoom: {
				targetKind: 'mission',
				targetId: normalizedMissionId,
				mode: 'view'
			}
		};
	}

	if ((target.kind === 'task-artifact' || target.kind === 'stage-artifact') && target.sourcePath?.trim()) {
		return {
			briefingRoom: {
				targetKind: 'artifact',
				targetId: target.sourcePath.trim(),
				mode: 'view'
			}
		};
	}

	if (!normalizedMissionId) {
		return undefined;
	}

	return {
		briefingRoom: {
			targetKind: 'mission',
			targetId: normalizedMissionId,
			mode: 'view'
		}
	};
}