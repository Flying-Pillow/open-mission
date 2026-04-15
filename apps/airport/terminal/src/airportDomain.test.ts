import { describe, expect, it } from 'vitest';
import type { MissionSystemSnapshot } from '@flying-pillow/mission-core';
import { resolveMissionOperatorView, toErrorDetails, toErrorMessage } from './airportDomain.js';


describe('resolveMissionOperatorView', () => {
	it('reads mission-mode tower data from the selected mission operator view', () => {
		const snapshot = {
			state: {
				missionOperatorViews: {
					'mission-new': {
						missionId: 'mission-new',
						stageRail: [{ id: 'spec', label: 'Spec', state: 'active' }],
						treeNodes: [{ id: 'mission-new', label: 'Mission new', kind: 'mission', depth: 0, color: 'blue', collapsible: false }]
					}
				}
			}
		} as unknown as MissionSystemSnapshot;

		expect(resolveMissionOperatorView(snapshot, 'mission-new')).toEqual({
			missionId: 'mission-new',
			stageRail: [{ id: 'spec', label: 'Spec', state: 'active' }],
			treeNodes: [{ id: 'mission-new', label: 'Mission new', kind: 'mission', depth: 0, color: 'blue', collapsible: false }]
		});
	});
});

describe('toErrorDetails', () => {
	it('extracts daemon error code when present', () => {
		const error = Object.assign(new Error('Task cannot be queued.'), {
			code: 'MISSION_WORKFLOW_VALIDATION_ERROR'
		});
		expect(toErrorDetails(error)).toEqual({
			message: 'Task cannot be queued.',
			code: 'MISSION_WORKFLOW_VALIDATION_ERROR'
		});
	});
});

describe('toErrorMessage', () => {
	it('prefixes message with daemon error code when available', () => {
		const error = Object.assign(new Error('Task cannot be queued.'), {
			code: 'MISSION_WORKFLOW_VALIDATION_ERROR'
		});
		expect(toErrorMessage(error)).toBe('[MISSION_WORKFLOW_VALIDATION_ERROR] Task cannot be queued.');
	});
});
