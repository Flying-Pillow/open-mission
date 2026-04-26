import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod/v4';
import {
	executeEntityCommandInDaemon,
	executeEntityQueryInDaemon
} from './entityRemote.js';
import { AgentSessionCommands } from '../entities/AgentSession/AgentSessionCommands.js';
import { ArtifactCommands } from '../entities/Artifact/ArtifactCommands.js';
import { GitHubRepository } from '../entities/GitHubRepository/GitHubRepository.js';
import { MissionCommands } from '../entities/Mission/MissionCommands.js';
import type { MissionRuntimeHandle } from '../entities/Mission/MissionRuntimeAccess.js';
import { Repository } from '../entities/Repository/Repository.js';
import { StageCommands } from '../entities/Stage/StageCommands.js';
import { TaskCommands } from '../entities/Task/TaskCommands.js';
import { PROTOCOL_VERSION } from './protocol/contracts.js';
import type {
	MissionActionListSnapshot,
	MissionCommandAcknowledgement,
	MissionDocumentSnapshot,
	MissionProjectionSnapshot,
	MissionSnapshot,
	MissionWorktreeSnapshot
} from '../schemas/Mission.js';
import { repositoryMissionStartAcknowledgementSchema } from '../schemas/Repository.js';

describe('daemon entity dispatch', () => {
	it('uses the bumped daemon protocol version', () => {
		expect(PROTOCOL_VERSION).toBe(27);
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

	it('dispatches Mission source methods through explicit handlers', async () => {
		const querySpies = [
			vi.spyOn(MissionCommands, 'read').mockResolvedValue(createMissionSnapshot()),
			vi.spyOn(MissionCommands, 'readProjection').mockResolvedValue(createMissionProjectionSnapshot()),
			vi.spyOn(MissionCommands, 'listActions').mockResolvedValue(createMissionActionListSnapshot()),
			vi.spyOn(MissionCommands, 'readDocument').mockResolvedValue(createMissionDocumentSnapshot()),
			vi.spyOn(MissionCommands, 'readWorktree').mockResolvedValue(createMissionWorktreeSnapshot())
		];
		const commandSpies = [
			vi.spyOn(MissionCommands, 'command').mockResolvedValue(createMissionAcknowledgement('command')),
			vi.spyOn(MissionCommands, 'taskCommand').mockResolvedValue(createMissionAcknowledgement('taskCommand', { taskId: 'implementation/01-task' })),
			vi.spyOn(MissionCommands, 'sessionCommand').mockResolvedValue(createMissionAcknowledgement('sessionCommand', { sessionId: 'session-1' })),
			vi.spyOn(MissionCommands, 'executeAction').mockResolvedValue(createMissionAcknowledgement('executeAction', { actionId: 'pause' })),
			vi.spyOn(MissionCommands, 'writeDocument').mockResolvedValue(createMissionDocumentSnapshot())
		];

		try {
			await expect(executeEntityQueryInDaemon({
				entity: 'Mission',
				method: 'read',
				payload: { missionId: 'mission-1' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ mission: { missionId: 'mission-1' } });

			await expect(executeEntityQueryInDaemon({
				entity: 'Mission',
				method: 'readProjection',
				payload: { missionId: 'mission-1' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ missionId: 'mission-1' });

			await expect(executeEntityQueryInDaemon({
				entity: 'Mission',
				method: 'listActions',
				payload: { missionId: 'mission-1', context: { taskId: 'implementation/01-task' } }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ missionId: 'mission-1' });

			await expect(executeEntityQueryInDaemon({
				entity: 'Mission',
				method: 'readDocument',
				payload: { missionId: 'mission-1', path: '/repo/root/README.md' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ filePath: '/repo/root/README.md' });

			await expect(executeEntityQueryInDaemon({
				entity: 'Mission',
				method: 'readWorktree',
				payload: { missionId: 'mission-1' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ rootPath: '/repo/root/.mission/worktrees/mission-1' });

			await expect(executeEntityCommandInDaemon({
				entity: 'Mission',
				method: 'command',
				payload: { missionId: 'mission-1', command: { action: 'pause' } }
			}, { surfacePath: '/repo/root' })).resolves.toEqual(createMissionAcknowledgement('command'));

			await expect(executeEntityCommandInDaemon({
				entity: 'Mission',
				method: 'taskCommand',
				payload: { missionId: 'mission-1', taskId: 'implementation/01-task', command: { action: 'complete' } }
			}, { surfacePath: '/repo/root' })).resolves.toEqual(createMissionAcknowledgement('taskCommand', { taskId: 'implementation/01-task' }));

			await expect(executeEntityCommandInDaemon({
				entity: 'Mission',
				method: 'sessionCommand',
				payload: { missionId: 'mission-1', sessionId: 'session-1', command: { action: 'complete' } }
			}, { surfacePath: '/repo/root' })).resolves.toEqual(createMissionAcknowledgement('sessionCommand', { sessionId: 'session-1' }));

			await expect(executeEntityCommandInDaemon({
				entity: 'Mission',
				method: 'executeAction',
				payload: { missionId: 'mission-1', actionId: 'pause' }
			}, { surfacePath: '/repo/root' })).resolves.toEqual(createMissionAcknowledgement('executeAction', { actionId: 'pause' }));

			await expect(executeEntityCommandInDaemon({
				entity: 'Mission',
				method: 'writeDocument',
				payload: { missionId: 'mission-1', path: '/repo/root/README.md', content: 'Updated' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ filePath: '/repo/root/README.md' });

			expect(querySpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
			expect(commandSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
		} finally {
			for (const spy of [...querySpies, ...commandSpies]) {
				spy.mockRestore();
			}
		}
	});

	it('dispatches child Mission entities through explicit handlers', async () => {
		const querySpies = [
			vi.spyOn(StageCommands, 'read').mockResolvedValue(createMissionStageSnapshot()),
			vi.spyOn(StageCommands, 'listCommands').mockResolvedValue(createStageCommandListSnapshot()),
			vi.spyOn(TaskCommands, 'read').mockResolvedValue(createMissionTaskSnapshot()),
			vi.spyOn(TaskCommands, 'listCommands').mockResolvedValue(createTaskCommandListSnapshot()),
			vi.spyOn(ArtifactCommands, 'read').mockResolvedValue(createMissionArtifactSnapshot()),
			vi.spyOn(ArtifactCommands, 'readDocument').mockResolvedValue(createArtifactDocumentSnapshot()),
			vi.spyOn(ArtifactCommands, 'listCommands').mockResolvedValue(createArtifactCommandListSnapshot()),
			vi.spyOn(AgentSessionCommands, 'read').mockResolvedValue(createMissionAgentSessionSnapshot()),
			vi.spyOn(AgentSessionCommands, 'listCommands').mockResolvedValue(createAgentSessionCommandListSnapshot())
		];
		const commandSpies = [
			vi.spyOn(StageCommands, 'executeCommand').mockResolvedValue(createStageCommandAcknowledgement()),
			vi.spyOn(TaskCommands, 'executeCommand').mockResolvedValue(createTaskCommandAcknowledgement()),
			vi.spyOn(ArtifactCommands, 'writeDocument').mockResolvedValue(createArtifactDocumentSnapshot('Updated')),
			vi.spyOn(ArtifactCommands, 'executeCommand').mockResolvedValue(createArtifactCommandAcknowledgement()),
			vi.spyOn(AgentSessionCommands, 'executeCommand').mockResolvedValue(createAgentSessionCommandAcknowledgement('executeCommand')),
			vi.spyOn(AgentSessionCommands, 'sendPrompt').mockResolvedValue(createAgentSessionCommandAcknowledgement('sendPrompt')),
			vi.spyOn(AgentSessionCommands, 'sendCommand').mockResolvedValue(createAgentSessionCommandAcknowledgement('sendCommand'))
		];

		try {
			await expect(executeEntityQueryInDaemon({
				entity: 'Stage',
				method: 'read',
				payload: { missionId: 'mission-1', stageId: 'implementation' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ stageId: 'implementation' });

			await expect(executeEntityQueryInDaemon({
				entity: 'Stage',
				method: 'listCommands',
				payload: { missionId: 'mission-1', stageId: 'implementation' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ entity: 'Stage', stageId: 'implementation' });

			await expect(executeEntityCommandInDaemon({
				entity: 'Stage',
				method: 'executeCommand',
				payload: { missionId: 'mission-1', stageId: 'implementation', commandId: 'stage.generateTasks' }
			}, { surfacePath: '/repo/root' })).resolves.toEqual(createStageCommandAcknowledgement());

			await expect(executeEntityQueryInDaemon({
				entity: 'Task',
				method: 'read',
				payload: { missionId: 'mission-1', taskId: 'implementation/01-task' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ taskId: 'implementation/01-task' });

			await expect(executeEntityQueryInDaemon({
				entity: 'Task',
				method: 'listCommands',
				payload: { missionId: 'mission-1', taskId: 'implementation/01-task' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ entity: 'Task', taskId: 'implementation/01-task' });

			await expect(executeEntityCommandInDaemon({
				entity: 'Task',
				method: 'executeCommand',
				payload: { missionId: 'mission-1', taskId: 'implementation/01-task', commandId: 'task.start' }
			}, { surfacePath: '/repo/root' })).resolves.toEqual(createTaskCommandAcknowledgement());

			await expect(executeEntityQueryInDaemon({
				entity: 'Artifact',
				method: 'read',
				payload: { missionId: 'mission-1', artifactId: 'mission:brief' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ artifactId: 'mission:brief' });

			await expect(executeEntityQueryInDaemon({
				entity: 'Artifact',
				method: 'readDocument',
				payload: { missionId: 'mission-1', artifactId: 'mission:brief' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ content: 'Artifact document' });

			await expect(executeEntityQueryInDaemon({
				entity: 'Artifact',
				method: 'listCommands',
				payload: { missionId: 'mission-1', artifactId: 'mission:brief' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ entity: 'Artifact', artifactId: 'mission:brief' });

			await expect(executeEntityCommandInDaemon({
				entity: 'Artifact',
				method: 'writeDocument',
				payload: { missionId: 'mission-1', artifactId: 'mission:brief', content: 'Updated' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ content: 'Updated' });

			await expect(executeEntityCommandInDaemon({
				entity: 'Artifact',
				method: 'executeCommand',
				payload: { missionId: 'mission-1', artifactId: 'mission:brief', commandId: 'artifact.review' }
			}, { surfacePath: '/repo/root' })).resolves.toEqual(createArtifactCommandAcknowledgement());

			await expect(executeEntityQueryInDaemon({
				entity: 'AgentSession',
				method: 'read',
				payload: { missionId: 'mission-1', sessionId: 'session-1' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ sessionId: 'session-1' });

			await expect(executeEntityQueryInDaemon({
				entity: 'AgentSession',
				method: 'listCommands',
				payload: { missionId: 'mission-1', sessionId: 'session-1' }
			}, { surfacePath: '/repo/root' })).resolves.toMatchObject({ entity: 'AgentSession', sessionId: 'session-1' });

			await expect(executeEntityCommandInDaemon({
				entity: 'AgentSession',
				method: 'executeCommand',
				payload: { missionId: 'mission-1', sessionId: 'session-1', commandId: 'agentSession.cancel' }
			}, { surfacePath: '/repo/root' })).resolves.toEqual(createAgentSessionCommandAcknowledgement('executeCommand'));

			await expect(executeEntityCommandInDaemon({
				entity: 'AgentSession',
				method: 'sendPrompt',
				payload: { missionId: 'mission-1', sessionId: 'session-1', prompt: { source: 'operator', text: 'Continue.' } }
			}, { surfacePath: '/repo/root' })).resolves.toEqual(createAgentSessionCommandAcknowledgement('sendPrompt'));

			await expect(executeEntityCommandInDaemon({
				entity: 'AgentSession',
				method: 'sendCommand',
				payload: { missionId: 'mission-1', sessionId: 'session-1', command: { type: 'nudge' } }
			}, { surfacePath: '/repo/root' })).resolves.toEqual(createAgentSessionCommandAcknowledgement('sendCommand'));

			expect(querySpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
			expect(commandSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
		} finally {
			for (const spy of [...querySpies, ...commandSpies]) {
				spy.mockRestore();
			}
		}
	});

	it('rejects invalid child entity payloads and results before returning', async () => {
		await expect(executeEntityQueryInDaemon({
			entity: 'Task',
			method: 'read',
			payload: { missionId: 'mission-1', taskId: 'implementation/01-task', context: { taskId: 'implementation/01-task' } }
		}, {
			surfacePath: process.cwd()
		})).rejects.toBeInstanceOf(ZodError);

		const readTaskSpy = vi.spyOn(TaskCommands, 'read').mockResolvedValue({ bad: true } as never);
		try {
			await expect(executeEntityQueryInDaemon({
				entity: 'Task',
				method: 'read',
				payload: { missionId: 'mission-1', taskId: 'implementation/01-task' }
			}, {
				surfacePath: process.cwd()
			})).rejects.toBeInstanceOf(ZodError);
		} finally {
			readTaskSpy.mockRestore();
		}

		const commandSpy = vi.spyOn(TaskCommands, 'executeCommand').mockResolvedValue({
			ok: true,
			entity: 'Task',
			method: 'executeCommand',
			id: 'implementation/01-task',
			missionId: 'mission-1',
			taskId: 'implementation/01-task',
			commandId: 'task.start',
			status: { missionId: 'mission-1' }
		} as never);
		try {
			await expect(executeEntityCommandInDaemon({
				entity: 'Task',
				method: 'executeCommand',
				payload: { missionId: 'mission-1', taskId: 'implementation/01-task', commandId: 'task.start' }
			}, {
				surfacePath: process.cwd()
			})).rejects.toBeInstanceOf(ZodError);
		} finally {
			commandSpy.mockRestore();
		}
	});

	it('fails loudly when child command collaborators cannot resolve the mission or child entity', async () => {
		await expect(StageCommands.read({
			missionId: 'missing-mission',
			stageId: 'implementation'
		}, {
			surfacePath: '/repo/root',
			loadRuntime: async () => undefined
		})).rejects.toThrow("Mission 'missing-mission' could not be resolved.");

		const emptyRuntime = createMissionRuntimeHandle({
			...createMissionSnapshot().mission,
			stages: [],
			artifacts: [],
			agentSessions: []
		});
		const context = {
			surfacePath: '/repo/root',
			loadRuntime: async () => emptyRuntime
		};

		await expect(StageCommands.read({
			missionId: 'mission-1',
			stageId: 'implementation'
		}, context)).rejects.toThrow("Stage 'implementation' could not be resolved in Mission 'mission-1'.");

		await expect(TaskCommands.read({
			missionId: 'mission-1',
			taskId: 'implementation/01-task'
		}, context)).rejects.toThrow("Task 'implementation/01-task' could not be resolved in Mission 'mission-1'.");

		await expect(ArtifactCommands.read({
			missionId: 'mission-1',
			artifactId: 'mission:brief'
		}, context)).rejects.toThrow("Artifact 'mission:brief' could not be resolved in Mission 'mission-1'.");

		await expect(AgentSessionCommands.read({
			missionId: 'mission-1',
			sessionId: 'session-1'
		}, context)).rejects.toThrow("AgentSession 'session-1' could not be resolved in Mission 'mission-1'.");
	});

	it('fails loudly for unknown entities and methods', async () => {
		await expect(executeEntityQueryInDaemon({
			entity: 'UnknownEntity',
			method: 'read',
			payload: {}
		}, {
			surfacePath: process.cwd()
		})).rejects.toThrow("Entity 'UnknownEntity' is not implemented in the daemon.");

		await expect(executeEntityQueryInDaemon({
			entity: 'Repository',
			method: 'missing',
			payload: {}
		}, {
			surfacePath: process.cwd()
		})).rejects.toThrow("Query method 'Repository.missing' is not implemented in the daemon.");

		await expect(executeEntityCommandInDaemon({
			entity: 'Mission',
			method: 'missing',
			payload: {}
		}, {
			surfacePath: process.cwd()
		})).rejects.toThrow("Command method 'Mission.missing' is not implemented in the daemon.");
	});

	it('rejects invalid Mission payloads and results before returning', async () => {
		await expect(executeEntityQueryInDaemon({
			entity: 'Mission',
			method: 'read',
			payload: { missionId: 'mission-1', unexpected: true }
		}, {
			surfacePath: process.cwd()
		})).rejects.toBeInstanceOf(ZodError);

		const readSpy = vi.spyOn(MissionCommands, 'read').mockResolvedValue({ bad: true } as never);
		try {
			await expect(executeEntityQueryInDaemon({
				entity: 'Mission',
				method: 'read',
				payload: { missionId: 'mission-1' }
			}, {
				surfacePath: process.cwd()
			})).rejects.toBeInstanceOf(ZodError);
		} finally {
			readSpy.mockRestore();
		}

		const commandSpy = vi.spyOn(MissionCommands, 'command').mockResolvedValue({
			ok: true,
			entity: 'Mission',
			method: 'command',
			id: 'mission-1',
			missionId: 'mission-1',
			status: { missionId: 'mission-1' }
		} as never);
		try {
			await expect(executeEntityCommandInDaemon({
				entity: 'Mission',
				method: 'command',
				payload: { missionId: 'mission-1', command: { action: 'pause' } }
			}, {
				surfacePath: process.cwd()
			})).rejects.toBeInstanceOf(ZodError);
		} finally {
			commandSpy.mockRestore();
		}
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

function createMissionSnapshot(): MissionSnapshot {
	return {
		mission: {
			missionId: 'mission-1',
			title: 'Mission One',
			type: 'task' as const,
			lifecycle: 'running' as const,
			currentStageId: 'implementation',
			updatedAt: '2026-04-26T13:36:00.000Z',
			artifacts: [],
			stages: [createMissionStageSnapshot()],
			agentSessions: []
		},
		status: {
			missionId: 'mission-1',
			title: 'Mission One',
			type: 'task',
			workflow: {
				lifecycle: 'running',
				updatedAt: '2026-04-26T13:36:00.000Z',
				currentStageId: 'implementation',
				stages: [createMissionStageSnapshot()]
			}
		},
		workflow: {
			lifecycle: 'running',
			updatedAt: '2026-04-26T13:36:00.000Z',
			currentStageId: 'implementation',
			stages: [createMissionStageSnapshot()]
		},
		stages: [createMissionStageSnapshot()],
		tasks: [createMissionTaskSnapshot()],
		artifacts: [createMissionArtifactSnapshot()],
		agentSessions: [createMissionAgentSessionSnapshot()]
	};
}

function createMissionRuntimeHandle(snapshot: MissionSnapshot['mission']): MissionRuntimeHandle {
	return {
		clearMissionPanic: vi.fn(async () => undefined),
		completeAgentSession: vi.fn(),
		completeTask: vi.fn(async () => undefined),
		dispose: vi.fn(),
		executeAction: vi.fn(),
		listAvailableActionsSnapshot: vi.fn(async () => ({ actions: [] })),
		cancelAgentSession: vi.fn(),
		deliver: vi.fn(),
		panicStopMission: vi.fn(async () => undefined),
		pauseMission: vi.fn(async () => undefined),
		reopenTask: vi.fn(async () => undefined),
		restartLaunchQueue: vi.fn(async () => undefined),
		resumeMission: vi.fn(async () => undefined),
		sendAgentSessionCommand: vi.fn(),
		sendAgentSessionPrompt: vi.fn(),
		startTask: vi.fn(async () => undefined),
		terminateAgentSession: vi.fn(),
		toEntity: vi.fn(async () => ({
			toSnapshot: () => snapshot
		}))
	} as unknown as MissionRuntimeHandle;
}

function createMissionProjectionSnapshot(): MissionProjectionSnapshot {
	return {
		missionId: 'mission-1',
		status: createMissionSnapshot().status,
		workflow: createMissionSnapshot().workflow,
		actions: createMissionActionListSnapshot(),
		updatedAt: '2026-04-26T13:36:00.000Z'
	};
}

function createMissionActionListSnapshot(): MissionActionListSnapshot {
	return {
		missionId: 'mission-1',
		actions: [
			{
				actionId: 'pause',
				label: 'Pause',
				kind: 'mission' as const,
				target: { scope: 'mission' },
				disabled: false
			}
		]
	};
}

function createMissionDocumentSnapshot(): MissionDocumentSnapshot {
	return {
		filePath: '/repo/root/README.md',
		content: 'Mission document',
		updatedAt: '2026-04-26T13:36:00.000Z'
	};
}

function createMissionWorktreeSnapshot(): MissionWorktreeSnapshot {
	return {
		rootPath: '/repo/root/.mission/worktrees/mission-1',
		fetchedAt: '2026-04-26T13:36:00.000Z',
		tree: [
			{
				name: 'README.md',
				relativePath: 'README.md',
				absolutePath: '/repo/root/.mission/worktrees/mission-1/README.md',
				kind: 'file' as const
			}
		]
	};
}

function createMissionAcknowledgement(
	method: 'command' | 'taskCommand' | 'sessionCommand' | 'executeAction',
	identifiers: { taskId?: string; sessionId?: string; actionId?: string } = {}
): MissionCommandAcknowledgement {
	return {
		ok: true as const,
		entity: 'Mission' as const,
		method,
		id: 'mission-1',
		missionId: 'mission-1',
		...identifiers
	};
}

function createMissionStageSnapshot() {
	return {
		stageId: 'implementation',
		lifecycle: 'active' as const,
		isCurrentStage: true,
		artifacts: [],
		tasks: [createMissionTaskSnapshot()]
	};
}

function createMissionTaskSnapshot() {
	return {
		taskId: 'implementation/01-task',
		stageId: 'implementation',
		sequence: 1,
		title: 'Implement Task',
		instruction: 'Do the work.',
		lifecycle: 'ready' as const,
		dependsOn: [],
		waitingOnTaskIds: [],
		agentRunner: 'copilot-cli',
		retries: 0
	};
}

function createMissionArtifactSnapshot() {
	return {
		artifactId: 'mission:brief',
		kind: 'mission' as const,
		label: 'Brief',
		fileName: 'BRIEF.md',
		filePath: '/repo/root/BRIEF.md',
		relativePath: 'BRIEF.md'
	};
}

function createMissionAgentSessionSnapshot() {
	return {
		sessionId: 'session-1',
		runnerId: 'copilot-cli',
		runnerLabel: 'Copilot CLI',
		lifecycleState: 'running' as const,
		createdAt: '2026-04-26T13:36:00.000Z',
		lastUpdatedAt: '2026-04-26T13:37:00.000Z'
	};
}

function createStageCommandListSnapshot() {
	return {
		entity: 'Stage' as const,
		entityId: 'implementation',
		missionId: 'mission-1',
		stageId: 'implementation',
		commands: [
			{ commandId: 'stage.generateTasks', label: 'Generate Tasks', disabled: true, disabledReason: 'Stage already has tasks.' }
		]
	};
}

function createTaskCommandListSnapshot() {
	return {
		entity: 'Task' as const,
		entityId: 'implementation/01-task',
		missionId: 'mission-1',
		taskId: 'implementation/01-task',
		commands: [
			{ commandId: 'task.start', label: 'Start Ready Task', disabled: false }
		]
	};
}

function createArtifactCommandListSnapshot() {
	return {
		entity: 'Artifact' as const,
		entityId: 'mission:brief',
		missionId: 'mission-1',
		artifactId: 'mission:brief',
		commands: []
	};
}

function createAgentSessionCommandListSnapshot() {
	return {
		entity: 'AgentSession' as const,
		entityId: 'session-1',
		missionId: 'mission-1',
		sessionId: 'session-1',
		commands: [
			{ commandId: 'agentSession.cancel', label: 'Cancel', disabled: false }
		]
	};
}

function createArtifactDocumentSnapshot(content = 'Artifact document') {
	return {
		filePath: '/repo/root/BRIEF.md',
		content,
		updatedAt: '2026-04-26T13:36:00.000Z'
	};
}

function createStageCommandAcknowledgement() {
	return {
		ok: true as const,
		entity: 'Stage' as const,
		method: 'executeCommand' as const,
		id: 'implementation',
		missionId: 'mission-1',
		stageId: 'implementation',
		commandId: 'stage.generateTasks'
	};
}

function createTaskCommandAcknowledgement() {
	return {
		ok: true as const,
		entity: 'Task' as const,
		method: 'executeCommand' as const,
		id: 'implementation/01-task',
		missionId: 'mission-1',
		taskId: 'implementation/01-task',
		commandId: 'task.start'
	};
}

function createArtifactCommandAcknowledgement() {
	return {
		ok: true as const,
		entity: 'Artifact' as const,
		method: 'executeCommand' as const,
		id: 'mission:brief',
		missionId: 'mission-1',
		artifactId: 'mission:brief',
		commandId: 'artifact.review'
	};
}

function createAgentSessionCommandAcknowledgement(method: 'executeCommand' | 'sendPrompt' | 'sendCommand') {
	return {
		ok: true as const,
		entity: 'AgentSession' as const,
		method,
		id: 'session-1',
		missionId: 'mission-1',
		sessionId: 'session-1',
		...(method === 'executeCommand' ? { commandId: 'agentSession.cancel' } : {})
	};
}