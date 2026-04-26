import { describe, expect, it } from 'vitest';
import { MissionRuntimeTransport } from './MissionRuntimeTransport';

describe('MissionRuntimeTransport', () => {
	it('routes mission snapshot reads through the mission entity remote', async () => {
		const transport = new MissionRuntimeTransport({
			repositoryRootPath: '/repo/root',
			queryRemote: async (input) => {
				expect(input).toEqual({
					entity: 'Mission',
					method: 'read',
					payload: {
						missionId: 'mission-29',
						repositoryRootPath: '/repo/root'
					}
				});

				return {
					missionId: 'mission-29',
					status: {
						missionId: 'mission-29',
						workflow: {
							stages: []
						}
					},
					sessions: []
				};
			}
		});

		const snapshot = await transport.getMissionRuntimeSnapshot('mission-29');

		expect(snapshot.missionId).toBe('mission-29');
	});
});