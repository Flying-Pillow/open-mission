import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { DaemonApi } from '../client/DaemonApi.js';
import { DaemonClient } from '../client/DaemonClient.js';
import type { OperatorStatus } from '../types.js';
import { getMissionDaemonSettingsPath } from '../lib/daemonConfig.js';
import { initializeMissionRepository } from '../initializeMissionRepository.js';
import { startDaemon } from './Daemon.js';
import { getDaemonManifestPath, getDaemonRuntimePath } from './daemonPaths.js';
import { MissionSystemController } from './MissionSystemController.js';

describe('Daemon', () => {
	it('does not initialize daemon settings when a workspace first connects', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();

			try {
				const daemon = await startDaemon({ socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
				const client = new DaemonClient();
				try {
					await client.connect({ surfacePath: workspaceRoot, socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
					const api = new DaemonApi(client);
					const status = await api.control.getStatus();
					const settingsExists = await fs.access(getMissionDaemonSettingsPath(workspaceRoot)).then(
						() => true,
						() => false
					);

					expect(settingsExists).toBe(false);
					expect(status.operationalMode).toBe('setup');
					expect(status.control).toMatchObject({
						initialized: false,
						settingsPresent: false,
						settingsComplete: false
					});
					expect(status.control?.problems).toEqual(
						expect.arrayContaining([
							'Mission control scaffolding is missing.',
							'Mission settings are missing.'
						])
					);
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('does not crash when a ping-only client disconnects before scoping airport state', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			const socketPath = path.join(workspaceRoot, '.mission-daemon-test.sock');

			try {
				const daemon = await startDaemon({ socketPath });
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot, socketPath });
					const ping = await client.request<{ ok: boolean; protocolVersion: number }>('ping');
					expect(ping.ok).toBe(true);
				} finally {
					client.dispose();
				}

				const manifest = daemon.getManifest();
				expect(manifest?.pid).toBe(process.pid);
				await daemon.close();
			} finally {
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('serves workflow settings through the dedicated daemon API and emits update events', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();

			try {
				const daemon = await startDaemon({ socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot, socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
					const api = new DaemonApi(client);
					const initialized = await api.control.initializeWorkflowSettings();
					const initial = await api.control.getWorkflowSettings();
					const eventPromise = new Promise<unknown>((resolve) => {
						const subscription = client.onDidEvent((event) => {
							if (event.type === 'control.workflow.settings.updated') {
								subscription.dispose();
								resolve(event);
							}
						});
					});

					const updated = await api.control.updateWorkflowSettings({
						expectedRevision: initial.revision,
						patch: [
							{
								op: 'replace',
								path: '/execution/maxParallelTasks',
								value: 2
							}
						],
						context: {
							requestedBySurface: 'test-suite',
							requestedBy: 'vitest'
						}
					});
					const event = await eventPromise;

					expect(initialized.metadata.initialized).toBe(true);
					expect(updated.workflow.execution.maxParallelTasks).toBe(2);
					expect(updated.status.control?.settings.workflow?.execution.maxParallelTasks).toBe(2);
					expect(event).toMatchObject({
						type: 'control.workflow.settings.updated',
						revision: updated.revision,
						changedPaths: ['/execution/maxParallelTasks']
					});
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('rejects workflow updates with stale revisions after out-of-band edits', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();

			try {
				const daemon = await startDaemon({ socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot, socketPath: path.join(workspaceRoot, '.mission-daemon-test.sock') });
					const api = new DaemonApi(client);
					await api.control.initializeWorkflowSettings();
					const initial = await api.control.getWorkflowSettings();
					const settingsPath = getMissionDaemonSettingsPath(workspaceRoot);
					const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
					settings['workflow'] = {
						...(settings['workflow'] as Record<string, unknown>),
						execution: {
							maxParallelTasks: 3,
							maxParallelSessions: 1
						}
					};
					await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

					await expect(
						api.control.updateWorkflowSettings({
							expectedRevision: initial.revision,
							patch: [
								{
									op: 'replace',
									path: '/execution/maxParallelSessions',
									value: 4
								}
							],
							context: {
								requestedBySurface: 'test-suite',
								requestedBy: 'vitest'
							}
						})
					).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' });
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('keeps daemon runtime files out of the workspace', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			const manifestPath = getDaemonManifestPath();
			const workspaceDaemonPath = path.join(workspaceRoot, '.missions', 'daemon');

			try {
				const daemon = await startDaemon();
				try {
					const manifestContent = await fs.readFile(manifestPath, 'utf8');
					expect(manifestPath.startsWith(workspaceRoot)).toBe(false);
					expect(JSON.parse(manifestContent)).toMatchObject({
						endpoint: expect.any(Object),
						pid: expect.any(Number),
						protocolVersion: expect.any(Number),
						startedAt: expect.any(String)
					});
					const workspaceLocalDaemonExists = await fs.access(workspaceDaemonPath).then(
						() => true,
						() => false
					);
					expect(workspaceLocalDaemonExists).toBe(false);
				} finally {
					await daemon.close();
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('reports control status when no mission is selected', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);

			try {
				const daemon = await startDaemon();
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot });
					const api = new DaemonApi(client);
					const status = await api.control.getStatus();
					const issuesCommand = status.availableActions?.find((action) => action.action === '/issues');
					const setupCommand = status.availableActions?.find((action) => action.action === '/setup');

					expect(status.found).toBe(false);
					expect(status.operationalMode).toBe('setup');
					expect(status.control).toMatchObject({
						controlRoot: workspaceRoot,
						initialized: true,
						settingsPresent: true,
						settingsComplete: false,
						issuesConfigured: false
					});
					expect(issuesCommand).toMatchObject({ enabled: false });
					expect(setupCommand).toMatchObject({
						enabled: true,
						flow: expect.objectContaining({
							targetLabel: 'SETUP',
							actionLabel: 'SAVE'
						})
					});
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('attaches a daemon-owned system snapshot to control status responses', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);

			try {
				const daemon = await startDaemon();
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot });
					const api = new DaemonApi(client);
					const status = await api.control.getStatus();

					expect(status.system).toMatchObject({
						state: {
							version: expect.any(Number),
							domain: {
								selection: {
									repositoryId: workspaceRoot
								}
							},
							airport: {
								airportId: expect.stringMatching(/^airport:/),
								repositoryId: workspaceRoot,
								repositoryRootPath: workspaceRoot,
								gates: {
									dashboard: {
										targetKind: 'repository',
										targetId: workspaceRoot,
										mode: 'control'
									},
									editor: {
										targetKind: 'repository',
										targetId: workspaceRoot,
										mode: 'view'
									}
								},
								substrate: {
									sessionName: expect.stringContaining('mission-control-')
								}
							},
							airports: {
								activeRepositoryId: workspaceRoot,
								repositories: {
									[workspaceRoot]: {
										repositoryId: workspaceRoot
									}
								}
							}
						},
						airportProjections: {
							dashboard: {
								title: 'Dashboard',
								surfaceMode: 'repository',
								centerRoute: 'repository-flow',
								repositoryLabel: path.basename(workspaceRoot),
								commandContext: {
									targetLabel: path.basename(workspaceRoot),
									targetKind: 'repository'
								},
								stageRail: [],
								treeNodes: [],
								emptyLabel: 'Repository mode is ready.'
							},
							editor: {
								title: 'Editor',
								launchPath: workspaceRoot,
								emptyLabel: 'Editor gate is waiting for an artifact binding.'
							},
							pilot: {
								title: 'Pilot',
								statusLabel: 'idle',
								emptyLabel: 'Pilot gate is idle.'
							}
						},
						airportRegistryProjections: {
							[workspaceRoot]: {
								dashboard: {
									title: 'Dashboard',
									surfaceMode: 'repository',
									centerRoute: 'repository-flow'
								}
							}
						}
					});
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('projects mission-control data through the dashboard projection', async () => {
		const workspaceRoot = await createTempRepo();
		const controller = new MissionSystemController();
		const status = {
			found: true,
			control: {
				controlRoot: workspaceRoot,
				missionDirectory: path.join(workspaceRoot, '.missions'),
				settingsPath: path.join(workspaceRoot, 'mission.settings.json'),
				worktreesPath: path.join(workspaceRoot, '.missions', 'missions'),
				settings: {},
				isGitRepository: true,
				initialized: true,
				settingsPresent: true,
				settingsComplete: true,
				availableMissionCount: 1,
				problems: [],
				warnings: []
			},
			missionId: 'mission/airport-projection',
			title: 'Projection-backed mission control',
			stage: 'implementation',
			missionDir: path.join(workspaceRoot, '.missions', 'missions', 'mission-airport-projection'),
			workflow: {
				lifecycle: 'running',
				pause: { active: false },
				panic: { active: false },
				currentStageId: 'implementation',
				configuration: {
					stages: {},
					taskGeneration: []
				},
				stages: [],
				tasks: [],
				gates: [],
				updatedAt: new Date().toISOString()
			},
			stages: [
				{
					stage: 'implementation',
					label: 'Implement',
					status: 'active',
					taskCount: 1,
					completedTaskCount: 0,
					activeTaskIds: ['task-1'],
					readyTaskIds: [],
					tasks: [
						{
							taskId: 'task-1',
							stage: 'implementation',
							sequence: 1,
							subject: 'Implement airport projection',
							instruction: 'Project mission control through airport state.',
							body: 'Implement the projection rewrite.',
							dependsOn: [],
							blockedBy: [],
							status: 'active',
							agent: 'copilot',
							retries: 0,
							fileName: 'airport-projection.md',
							filePath: path.join(workspaceRoot, 'docs', 'airport-projection.md'),
							relativePath: 'docs/airport-projection.md'
						}
					]
				}
			],
			agentSessions: [
				{
					sessionId: 'session-1',
					taskId: 'task-1',
					runtimeId: 'copilot',
					lifecycleState: 'running',
					createdAt: new Date().toISOString(),
					workingDirectory: workspaceRoot
				}
			],
			tower: {
				stageRail: [
					{ id: 'implementation', label: 'IMPLEMENTATION', state: 'active', subtitle: '0/1' }
				],
				treeNodes: [
					{ id: 'tree:stage:implementation', label: 'IMPLEMENTATION', kind: 'stage', depth: 0, color: '#ffffff', collapsible: true, stageId: 'implementation' },
					{ id: 'tree:task:task-1', label: '1 Implement airport projection', kind: 'task', depth: 1, color: '#ffffff', collapsible: true, stageId: 'implementation', taskId: 'task-1' },
					{ id: 'tree:session:session-1', label: 'copilot ion-1', kind: 'session', depth: 2, color: '#ffffff', collapsible: false, stageId: 'implementation', taskId: 'task-1', sessionId: 'session-1' }
				]
			}
		} as unknown as OperatorStatus;

		try {
			const snapshot = await controller.observeOperatorStatus(status);
			expect(snapshot.airportProjections.dashboard).toMatchObject({
				surfaceMode: 'mission',
				centerRoute: 'mission-control',
				missionId: 'mission/airport-projection',
				commandContext: {
					stageId: 'implementation',
					taskId: 'task-1',
					sessionId: 'session-1',
					targetKind: 'session',
					targetLabel: 'session-1'
				},
				stageRail: expect.any(Array),
				treeNodes: expect.any(Array)
			});
			expect(snapshot.airportProjections.dashboard.stageRail.length).toBeGreaterThan(0);
			expect(snapshot.airportProjections.dashboard.treeNodes.length).toBeGreaterThan(0);
			expect(snapshot.airportProjections.dashboard.treeNodes[0]).toMatchObject({
				kind: 'stage',
				stageId: 'implementation'
			});
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('filters dashboard available actions by target ancestry without leaking stage task actions', async () => {
		const workspaceRoot = await createTempRepo();
		const controller = new MissionSystemController();
		const status = {
			found: true,
			control: {
				controlRoot: workspaceRoot,
				missionDirectory: path.join(workspaceRoot, '.missions'),
				settingsPath: path.join(workspaceRoot, 'mission.settings.json'),
				worktreesPath: path.join(workspaceRoot, '.missions', 'missions'),
				settings: {},
				isGitRepository: true,
				initialized: true,
				settingsPresent: true,
				settingsComplete: true,
				availableMissionCount: 1,
				problems: [],
				warnings: []
			},
			missionId: 'mission/airport-projection',
			title: 'Projection-backed mission control',
			stage: 'implementation',
			workflow: {
				lifecycle: 'running',
				pause: { active: false },
				panic: { active: false },
				currentStageId: 'implementation',
				configuration: {
					stages: {},
					taskGeneration: []
				},
				stages: [],
				tasks: [],
				gates: [],
				updatedAt: new Date().toISOString()
			},
			tower: {
				stageRail: [
					{ id: 'implementation', label: 'IMPLEMENTATION', state: 'active', subtitle: '0/1' }
				],
				treeNodes: [
					{ id: 'tree:stage:implementation', label: 'IMPLEMENTATION', kind: 'stage', depth: 0, color: '#ffffff', collapsible: true, stageId: 'implementation' }
				]
			},
			availableActions: [
				{
					id: 'mission.pause',
					label: 'Pause Mission',
					action: '/mission pause',
					scope: 'mission',
					disabled: false,
					disabledReason: '',
					enabled: true,
					presentationTargets: [{ scope: 'mission' }, { scope: 'stage', targetId: 'implementation' }]
				},
				{
					id: 'generation.tasks.implementation',
					label: 'Generate Implementation Tasks',
					action: '/generate',
					scope: 'generation',
					targetId: 'implementation',
					disabled: false,
					disabledReason: '',
					enabled: true,
					presentationTargets: [{ scope: 'stage', targetId: 'implementation' }]
				},
				{
					id: 'task.launch.implementation/02-workflow-engine',
					label: 'Launch Agent Session',
					action: '/launch',
					scope: 'task',
					targetId: 'implementation/02-workflow-engine',
					disabled: false,
					disabledReason: '',
					enabled: true,
					presentationTargets: [
						{ scope: 'task', targetId: 'implementation/02-workflow-engine' },
						{ scope: 'stage', targetId: 'implementation' }
					]
				}
			]
		} as unknown as OperatorStatus;

		try {
			const snapshot = await controller.observeOperatorStatus(status);
			expect(snapshot.actionProjections.dashboard.targetContext).toEqual({
				stageId: 'implementation'
			});
			expect(snapshot.actionProjections.dashboard.availableActions.map((action) => action.id)).toEqual([
				'mission.pause',
				'generation.tasks.implementation'
			]);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('preserves observed stage selection across status updates and projects selection-scoped actions', async () => {
		const workspaceRoot = await createTempRepo();
		const controller = new MissionSystemController();
		const status = {
			found: true,
			control: {
				controlRoot: workspaceRoot,
				missionDirectory: path.join(workspaceRoot, '.missions'),
				settingsPath: path.join(workspaceRoot, 'mission.settings.json'),
				worktreesPath: path.join(workspaceRoot, '.missions', 'missions'),
				settings: {},
				isGitRepository: true,
				initialized: true,
				settingsPresent: true,
				settingsComplete: true,
				availableMissionCount: 1,
				problems: [],
				warnings: []
			},
			missionId: 'mission/airport-projection',
			title: 'Projection-backed mission control',
			stage: 'implementation',
			stages: [
				{
					stage: 'implementation',
					label: 'Implement',
					status: 'active',
					taskCount: 1,
					completedTaskCount: 0,
					activeTaskIds: [],
					readyTaskIds: ['task-1'],
					tasks: [
						{
							taskId: 'task-1',
							stage: 'implementation',
							sequence: 1,
							subject: 'Implement airport projection',
							instruction: 'Project mission control through airport state.',
							body: 'Implement the projection rewrite.',
							dependsOn: [],
							blockedBy: [],
							status: 'todo',
							agent: 'copilot',
							retries: 0,
							fileName: 'airport-projection.md',
							filePath: path.join(workspaceRoot, 'docs', 'airport-projection.md'),
							relativePath: 'docs/airport-projection.md'
						}
					]
				}
			],
			tower: {
				stageRail: [
					{ id: 'prd', label: 'PRD', state: 'done' },
					{ id: 'implementation', label: 'IMPLEMENTATION', state: 'active', subtitle: '0/1' }
				],
				treeNodes: [
					{ id: 'tree:stage:implementation', label: 'IMPLEMENTATION', kind: 'stage', depth: 0, color: '#ffffff', collapsible: true, stageId: 'implementation' }
				]
			},
			availableActions: [
				{
					id: 'mission.pause',
					label: 'Pause Mission',
					action: '/mission pause',
					scope: 'mission',
					disabled: false,
					disabledReason: '',
					enabled: true,
					presentationTargets: [{ scope: 'mission' }, { scope: 'stage', targetId: 'implementation' }]
				},
				{
					id: 'generation.tasks.implementation',
					label: 'Generate Implementation Tasks',
					action: '/generate',
					scope: 'generation',
					targetId: 'implementation',
					disabled: false,
					disabledReason: '',
					enabled: true,
					presentationTargets: [{ scope: 'stage', targetId: 'implementation' }]
				},
				{
					id: 'task.launch.task-1',
					label: 'Launch Agent Session',
					action: '/launch',
					scope: 'task',
					targetId: 'task-1',
					disabled: false,
					disabledReason: '',
					enabled: true,
					presentationTargets: [
						{ scope: 'task', targetId: 'task-1' },
						{ scope: 'stage', targetId: 'implementation' }
					]
				}
			]
		} as unknown as OperatorStatus;

		try {
			await controller.observeOperatorStatus(status);
			await controller.scopeAirportToSurfacePath(workspaceRoot);
			await controller.connectAirportClient({
				clientId: 'dashboard-client',
				surfacePath: workspaceRoot,
				gateId: 'dashboard',
				label: 'tower'
			});

			const observed = await controller.observeAirportClient({
				clientId: 'dashboard-client',
				surfacePath: workspaceRoot,
				missionId: 'mission/airport-projection',
				stageId: 'implementation'
			});
			expect(observed.state.domain.selection).toMatchObject({
				missionId: 'mission/airport-projection',
				stageId: 'implementation'
			});
			expect(observed.actionProjections.dashboard.availableActions.map((action) => action.id)).toEqual([
				'mission.pause',
				'generation.tasks.implementation'
			]);

			const refreshed = await controller.observeOperatorStatus(status);
			expect(refreshed.state.domain.selection).toMatchObject({
				missionId: 'mission/airport-projection',
				stageId: 'implementation'
			});
			expect(refreshed.actionProjections.dashboard.targetContext).toEqual({
				stageId: 'implementation'
			});
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('registers airport clients and allows gate observation through the daemon API', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);

			try {
				const daemon = await startDaemon();
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot });
					const api = new DaemonApi(client);
					const initial = await api.airport.getStatus();
					const connected = await api.airport.connectPanel({
						gateId: 'dashboard',
						label: 'test-tower'
					});
					const observed = await api.airport.observeClient({
						focusedGateId: 'pilot',
						intentGateId: 'pilot'
					});
					const rebound = await api.airport.bindGate({
						gateId: 'pilot',
						binding: {
							targetKind: 'task',
							targetId: 'implementation/01-airport',
							mode: 'control'
						}
					});

					expect(initial.state.airport.repositoryRootPath).toBe(workspaceRoot);
					expect(initial.state.airport.airportId).toMatch(/^airport:/);
					expect(initial.state.airport.substrate.sessionName).toContain('mission-control-');
					expect(Object.values(connected.state.airport.clients)).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								label: 'test-tower',
								connected: true,
								claimedGateId: 'dashboard',
								surfacePath: workspaceRoot
							})
						])
					);
					expect(observed.state.airport.focus).toMatchObject({
						intentGateId: 'pilot',
						observedGateId: 'pilot'
					});
					expect(rebound.state.airport.gates.pilot).toMatchObject({
						targetKind: 'task',
						targetId: 'implementation/01-airport',
						mode: 'control'
					});
					expect(rebound.state.airports.repositories[workspaceRoot]?.persistedIntent).toMatchObject({
						gates: {
							pilot: {
								targetKind: 'task',
								targetId: 'implementation/01-airport',
								mode: 'control'
							}
						}
					});
					expect(rebound.airportProjections.pilot.subtitle).toContain('task:implementation/01-airport');
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('replaces prior gate claimants and tracks client-specific observed focus', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);

			try {
				const daemon = await startDaemon();
				const firstClient = new DaemonClient();
				const secondClient = new DaemonClient();

				try {
					await firstClient.connect({ surfacePath: workspaceRoot });
					await secondClient.connect({ surfacePath: workspaceRoot });
					const firstApi = new DaemonApi(firstClient);
					const secondApi = new DaemonApi(secondClient);

					await firstApi.airport.connectPanel({
						gateId: 'dashboard',
						label: 'tower-a',
						panelProcessId: '111'
					});
					const replaced = await secondApi.airport.connectPanel({
						gateId: 'dashboard',
						label: 'tower-b',
						panelProcessId: '222'
					});
					const firstRegistration = Object.values(replaced.state.airport.clients).find((client) => client.label === 'tower-a');
					const secondRegistration = Object.values(replaced.state.airport.clients).find((client) => client.label === 'tower-b');

					expect(firstRegistration?.claimedGateId).toBeUndefined();
					expect(secondRegistration?.claimedGateId).toBe('dashboard');

					await firstApi.airport.observeClient({ focusedGateId: 'editor' });
					const observed = await secondApi.airport.observeClient({
						focusedGateId: 'pilot',
						intentGateId: 'pilot'
					});

					expect(observed.state.airport.focus.intentGateId).toBe('pilot');
					expect(observed.state.airport.focus.observedGateId).toBe('pilot');
					expect(Object.values(observed.state.airport.focus.observedGateIdByClientId ?? {}).sort()).toEqual([
						'editor',
						'pilot'
					]);
				} finally {
					firstClient.dispose();
					secondClient.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('persists airport intent per repository across daemon restarts', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);

			try {
				{
					const daemon = await startDaemon();
					const client = new DaemonClient();

					try {
						await client.connect({ surfacePath: workspaceRoot });
						const api = new DaemonApi(client);
						await api.airport.bindGate({
							gateId: 'pilot',
							binding: {
								targetKind: 'task',
								targetId: 'persisted/task',
								mode: 'control'
							}
						});
					} finally {
						client.dispose();
						await daemon.close();
					}
				}

				{
					const daemon = await startDaemon();
					const client = new DaemonClient();

					try {
						await client.connect({ surfacePath: workspaceRoot });
						const api = new DaemonApi(client);
						const snapshot = await api.airport.getStatus();

						expect(snapshot.state.airport.gates.pilot).toMatchObject({
							targetKind: 'task',
							targetId: 'persisted/task',
							mode: 'control'
						});
						expect(snapshot.state.airports.repositories[workspaceRoot]?.persistedIntent).toMatchObject({
							gates: {
								pilot: {
									targetKind: 'task',
									targetId: 'persisted/task',
									mode: 'control'
								}
							}
						});
					} finally {
						client.dispose();
						await daemon.close();
					}
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('keeps a repository-keyed airport registry for multiple repositories', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const leftWorkspaceRoot = await createTempRepo();
			const rightWorkspaceRoot = await createTempRepo();
			await initializeMissionRepository(leftWorkspaceRoot);
			await initializeMissionRepository(rightWorkspaceRoot);

			try {
				const daemon = await startDaemon();
				const leftClient = new DaemonClient();
				const rightClient = new DaemonClient();

				try {
					await leftClient.connect({ surfacePath: leftWorkspaceRoot });
					await rightClient.connect({ surfacePath: rightWorkspaceRoot });
					const leftApi = new DaemonApi(leftClient);
					const rightApi = new DaemonApi(rightClient);

					await leftApi.airport.bindGate({
						gateId: 'pilot',
						binding: {
							targetKind: 'task',
							targetId: 'left/task',
							mode: 'control'
						}
					});
					const rightSnapshot = await rightApi.airport.bindGate({
						gateId: 'pilot',
						binding: {
							targetKind: 'task',
							targetId: 'right/task',
							mode: 'control'
						}
					});
					const leftSnapshot = await leftApi.airport.getStatus();

					expect(Object.keys(rightSnapshot.state.airports.repositories).sort()).toEqual([
						leftWorkspaceRoot,
						rightWorkspaceRoot
					].sort());
					expect(rightSnapshot.state.airports.activeRepositoryId).toBe(rightWorkspaceRoot);
					expect(rightSnapshot.state.airports.repositories[leftWorkspaceRoot]?.airport.gates.pilot).toMatchObject({
						targetKind: 'task',
						targetId: 'left/task',
						mode: 'control'
					});
					expect(rightSnapshot.state.airports.repositories[rightWorkspaceRoot]?.airport.gates.pilot).toMatchObject({
						targetKind: 'task',
						targetId: 'right/task',
						mode: 'control'
					});
					expect(leftSnapshot.state.airport.repositoryRootPath).toBe(leftWorkspaceRoot);
					expect(leftSnapshot.state.airport.gates.pilot).toMatchObject({
						targetKind: 'task',
						targetId: 'left/task',
						mode: 'control'
					});
				} finally {
					leftClient.dispose();
					rightClient.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(leftWorkspaceRoot, { recursive: true, force: true });
				await fs.rm(rightWorkspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('derives the GitHub repository from workspace remotes instead of setup settings', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);
			runGit(workspaceRoot, ['remote', 'add', 'origin', 'https://github.com/flying-pillow/mission.git']);

			try {
				const daemon = await startDaemon();
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot });
					const api = new DaemonApi(client);
					const status = await api.control.getStatus();
					const setupCommand = status.availableActions?.find((action) => action.action === '/setup');
					const setupFields = setupCommand?.flow?.steps[0];

					expect(status.control).toMatchObject({
						githubRepository: 'flying-pillow/mission',
						issuesConfigured: true
					});
					expect(setupFields && 'options' in setupFields ? setupFields.options.map((option) => option.id) : []).toEqual([
						'agentRuntime',
						'defaultAgentMode',
						'defaultModel',
						'towerTheme',
						'instructionsPath',
						'skillsPath'
					]);
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('persists control runtime defaults and marks setup complete once configured', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);

			try {
				const daemon = await startDaemon();
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot });
					const api = new DaemonApi(client);
					await api.control.updateSetting('agentRuntime', 'copilot-sdk');
					await api.control.updateSetting('defaultAgentMode', 'interactive');
					const status = await api.control.updateSetting('defaultModel', 'gpt-5.4');
					const settingsContent = await fs.readFile(getMissionDaemonSettingsPath(workspaceRoot), 'utf8');

					expect(status.found).toBe(false);
					expect(status.operationalMode).toBe('root');
					expect(status.control).toMatchObject({
						settingsComplete: true,
						settings: expect.objectContaining({
							agentRuntime: 'copilot-sdk',
							defaultAgentMode: 'interactive',
							defaultModel: 'gpt-5.4'
						})
					});
					expect(JSON.parse(settingsContent)).toMatchObject({
						agentRuntime: 'copilot-sdk',
						defaultAgentMode: 'interactive',
						defaultModel: 'gpt-5.4'
					});
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('persists selection-backed runtime values through command execution flow', async () => {
		const workspaceRoot = await createTempRepo();

		try {
			await initializeMissionRepository(workspaceRoot);
			const daemon = await startDaemon();
			const client = new DaemonClient();

			try {
				await client.connect({ surfacePath: workspaceRoot });
				const api = new DaemonApi(client);
				const resolvedFlow = await api.control.describeActionFlow('control.setup.edit', [
					{
						kind: 'selection',
						stepId: 'field',
						optionIds: ['agentRuntime']
					}
				]);
				const result = await api.control.executeAction('control.setup.edit', [
					{
						kind: 'selection',
						stepId: 'field',
						optionIds: ['agentRuntime']
					},
					{
						kind: 'selection',
						stepId: 'value',
						optionIds: ['copilot-sdk']
					}
				]);
				const settingsContent = await fs.readFile(getMissionDaemonSettingsPath(workspaceRoot), 'utf8');

				expect(resolvedFlow.steps[1]).toMatchObject({
					kind: 'selection',
					id: 'value',
					title: 'RUNTIME'
				});

				expect(result).toMatchObject({
					control: expect.objectContaining({
						settings: expect.objectContaining({
							agentRuntime: 'copilot-sdk'
						})
					})
				});
				expect(JSON.parse(settingsContent)).toMatchObject({
					agentRuntime: 'copilot-sdk'
				});
			} finally {
				client.dispose();
				await daemon.close();
			}
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('persists control setting updates through the daemon', async () => {
		const workspaceRoot = await createTempRepo();

		try {
			await initializeMissionRepository(workspaceRoot);
			const daemon = await startDaemon();
			const client = new DaemonClient();

			try {
				await client.connect({ surfacePath: workspaceRoot });
				const api = new DaemonApi(client);
				const status = await api.control.updateSetting('instructionsPath', '/tmp/mission-instructions');
				const settingsContent = await fs.readFile(getMissionDaemonSettingsPath(workspaceRoot), 'utf8');

				expect(status.found).toBe(false);
				expect(status.control).toMatchObject({
					settingsPresent: true,
					settings: expect.objectContaining({
						instructionsPath: '/tmp/mission-instructions'
					})
				});
				expect(JSON.parse(settingsContent)).toMatchObject({
					instructionsPath: '/tmp/mission-instructions'
				});
			} finally {
				client.dispose();
				await daemon.close();
			}
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('persists tower theme settings through the daemon', async () => {
		const workspaceRoot = await createTempRepo();

		try {
			await initializeMissionRepository(workspaceRoot);
			const daemon = await startDaemon();
			const client = new DaemonClient();

			try {
				await client.connect({ surfacePath: workspaceRoot });
				const api = new DaemonApi(client);
				const status = await api.control.updateSetting('towerTheme', 'mono');
				const settingsContent = await fs.readFile(getMissionDaemonSettingsPath(workspaceRoot), 'utf8');

				expect(status.found).toBe(false);
				expect(status.control).toMatchObject({
					settingsPresent: true,
					settings: expect.objectContaining({
						towerTheme: 'mono'
					})
				});
				expect(JSON.parse(settingsContent)).toMatchObject({
					towerTheme: 'mono'
				});
			} finally {
				client.dispose();
				await daemon.close();
			}
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('prepares a repository bootstrap pull request before mission authorization when scaffolding is missing', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			await withFakeGitHubCli(async ({ callsPath }) => {
				const workspaceRoot = await createTempRepo();
				const originPath = await createTempBareRemote();
				runGit(workspaceRoot, ['remote', 'add', 'origin', originPath]);
				runGit(workspaceRoot, ['push', '--set-upstream', 'origin', 'master']);
				runGit(workspaceRoot, ['remote', 'add', 'github', 'https://github.com/Flying-Pillow/mission.git']);

				try {
					const daemon = await startDaemon();
					const client = new DaemonClient();

					try {
						await client.connect({ surfacePath: workspaceRoot });
						const api = new DaemonApi(client);
						const status = await api.mission.fromBrief({
							brief: createBrief(undefined, 'Bootstrap authorization')
						});
						const calls = await readFakeGitHubCalls(callsPath);

						expect(status.preparation).toMatchObject({
							kind: 'repository-bootstrap',
							state: 'pull-request-opened',
							baseBranch: 'master'
						});
						expect(status.missionId).toBeUndefined();
						expect(status.recommendedAction).toContain('bootstrap PR');
						expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
							['auth', 'status'],
							['pr', 'create']
						]);
					} finally {
						client.dispose();
						await daemon.close();
					}
				} finally {
					await fs.rm(originPath, { recursive: true, force: true });
					await fs.rm(workspaceRoot, { recursive: true, force: true });
				}
			});
		});
	});

	it('creates a GitHub issue and then prepares a mission pull request from a brief', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			await withFakeGitHubCli(async ({ callsPath }) => {
				const workspaceRoot = await createTempRepo();
				const originPath = await createTempBareRemote();
				runGit(workspaceRoot, ['remote', 'add', 'origin', originPath]);
				runGit(workspaceRoot, ['push', '--set-upstream', 'origin', 'master']);
				runGit(workspaceRoot, ['remote', 'add', 'github', 'https://github.com/Flying-Pillow/mission.git']);
				await initializeMissionRepository(workspaceRoot);

				try {
					const daemon = await startDaemon();
					const client = new DaemonClient();

					try {
						await client.connect({ surfacePath: workspaceRoot });
						const api = new DaemonApi(client);
						const status = await api.mission.fromBrief({
							brief: createBrief(undefined, 'Brief-backed authorization')
						});
						const calls = await readFakeGitHubCalls(callsPath);

						expect(status).toMatchObject({
							issueId: 900,
							type: 'refactor',
							preparation: expect.objectContaining({
								kind: 'mission',
								state: 'pull-request-opened',
								issueId: 900
							})
						});
						expect(status.missionRootDir).toContain(path.join('.missions', 'missions'));
						expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
							['auth', 'status'],
							['api', 'repos/Flying-Pillow/mission/issues'],
							['pr', 'create']
						]);
					} finally {
						client.dispose();
						await daemon.close();
					}
				} finally {
					await fs.rm(originPath, { recursive: true, force: true });
					await fs.rm(workspaceRoot, { recursive: true, force: true });
				}
			});
		});
	});

	it('prepares a mission pull request from an existing issue without creating a new issue', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			await withFakeGitHubCli(async ({ callsPath }) => {
				const workspaceRoot = await createTempRepo();
				const originPath = await createTempBareRemote();
				runGit(workspaceRoot, ['remote', 'add', 'origin', originPath]);
				runGit(workspaceRoot, ['push', '--set-upstream', 'origin', 'master']);
				runGit(workspaceRoot, ['remote', 'add', 'github', 'https://github.com/Flying-Pillow/mission.git']);
				await initializeMissionRepository(workspaceRoot);

				try {
					const daemon = await startDaemon();
					const client = new DaemonClient();

					try {
						await client.connect({ surfacePath: workspaceRoot });
						const api = new DaemonApi(client);
						const status = await api.mission.fromIssue(42);
						const calls = await readFakeGitHubCalls(callsPath);

						expect(status).toMatchObject({
							issueId: 42,
							preparation: expect.objectContaining({
								kind: 'mission',
								state: 'pull-request-opened',
								issueId: 42
							})
						});
						expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
							['auth', 'status'],
							['issue', 'view', '42'],
							['pr', 'create', '--title']
						]);
					} finally {
						client.dispose();
						await daemon.close();
					}
				} finally {
					await fs.rm(originPath, { recursive: true, force: true });
					await fs.rm(workspaceRoot, { recursive: true, force: true });
				}
			});
		});
	});
});

function createBrief(issueId: number | undefined, title: string) {
	return {
		...(issueId !== undefined ? { issueId } : {}),
		title,
		body: `${title} body`,
		type: 'refactor' as const
	};
}

async function createTempRepo(): Promise<string> {
	const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-'));
	runGit(workspaceRoot, ['init']);
	runGit(workspaceRoot, ['config', 'user.email', 'mission@example.com']);
	runGit(workspaceRoot, ['config', 'user.name', 'Mission Test']);
	await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# Mission Test\n', 'utf8');
	runGit(workspaceRoot, ['add', 'README.md']);
	runGit(workspaceRoot, ['commit', '-m', 'init']);
	return workspaceRoot;
}

async function createTempBareRemote(): Promise<string> {
	const remoteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-daemon-origin-'));
	runGit(remoteRoot, ['init', '--bare']);
	return remoteRoot;
}

function runGit(workspaceRoot: string, args: string[]): void {
	const result = spawnSync('git', args, {
		cwd: workspaceRoot,
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`);
	}
}

async function withFakeGitHubCli(
	run: (context: { callsPath: string }) => Promise<void>
): Promise<void> {
	const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-fake-gh-'));
	const callsPath = path.join(fakeHome, 'gh-calls.ndjson');
	const statePath = path.join(fakeHome, 'gh-state.json');
	const ghPath = path.join(fakeHome, 'gh');
	const previousAuthorName = process.env['GIT_AUTHOR_NAME'];
	const previousAuthorEmail = process.env['GIT_AUTHOR_EMAIL'];
	const previousCommitterName = process.env['GIT_COMMITTER_NAME'];
	const previousCommitterEmail = process.env['GIT_COMMITTER_EMAIL'];
	const script = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const callsPath = ${JSON.stringify(callsPath)};
const statePath = ${JSON.stringify(statePath)};
const args = process.argv.slice(2);
function recordCall() {
	fs.appendFileSync(callsPath, JSON.stringify({ args }) + '\n');
}
function readState() {
	try {
		return JSON.parse(fs.readFileSync(statePath, 'utf8'));
	} catch {
		return { nextIssueNumber: 900, issues: {} };
	}
}
function writeState(state) {
	fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
}
function findArg(flag) {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
}
function parseFormValue(key) {
	const prefix = key + '=';
	for (let index = 0; index < args.length - 1; index += 1) {
		if (args[index] === '-f' && String(args[index + 1]).startsWith(prefix)) {
			return String(args[index + 1]).slice(prefix.length);
		}
	}
	return undefined;
}
recordCall();
if (args[0] === 'auth' && args[1] === 'status') {
	process.stdout.write('Logged in to github.com as mission-test\n');
	process.exit(0);
}
if (args[0] === 'api' && args[1] === 'user') {
	process.stdout.write('mission-test\n');
	process.exit(0);
}
if (args[0] === 'api' && typeof args[1] === 'string' && args[1].startsWith('repos/')) {
	const state = readState();
	const number = state.nextIssueNumber++;
	const issue = {
		number,
		title: parseFormValue('title') || 'Created issue',
		body: parseFormValue('body') || 'Created body',
		url: 'https://github.com/Flying-Pillow/mission/issues/' + String(number),
		labels: []
	};
	state.issues[String(number)] = issue;
	writeState(state);
	process.stdout.write(JSON.stringify(issue));
	process.exit(0);
}
if (args[0] === 'issue' && args[1] === 'view') {
	const issueId = String(args[2] || '0');
	const state = readState();
	const issue = state.issues[issueId] || {
		number: Number(issueId),
		title: 'Existing issue ' + issueId,
		body: 'Existing issue ' + issueId + ' body',
		url: 'https://github.com/Flying-Pillow/mission/issues/' + issueId,
		labels: []
	};
	process.stdout.write(JSON.stringify(issue));
	process.exit(0);
}
if (args[0] === 'issue' && args[1] === 'list') {
	process.stdout.write('[]');
	process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'create') {
	const head = findArg('--head') || 'proposal';
	process.stdout.write('https://github.com/Flying-Pillow/mission/pull/' + encodeURIComponent(head) + '\n');
	process.exit(0);
}
process.stderr.write('Unsupported fake gh invocation: ' + args.join(' ') + '\n');
process.exit(1);
`;
	const previousPath = process.env['PATH'];
	await fs.writeFile(ghPath, script, 'utf8');
	await fs.chmod(ghPath, 0o755);
	process.env['PATH'] = `${fakeHome}:${previousPath ?? ''}`;
	process.env['GIT_AUTHOR_NAME'] = 'Mission Test';
	process.env['GIT_AUTHOR_EMAIL'] = 'mission@example.com';
	process.env['GIT_COMMITTER_NAME'] = 'Mission Test';
	process.env['GIT_COMMITTER_EMAIL'] = 'mission@example.com';
	try {
		await run({ callsPath });
	} finally {
		if (previousPath === undefined) {
			delete process.env['PATH'];
		} else {
			process.env['PATH'] = previousPath;
		}
		if (previousAuthorName === undefined) {
			delete process.env['GIT_AUTHOR_NAME'];
		} else {
			process.env['GIT_AUTHOR_NAME'] = previousAuthorName;
		}
		if (previousAuthorEmail === undefined) {
			delete process.env['GIT_AUTHOR_EMAIL'];
		} else {
			process.env['GIT_AUTHOR_EMAIL'] = previousAuthorEmail;
		}
		if (previousCommitterName === undefined) {
			delete process.env['GIT_COMMITTER_NAME'];
		} else {
			process.env['GIT_COMMITTER_NAME'] = previousCommitterName;
		}
		if (previousCommitterEmail === undefined) {
			delete process.env['GIT_COMMITTER_EMAIL'];
		} else {
			process.env['GIT_COMMITTER_EMAIL'] = previousCommitterEmail;
		}
	}
}

async function readFakeGitHubCalls(callsPath: string): Promise<Array<{ args: string[] }>> {
	const content = await fs.readFile(callsPath, 'utf8');
	return content
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { args: string[] });
}

async function withTemporaryDaemonConfigHome(run: () => Promise<void>): Promise<void> {
	const previousConfigHome = process.env['XDG_CONFIG_HOME'];
	const configHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-config-'));
	process.env['XDG_CONFIG_HOME'] = configHome;
	try {
		await run();
	} finally {
		if (previousConfigHome === undefined) {
			delete process.env['XDG_CONFIG_HOME'];
		} else {
			process.env['XDG_CONFIG_HOME'] = previousConfigHome;
		}
		await fs.rm(configHome, { recursive: true, force: true });
	}
}
