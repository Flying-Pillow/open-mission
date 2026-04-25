import { describe, expect, it, vi } from 'vitest';
import { RepositoryRuntime } from './RepositoryRuntime.js';

describe('RepositoryRuntime mission selection caching', () => {
	it('reuses mission selection candidates within the cache window and refreshes after invalidation', async () => {
		const runtime = new RepositoryRuntime('/tmp/mission-cache-test', new Map(), () => { });
		const store = (runtime as unknown as {
			store: {
				listMissions: () => Promise<Array<{
					descriptor: {
						missionId: string;
						brief: { title: string; issueId?: number };
						branchRef: string;
						createdAt: string;
					};
				}>>;
			};
		}).store;

		const listMissions = vi.spyOn(store, 'listMissions');
		listMissions
			.mockResolvedValueOnce([
				{
					descriptor: {
						missionId: 'mission-1',
						brief: { title: 'Mission One', issueId: 42 },
						branchRef: 'mission/42',
						createdAt: '2026-04-24T09:00:00.000Z'
					}
				}
			])
			.mockResolvedValueOnce([
				{
					descriptor: {
						missionId: 'mission-2',
						brief: { title: 'Mission Two', issueId: 84 },
						branchRef: 'mission/84',
						createdAt: '2026-04-24T09:05:00.000Z'
					}
				}
			]);

		const first = await runtime.listMissionSelectionCandidates();
		first[0]!.title = 'Mutated';
		const second = await runtime.listMissionSelectionCandidates();

		expect(listMissions).toHaveBeenCalledTimes(1);
		expect(second).toEqual([
			{
				missionId: 'mission-1',
				title: 'Mission One',
				branchRef: 'mission/42',
				createdAt: '2026-04-24T09:00:00.000Z',
				issueId: 42
			}
		]);

		(runtime as unknown as { invalidateMissionSelectionCache: () => void }).invalidateMissionSelectionCache();
		const refreshed = await runtime.listMissionSelectionCandidates();

		expect(listMissions).toHaveBeenCalledTimes(2);
		expect(refreshed).toEqual([
			{
				missionId: 'mission-2',
				title: 'Mission Two',
				branchRef: 'mission/84',
				createdAt: '2026-04-24T09:05:00.000Z',
				issueId: 84
			}
		]);
	});
});