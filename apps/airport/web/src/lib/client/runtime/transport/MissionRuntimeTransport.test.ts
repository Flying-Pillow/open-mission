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
					mission: {
						missionId: 'mission-29',
						title: 'Mission 29',
						artifacts: [],
						stages: [],
						agentSessions: []
					},
					status: {
						missionId: 'mission-29',
						title: 'Mission 29',
						workflow: {
							stages: []
						}
					},
					workflow: {
						stages: []
					},
					stages: [],
					tasks: [],
					artifacts: [],
					agentSessions: []
				};
			}
		});

		const snapshot = await transport.getMissionSnapshot('mission-29');

		expect(snapshot.mission.missionId).toBe('mission-29');
	});
});