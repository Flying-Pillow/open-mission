import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod/v4';
import {
	executeEntityCommandInDaemon,
	executeEntityQueryInDaemon
} from './entityRemote.js';
import { MissionRegistry, type MissionHandle } from './MissionRegistry.js';
import { Repository } from '../entities/Repository/Repository.js';
import { PROTOCOL_VERSION } from './protocol/transport.js';
import type {
	MissionCommandAcknowledgementType,
	MissionSnapshotType,
} from '../entities/Mission/MissionSchema.js';
import { RepositoryMissionStartAcknowledgementSchema } from '../entities/Repository/RepositorySchema.js';

describe('daemon entity dispatch', () => {
	it('uses the bumped daemon protocol version', () => {
		expect(PROTOCOL_VERSION).toBe(28);
	});

	it('uses source acknowledgements for Repository mission-start commands', () => {
		expect(RepositoryMissionStartAcknowledgementSchema.parse({
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

		expect(() => RepositoryMissionStartAcknowledgementSchema.parse({
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
			...Repository.open('/tmp/mission-proof-of-concept').toSchema(),
			controlRoot: '/tmp/mission-proof-of-concept'
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

	it('dispatches Repository platform-backed source methods through explicit handlers', async () => {
		const repositorySnapshot = {
			...Repository.open('/tmp/mission-proof-of-concept').toSchema(),
			controlRoot: '/tmp/mission-proof-of-concept'
		};
		const findSpy = vi.spyOn(Repository, 'findAvailable').mockResolvedValue([
			{
				platform: 'github',
				repositoryRef: 'Flying-Pillow/mission',
				name: 'mission',
				topics: [],
				ownerLogin: 'Flying-Pillow',
				visibility: 'public',
				archived: false
			}
		]);
		const addSpy = vi.spyOn(Repository, 'add').mockResolvedValue(repositorySnapshot);

		try {
			await expect(executeEntityQueryInDaemon({
				entity: 'Repository',
				method: 'findAvailable',
				payload: {}
			}, {
				surfacePath: '/repo/root',
				authToken: 'token'
			})).resolves.toEqual([
				{
					platform: 'github',
					repositoryRef: 'Flying-Pillow/mission',
					name: 'mission',
					topics: [],
					ownerLogin: 'Flying-Pillow',
					visibility: 'public',
					archived: false
				}
			]);

			await expect(executeEntityCommandInDaemon({
				entity: 'Repository',
				method: 'add',
				payload: {
					platform: 'github',
					repositoryRef: 'Flying-Pillow/mission',
					destinationPath: '/repositories/Flying-Pillow/mission'
				}
			}, {
				surfacePath: '/repo/root',
				authToken: 'token'
			})).resolves.toMatchObject(repositorySnapshot);

			expect(findSpy).toHaveBeenCalledWith({}, { surfacePath: '/repo/root', authToken: 'token' });
			expect(addSpy).toHaveBeenCalledWith({
				platform: 'github',
				repositoryRef: 'Flying-Pillow/mission',
				destinationPath: '/repositories/Flying-Pillow/mission'
			}, { surfacePath: '/repo/root', authToken: 'token' });
		} finally {
			findSpy.mockRestore();
			addSpy.mockRestore();
		}
	});

	it('dispatches Repository instance methods through explicit handlers', async () => {
		const snapshot = {
			...Repository.open('/tmp/mission-proof-of-concept').toSchema(),
			controlRoot: '/tmp/mission-proof-of-concept'
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
			id: 'repository:local/mission-proof-of-concept/00000000',
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

			expect(resolveSpy).toHaveBeenNthCalledWith(1, identity, { surfacePath: process.cwd() });
			expect(resolveSpy).toHaveBeenNthCalledWith(2, identity, { surfacePath: process.cwd() });
			expect(resolveSpy).toHaveBeenNthCalledWith(3, { ...identity, issueNumber: 1 }, { surfacePath: process.cwd() });
			expect(resolveSpy).toHaveBeenNthCalledWith(4, { ...identity, issueNumber: 1 }, { surfacePath: process.cwd() });
			expect(resolveSpy).toHaveBeenNthCalledWith(5, {
				...identity,
				title: 'Mission title',
				body: 'Mission body',
				type: 'feature'
			}, { surfacePath: process.cwd() });
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
		const mission = createMissionHandle(createMissionSnapshot().mission);
		const loadMission = vi.fn(async () => mission);
		const context = {
			surfacePath: '/repo/root',
			missionRegistry: new MissionRegistry({ loadMission })
		};

		await expect(executeEntityQueryInDaemon({
			entity: 'Mission',
			method: 'read',
			payload: { missionId: 'mission-1' }
		}, context)).resolves.toMatchObject({ mission: { missionId: 'mission-1' } });

		await expect(executeEntityQueryInDaemon({
			entity: 'Mission',
			method: 'readProjection',
			payload: { missionId: 'mission-1' }
		}, context)).resolves.toMatchObject({ missionId: 'mission-1' });

		await expect(executeEntityCommandInDaemon({
			entity: 'Mission',
			method: 'command',
			payload: { missionId: 'mission-1', commandId: 'mission.pause' }
		}, context)).resolves.toEqual(createMissionAcknowledgement('command'));

		await expect(executeEntityCommandInDaemon({
			entity: 'Mission',
			method: 'taskCommand',
			payload: { missionId: 'mission-1', taskId: 'implementation/01-task', commandId: 'task.complete' }
		}, context)).resolves.toEqual(createMissionAcknowledgement('taskCommand', { taskId: 'implementation/01-task' }));

		await expect(executeEntityCommandInDaemon({
			entity: 'Mission',
			method: 'sessionCommand',
			payload: { missionId: 'mission-1', sessionId: 'session-1', commandId: 'agentSession.complete' }
		}, context)).resolves.toEqual(createMissionAcknowledgement('sessionCommand', { sessionId: 'session-1' }));

		expect(mission.command).toHaveBeenCalledOnce();
		expect(mission.taskCommand).toHaveBeenCalledOnce();
		expect(mission.sessionCommand).toHaveBeenCalledOnce();
		expect(loadMission).toHaveBeenCalledTimes(1);
		expect(mission.dispose).not.toHaveBeenCalled();
	});

	it('dispatches child Mission entities through explicit handlers', async () => {
		const mission = createMissionHandle({
			...createMissionSnapshot().mission,
			artifacts: [createMissionArtifactSnapshot()],
			agentSessions: [createAgentSessionSnapshot()]
		});
		const loadMission = vi.fn(async () => mission);
		const context = {
			surfacePath: '/repo/root',
			missionRegistry: new MissionRegistry({ loadMission })
		};

		await expect(executeEntityQueryInDaemon({
			entity: 'Stage',
			method: 'read',
			payload: { missionId: 'mission-1', stageId: 'implementation' }
		}, context)).resolves.toMatchObject({ stageId: 'implementation' });

		await expect(executeEntityCommandInDaemon({
			entity: 'Stage',
			method: 'executeCommand',
			payload: { missionId: 'mission-1', stageId: 'implementation', commandId: 'stage.generateTasks' }
		}, context)).resolves.toEqual(createStageCommandAcknowledgement());

		await expect(executeEntityQueryInDaemon({
			entity: 'Task',
			method: 'read',
			payload: { missionId: 'mission-1', taskId: 'implementation/01-task' }
		}, context)).resolves.toMatchObject({ taskId: 'implementation/01-task' });

		await expect(executeEntityCommandInDaemon({
			entity: 'Task',
			method: 'executeCommand',
			payload: { missionId: 'mission-1', taskId: 'implementation/01-task', commandId: 'task.start' }
		}, context)).resolves.toEqual(createTaskCommandAcknowledgement());

		await expect(executeEntityQueryInDaemon({
			entity: 'Artifact',
			method: 'read',
			payload: { missionId: 'mission-1', artifactId: 'mission:brief' }
		}, context)).resolves.toMatchObject({ artifactId: 'mission:brief' });

		await expect(executeEntityCommandInDaemon({
			entity: 'Artifact',
			method: 'executeCommand',
			payload: { missionId: 'mission-1', artifactId: 'mission:brief', commandId: 'artifact.review' }
		}, context)).rejects.toThrow("Command method 'Artifact.executeCommand' is not implemented in the daemon.");

		await expect(executeEntityQueryInDaemon({
			entity: 'AgentSession',
			method: 'read',
			payload: { missionId: 'mission-1', sessionId: 'session-1' }
		}, context)).resolves.toMatchObject({ sessionId: 'session-1' });

		await expect(executeEntityCommandInDaemon({
			entity: 'AgentSession',
			method: 'executeCommand',
			payload: { missionId: 'mission-1', sessionId: 'session-1', commandId: 'agentSession.cancel' }
		}, context)).resolves.toEqual(createAgentSessionCommandAcknowledgement('executeCommand'));

		await expect(executeEntityCommandInDaemon({
			entity: 'AgentSession',
			method: 'sendPrompt',
			payload: { missionId: 'mission-1', sessionId: 'session-1', prompt: { source: 'operator', text: 'Continue.' } }
		}, context)).resolves.toEqual(createAgentSessionCommandAcknowledgement('sendPrompt'));

		await expect(executeEntityCommandInDaemon({
			entity: 'AgentSession',
			method: 'sendCommand',
			payload: { missionId: 'mission-1', sessionId: 'session-1', command: { type: 'nudge' } }
		}, context)).resolves.toEqual(createAgentSessionCommandAcknowledgement('sendCommand'));

		expect(mission.generateTasksForStage).toHaveBeenCalledWith('implementation');
		expect(mission.startTask).toHaveBeenCalledWith('implementation/01-task', {});
		expect(mission.cancelAgentSession).toHaveBeenCalledWith('session-1', undefined);
		expect(mission.sendAgentSessionPrompt).toHaveBeenCalledOnce();
		expect(mission.sendAgentSessionCommand).toHaveBeenCalledOnce();
		expect(loadMission).toHaveBeenCalledTimes(1);
		expect(mission.dispose).not.toHaveBeenCalled();
	});

	it('rejects invalid child entity payloads and unavailable mission context', async () => {
		await expect(executeEntityQueryInDaemon({
			entity: 'Task',
			method: 'read',
			payload: { missionId: 'mission-1', taskId: 'implementation/01-task', context: { taskId: 'implementation/01-task' } }
		}, {
			surfacePath: process.cwd()
		})).rejects.toBeInstanceOf(ZodError);

		await expect(executeEntityQueryInDaemon({
			entity: 'Task',
			method: 'read',
			payload: { missionId: 'mission-1', taskId: 'implementation/01-task' }
		}, {
			surfacePath: process.cwd(),
			missionRegistry: new MissionRegistry({ loadMission: async () => undefined })
		})).rejects.toThrow("Mission 'mission-1' could not be resolved.");
	});

	it('fails loudly when child contracts cannot resolve the mission or child entity', async () => {
		await expect(executeEntityQueryInDaemon({
			entity: 'Stage',
			method: 'read',
			payload: { missionId: 'missing-mission', stageId: 'implementation' }
		}, {
			surfacePath: '/repo/root',
			missionRegistry: new MissionRegistry({ loadMission: async () => undefined })
		})).rejects.toThrow("Mission 'missing-mission' could not be resolved.");

		const emptyMission = createMissionHandle({
			...createMissionSnapshot().mission,
			stages: [],
			artifacts: [],
			agentSessions: []
		});
		const context = {
			surfacePath: '/repo/root',
			missionRegistry: new MissionRegistry({ loadMission: async () => emptyMission })
		};

		await expect(executeEntityQueryInDaemon({
			entity: 'Stage',
			method: 'read',
			payload: { missionId: 'mission-1', stageId: 'implementation' }
		}, context)).rejects.toThrow("Stage 'implementation' could not be resolved in Mission 'mission-1'.");

		await expect(executeEntityQueryInDaemon({
			entity: 'Task',
			method: 'read',
			payload: { missionId: 'mission-1', taskId: 'implementation/01-task' }
		}, context)).rejects.toThrow("Task 'implementation/01-task' could not be resolved in Mission 'mission-1'.");

		await expect(executeEntityQueryInDaemon({
			entity: 'Artifact',
			method: 'read',
			payload: { missionId: 'mission-1', artifactId: 'mission:brief' }
		}, context)).rejects.toThrow("Artifact 'mission:brief' could not be resolved in Mission 'mission-1'.");

		await expect(executeEntityQueryInDaemon({
			entity: 'AgentSession',
			method: 'read',
			payload: { missionId: 'mission-1', sessionId: 'session-1' }
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

		await expect(executeEntityQueryInDaemon({
			entity: 'Mission',
			method: 'read',
			payload: { missionId: 'mission-1' }
		}, {
			surfacePath: process.cwd(),
			missionRegistry: new MissionRegistry({ loadMission: async () => createMissionHandle({ bad: true } as never) })
		})).rejects.toBeInstanceOf(ZodError);
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
				id: 'repository:local/missing/00000000'
			}
		}, {
			surfacePath: process.cwd()
		})).rejects.toThrow("Repository 'repository:local/missing/00000000' could not be resolved.");
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

function createMissionSnapshot(): MissionSnapshotType {
	return {
		mission: {
			missionId: 'mission-1',
			title: 'Mission One',
			type: 'task' as const,
			branchRef: 'mission/one',
			missionDir: '/repo/.mission/missions/mission-1',
			missionRootDir: '/repo/.mission/missions/mission-1',
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
		agentSessions: [createAgentSessionSnapshot()]
	};
}

function createMissionHandle(snapshot: MissionSnapshotType['mission']): MissionHandle {
	return {
		clearMissionPanic: vi.fn(async () => undefined),
		command: vi.fn(async () => createMissionAcknowledgement('command')),
		completeAgentSession: vi.fn(),
		completeTask: vi.fn(async () => undefined),
		dispose: vi.fn(),
		ensureTerminal: vi.fn(),
		cancelAgentSession: vi.fn(),
		deliver: vi.fn(),
		generateTasksForStage: vi.fn(async () => undefined),
		buildMissionSnapshot: vi.fn(async () => ({
			...createMissionSnapshot(),
			mission: snapshot,
			stages: snapshot.stages,
			tasks: snapshot.stages.flatMap((stage) => stage.tasks),
			artifacts: snapshot.artifacts,
			agentSessions: snapshot.agentSessions
		})),
		panicStopMission: vi.fn(async () => undefined),
		pauseMission: vi.fn(async () => undefined),
		read: vi.fn(async () => ({ ...createMissionSnapshot(), mission: snapshot })),
		readDocument: vi.fn(),
		readProjection: vi.fn(async () => ({ missionId: snapshot.missionId })),
		readTerminal: vi.fn(),
		readWorktree: vi.fn(),
		reopenTask: vi.fn(async () => undefined),
		restartLaunchQueue: vi.fn(async () => undefined),
		resumeMission: vi.fn(async () => undefined),
		reworkTask: vi.fn(async () => undefined),
		reworkTaskFromVerification: vi.fn(async () => undefined),
		sendAgentSessionCommand: vi.fn(),
		sendAgentSessionPrompt: vi.fn(),
		sendTerminalInput: vi.fn(),
		sessionCommand: vi.fn(async () => createMissionAcknowledgement('sessionCommand', { sessionId: 'session-1' })),
		startTask: vi.fn(async () => undefined),
		setTaskAutostart: vi.fn(async () => undefined),
		taskCommand: vi.fn(async () => createMissionAcknowledgement('taskCommand', { taskId: 'implementation/01-task' })),
		terminateAgentSession: vi.fn(),
		writeDocument: vi.fn(),
		toEntity: vi.fn(async () => ({
			toSnapshot: () => snapshot
		}))
	} as unknown as MissionHandle;
}

function createMissionAcknowledgement(
	method: 'command' | 'taskCommand' | 'sessionCommand',
	identifiers: { taskId?: string; sessionId?: string } = {}
): MissionCommandAcknowledgementType {
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

function createAgentSessionSnapshot() {
	return {
		sessionId: 'session-1',
		runnerId: 'copilot-cli',
		runnerLabel: 'Copilot CLI',
		lifecycleState: 'running' as const,
		createdAt: '2026-04-26T13:36:00.000Z',
		lastUpdatedAt: '2026-04-26T13:37:00.000Z'
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