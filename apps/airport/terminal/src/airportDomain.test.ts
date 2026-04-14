import { describe, expect, it } from 'vitest';
import type { MissionSystemSnapshot } from '@flying-pillow/mission-core';
import { resolveMissionOperatorView } from './airportDomain.js';


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
