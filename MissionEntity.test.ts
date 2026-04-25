import { describe, expect, it } from 'vitest';
import type { OperatorStatus } from '../types.js';
import { Mission } from '../entities/Mission/Mission.js';

describe('Mission.read', () => {
	it('builds first-class stage, task, artifact, and session contracts from operator status', () => {
		const mission = Mission.read({
			found: true,
			missionId: 'mission-29',
			title: 'Authoritative entity vocabulary',
			type: 'refactor',
			stage: 'implementation',
			branchRef: 'mission/29-architectural-reset-strict-ood-entity-architectu',
			missionDir: '/workspace/.mission/missions/29',
			missionRootDir: '/workspace/.mission/missions/29',
			productFiles: {
				brief: '/workspace/.mission/missions/29/BRIEF.md',
				verify: '/workspace/.mission/missions/29/03-IMPLEMENTATION/VERIFY.md'
			},
			stages: [
				{
					stage: 'implementation',
					folderName: '03-IMPLEMENTATION',
					status: 'active',
					taskCount: 1,
					completedTaskCount: 0,
					activeTaskIds: ['implementation/01-authority'],
					readyTaskIds: [],
					tasks: [
						{
							taskId: 'implementation/01-authority',
							stage: 'implementation',
							sequence: 1,
							subject: 'Define authoritative contracts',
							instruction: 'Replace DTO leakage with explicit entities.',
							body: 'Replace DTO leakage with explicit entities.',
							dependsOn: [],
							waitingOn: [],
							status: 'running',
							agent: 'copilot-cli',
							retries: 0,
							fileName: '01-define-authoritative-backend-entity-vocabulary.md',
							filePath: '/workspace/.mission/missions/29/03-IMPLEMENTATION/tasks/01-define-authoritative-backend-entity-vocabulary.md',
							relativePath: '03-IMPLEMENTATION/tasks/01-define-authoritative-backend-entity-vocabulary.md'
						}
					]
				}
			],
			agentSessions: [
				{
					sessionId: 'session-1',
					runnerId: 'copilot',
					runnerLabel: 'Copilot',
					lifecycleState: 'running',
					taskId: 'implementation/01-authority',
					transportId: 'terminal',
					terminalSessionName: 'tower',
					terminalPaneId: '%7',
					createdAt: '2026-04-22T20:00:00.000Z',
					lastUpdatedAt: '2026-04-22T20:05:00.000Z'
				}
			],
			workflow: {
				lifecycle: 'running',
				pause: { paused: false },
				panic: {
					active: false,
					terminateSessions: false,
					clearLaunchQueue: false,
					haltMission: false
				},
				currentStageId: 'implementation',
				configuration: {
					createdAt: '2026-04-22T20:00:00.000Z',
					source: 'global-settings',
					workflowVersion: 'test',
					workflow: {
						autostart: { mission: false },
						humanInLoop: { enabled: false, pauseOnMissionStart: false },
						panic: {
							terminateSessions: false,
							clearLaunchQueue: false,
							haltMission: false
						},
						execution: { maxParallelTasks: 1, maxParallelSessions: 1 },
						stageOrder: ['implementation'],
						stages: {
							implementation: {
								stageId: 'implementation',
								displayName: 'Implementation',
								taskLaunchPolicy: { defaultAutostart: false }
							}
						},
						taskGeneration: [],
						gates: []
					}
				},
				stages: [],
				tasks: [],
				gates: [],
				updatedAt: '2026-04-22T20:05:00.000Z'
			},
			recommendedAction: 'Finish the entity vocabulary slice.'
		} satisfies Partial<OperatorStatus> as OperatorStatus);

		expect(mission.lifecycle).toBe('running');
		expect(mission.currentStageId).toBe('implementation');
		expect(mission.stages[0]).toMatchObject({
			stageId: 'implementation',
			lifecycle: 'active',
			isCurrentStage: true
		});
		expect(mission.stages[0]?.tasks[0]).toMatchObject({
			taskId: 'implementation/01-authority',
			title: 'Define authoritative contracts',
			lifecycle: 'running'
		});
		expect(mission.artifacts.map((artifact) => artifact.artifactId)).toEqual([
			'mission:brief',
			'stage:implementation:verify',
			'task:implementation/01-authority'
		]);
		expect(mission.agentSessions[0]?.terminalHandle).toEqual({
			sessionName: 'tower',
			paneId: '%7'
		});
	});
});
