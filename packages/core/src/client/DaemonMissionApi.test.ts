import { describe, expect, it } from 'vitest';
import { DaemonMissionApi } from './DaemonMissionApi.js';
import type { OperatorStatus } from '../types.js';

describe('DaemonMissionApi.selectorFromStatus', () => {
	it('prefers explicit fallback missionId over ambient system selection', () => {
		const status = {
			found: false,
			system: {
				state: {
					domain: {
						selection: {
							missionId: 'mission-14'
						}
					}
				}
			}
		} as unknown as OperatorStatus;

		expect(DaemonMissionApi.selectorFromStatus(status, { missionId: 'mission-13' })).toEqual({
			missionId: 'mission-13'
		});
	});

	it('still prefers status missionId when present', () => {
		const status = {
			found: true,
			missionId: 'mission-99'
		} as OperatorStatus;

		expect(DaemonMissionApi.selectorFromStatus(status, { missionId: 'mission-13' })).toEqual({
			missionId: 'mission-99'
		});
	});
});
