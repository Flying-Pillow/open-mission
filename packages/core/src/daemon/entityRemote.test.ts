import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod/v4';
import {
	executeEntityCommandInDaemon,
	executeEntityQueryInDaemon
} from './entityRemote.js';
import { GitHubRepository } from '../entities/GitHubRepository/GitHubRepository.js';
import { Repository } from '../entities/Repository/Repository.js';
import { PROTOCOL_VERSION } from './protocol/contracts.js';
import { repositoryMissionStartAcknowledgementSchema } from '../schemas/Repository.js';

describe('daemon entity dispatch', () => {
	it('uses the bumped daemon protocol version', () => {
		expect(PROTOCOL_VERSION).toBe(24);
	});

	it('uses source acknowledgements for Repository mission-start commands', () => {
		expect(repositoryMissionStartAcknowledgementSchema.parse({
			ok: true,
			entity: 'Repository',
			method: 'startMissionFromIssue',
			id: 'mission-29'
		})).toEqual({
			ok: true,
			entity: 'Repository',
			method: 'startMissionFromIssue',
			id: 'mission-29'
		});

		expect(() => repositoryMissionStartAcknowledgementSchema.parse({
			missionId: 'mission-29',
			status: {
				missionId: 'mission-29',
				workflow: { stages: [] }
			},
			sessions: []
		})).toThrow(ZodError);
	});

	it('dispatches Repository.find through an explicit query handler', async () => {
		const result = await executeEntityQueryInDaemon({
			entity: 'Repository',
			method: 'find',
			payload: {}
		}, {
			surfacePath: process.cwd()
		});

		expect(Array.isArray(result)).toBe(true);
	});

	it('dispatches Repository.add through an explicit command handler', async () => {
		const snapshot = {
			repository: Repository.open('/tmp/mission-proof-of-concept').toSchema(),
			controlRoot: '/tmp/mission-proof-of-concept',
			missions: []
		};
		const addSpy = vi.spyOn(Repository, 'add').mockResolvedValue(snapshot);

		try {
			const result = await executeEntityCommandInDaemon({
				entity: 'Repository',
				method: 'add',
				payload: {
					repositoryPath: process.cwd()
				}
			}, {
				surfacePath: process.cwd()
			});

			expect(addSpy).toHaveBeenCalledWith({ repositoryPath: process.cwd() }, { surfacePath: process.cwd() });
			expect(result).toMatchObject(snapshot);
		} finally {
			addSpy.mockRestore();
		}
	});

	it('dispatches GitHubRepository source methods through explicit handlers', async () => {
		const repositorySnapshot = {
			repository: Repository.open('/tmp/mission-proof-of-concept').toSchema(),
			controlRoot: '/tmp/mission-proof-of-concept',
			missions: []
		};
		const findSpy = vi.spyOn(GitHubRepository, 'find').mockResolvedValue([
			{
				fullName: 'Flying-Pillow/mission',
				ownerLogin: 'Flying-Pillow',
				visibility: 'public',
				archived: false
			}
		]);
		const cloneSpy = vi.spyOn(GitHubRepository, 'clone').mockResolvedValue(repositorySnapshot);

		try {
			await expect(executeEntityQueryInDaemon({
				entity: 'GitHubRepository',
				method: 'find',
				payload: {}
			}, {
				surfacePath: '/repo/root',
				authToken: 'token'
			})).resolves.toEqual([
				{
					fullName: 'Flying-Pillow/mission',
					ownerLogin: 'Flying-Pillow',
					visibility: 'public',
					archived: false
				}
			]);

			await expect(executeEntityCommandInDaemon({
				entity: 'GitHubRepository',
				method: 'clone',
				payload: {
					githubRepository: 'Flying-Pillow/mission',
					destinationPath: '/repositories/Flying-Pillow/mission'
				}
			}, {
				surfacePath: '/repo/root',
				authToken: 'token'
			})).resolves.toMatchObject(repositorySnapshot);

			expect(findSpy).toHaveBeenCalledWith({}, { surfacePath: '/repo/root', authToken: 'token' });
			expect(cloneSpy).toHaveBeenCalledWith({
				githubRepository: 'Flying-Pillow/mission',
				destinationPath: '/repositories/Flying-Pillow/mission'
			}, { surfacePath: '/repo/root', authToken: 'token' });
		} finally {
			findSpy.mockRestore();
			cloneSpy.mockRestore();
		}
	});

	it('dispatches Repository instance methods through explicit handlers', async () => {
		const snapshot = {
			repository: Repository.open('/tmp/mission-proof-of-concept').toSchema(),
			controlRoot: '/tmp/mission-proof-of-concept',
			missions: []
		};
		const repository = {
			read: vi.fn().mockResolvedValue(snapshot),
			listIssues: vi.fn().mockResolvedValue([]),
			getIssue: vi.fn().mockResolvedValue({
				number: 1,
				title: 'Issue 1',
				body: 'Issue body',
				labels: [],
				assignees: []
			}),
			startMissionFromIssue: vi.fn().mockResolvedValue({
				ok: true,
				entity: 'Repository',
				method: 'startMissionFromIssue',
				id: 'mission-1'
			}),
			startMissionFromBrief: vi.fn().mockResolvedValue({
				ok: true,
				entity: 'Repository',
				method: 'startMissionFromBrief',
				id: 'mission-2'
			})
		} as unknown as Repository;
		const resolveSpy = vi.spyOn(Repository, 'resolve').mockResolvedValue(repository);
		const identity = {
			repositoryId: 'local:mission-proof-of-concept',
			repositoryRootPath: '/tmp/mission-proof-of-concept'
		};

		try {
			await expect(executeEntityQueryInDaemon({
				entity: 'Repository',
				method: 'read',
				payload: identity
			}, { surfacePath: process.cwd() })).resolves.toMatchObject(snapshot);

			await expect(executeEntityQueryInDaemon({
				entity: 'Repository',
				method: 'listIssues',
				payload: identity
			}, { surfacePath: process.cwd() })).resolves.toEqual([]);

			await expect(executeEntityQueryInDaemon({
				entity: 'Repository',
				method: 'getIssue',
				payload: { ...identity, issueNumber: 1 }
			}, { surfacePath: process.cwd() })).resolves.toMatchObject({ number: 1 });

			await expect(executeEntityCommandInDaemon({
				entity: 'Repository',
				method: 'startMissionFromIssue',
				payload: { ...identity, issueNumber: 1 }
			}, { surfacePath: process.cwd() })).resolves.toEqual({
				ok: true,
				entity: 'Repository',
				method: 'startMissionFromIssue',
				id: 'mission-1'
			});

			await expect(executeEntityCommandInDaemon({
				entity: 'Repository',
				method: 'startMissionFromBrief',
				payload: {
					...identity,
					title: 'Mission title',
					body: 'Mission body',
					type: 'feature'
				}
			}, { surfacePath: process.cwd() })).resolves.toEqual({
				ok: true,
				entity: 'Repository',
				method: 'startMissionFromBrief',
				id: 'mission-2'
			});

			expect(resolveSpy).toHaveBeenCalledTimes(5);
			expect(repository.read).toHaveBeenCalledOnce();
			expect(repository.listIssues).toHaveBeenCalledOnce();
			expect(repository.getIssue).toHaveBeenCalledOnce();
			expect(repository.startMissionFromIssue).toHaveBeenCalledOnce();
			expect(repository.startMissionFromBrief).toHaveBeenCalledOnce();
		} finally {
			resolveSpy.mockRestore();
		}
	});

	it('fails loudly for unknown entities and methods', async () => {
		await expect(executeEntityQueryInDaemon({
			entity: 'Mission',
			method: 'read',
			payload: {}
		}, {
			surfacePath: process.cwd()
		})).rejects.toThrow("Entity 'Mission' is not implemented in the daemon.");

		await expect(executeEntityQueryInDaemon({
			entity: 'Repository',
			method: 'missing',
			payload: {}
		}, {
			surfacePath: process.cwd()
		})).rejects.toThrow("Query method 'Repository.missing' is not implemented in the daemon.");
	});

	it('rejects invalid payloads and missing Repository instances', async () => {
		await expect(executeEntityQueryInDaemon({
			entity: 'Repository',
			method: 'find',
			payload: { unexpected: true }
		}, {
			surfacePath: process.cwd()
		})).rejects.toBeInstanceOf(ZodError);

		await expect(executeEntityQueryInDaemon({
			entity: 'Repository',
			method: 'read',
			payload: {
				repositoryId: 'missing:repository'
			}
		}, {
			surfacePath: process.cwd()
		})).rejects.toThrow("Entity 'Repository' could not be resolved for method 'read'.");
	});

	it('rejects invalid Repository results before returning', async () => {
		const findSpy = vi.spyOn(Repository, 'find').mockResolvedValue([{ bad: true }] as never);

		try {
			await expect(executeEntityQueryInDaemon({
				entity: 'Repository',
				method: 'find',
				payload: {}
			}, {
				surfacePath: process.cwd()
			})).rejects.toBeInstanceOf(ZodError);
		} finally {
			findSpy.mockRestore();
		}
	});

	it('requires daemon dispatch context', async () => {
		await expect(executeEntityQueryInDaemon({
			entity: 'Repository',
			method: 'find',
			payload: {}
		}, {
			surfacePath: '   '
		})).rejects.toThrow('Entity daemon dispatch requires a surfacePath context.');
	});
});