import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { DaemonApi } from '../client/DaemonApi.js';
import { DaemonClient } from '../client/DaemonClient.js';
import { getMissionDaemonSettingsPath } from '../lib/daemonConfig.js';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import { initializeMissionRepository } from '../initializeMissionRepository.js';
import { Mission } from './mission/Mission.js';
import { startDaemon } from './Daemon.js';
import { getDaemonManifestPath, getDaemonRuntimePath } from './daemonPaths.js';
import { createDefaultWorkflowSettings } from '../workflow/engine/defaultWorkflow.js';

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
					expect(status.control?.problems).not.toEqual(
						expect.arrayContaining([
							'Mission control scaffolding is missing.',
							'Mission settings are missing.'
						])
					);
					expect(status.control?.warnings).toContain(
						'Mission control will be created in the first mission worktree if it is not already present on this checkout.'
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
			const workspaceDaemonPath = path.join(workspaceRoot, '.mission', 'daemon');

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
					const availableActions = await api.control.listAvailableActions();
					const issuesCommand = availableActions.find((action) => action.action === '/issues');
					const setupCommand = availableActions.find((action) => action.action === '/setup');

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
								commandContext: {},
								stageRail: [],
								treeNodes: [],
								emptyLabel: 'Repository mode is ready.'
							},
							editor: {
								title: 'Editor',
								launchPath: workspaceRoot,
								emptyLabel: 'Editor gate is waiting for an artifact binding.'
							},
							agentSession: {
								title: 'Agent Session',
								statusLabel: 'idle',
								emptyLabel: 'Agent session gate is idle.'
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
						focusedGateId: 'agentSession',
						intentGateId: 'agentSession'
					});
					const rebound = await api.airport.bindGate({
						gateId: 'agentSession',
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
						intentGateId: 'agentSession',
						observedGateId: 'agentSession'
					});
					expect(rebound.state.airport.gates.agentSession).toMatchObject({
						targetKind: 'task',
						targetId: 'implementation/01-airport',
						mode: 'control'
					});
					expect(rebound.state.airports.repositories[workspaceRoot]?.persistedIntent).toMatchObject({
						gates: {
							agentSession: {
								targetKind: 'task',
								targetId: 'implementation/01-airport',
								mode: 'control'
							}
						}
					});
					expect(rebound.airportProjections.agentSession.subtitle).toContain('task:implementation/01-airport');
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

	it('lists available actions through explicit daemon APIs instead of ambient selection', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);
			const seededMission = await seedTrackedMission(workspaceRoot, 6, 'Explicit action listing');

			try {
				const daemon = await startDaemon();
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot });
					const api = new DaemonApi(client);
					const controlActions = await api.control.listAvailableActions();
					await api.control.getStatus();
					const missionActions = await api.mission.listAvailableActions({ missionId: seededMission.getRecord().id });

					expect(controlActions.some((action) => action.id === 'control.setup.edit')).toBe(true);
					expect(missionActions.length).toBeGreaterThan(0);
					const taskAction = missionActions.find((action) => action.scope === 'task' && typeof action.targetId === 'string');
					expect(taskAction).toBeDefined();
					const taskId = taskAction?.targetId;
					if (!taskId) {
						throw new Error('Expected at least one task-scoped action.');
					}
					const scopedTaskActions = await api.mission.listAvailableActions(
						{ missionId: seededMission.getRecord().id },
						{ taskId }
					);
					expect(scopedTaskActions.some((action) => action.id === taskAction.id)).toBe(true);
					expect(
						scopedTaskActions.every((action) => action.scope !== 'task' || action.targetId === taskId)
					).toBe(true);
				} finally {
					client.dispose();
					await daemon.close();
				}
			} finally {
				seededMission.dispose();
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('keeps mission data available across airport workspace resynchronization without using client observation as semantic selection', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);
			const seededMission = await seedTrackedMission(workspaceRoot, 4, 'Hydrated mission projection');

			try {
				const daemon = await startDaemon();
				const firstClient = new DaemonClient();
				const secondClient = new DaemonClient();

				try {
					await firstClient.connect({ surfacePath: workspaceRoot });
					const firstApi = new DaemonApi(firstClient);
					await firstApi.airport.connectPanel({ gateId: 'dashboard', label: 'test-dashboard-1' });
					await firstApi.control.getStatus();
					const selected = await firstApi.mission.getStatus({ missionId: seededMission.getRecord().id });
					const selectedSystem = selected.system;

					expect(selectedSystem?.state.domain.selection).toMatchObject({
						repositoryId: workspaceRoot,
						missionId: seededMission.getRecord().id
					});
					expect(selectedSystem?.state.domain.missions[seededMission.getRecord().id]?.tower).toBeDefined();
					expect(selectedSystem?.state.domain.missions[seededMission.getRecord().id]?.taskIds.length).toBeGreaterThan(0);

					await secondClient.connect({ surfacePath: workspaceRoot });
					const secondApi = new DaemonApi(secondClient);
					const reconnected = await secondApi.airport.connectPanel({ gateId: 'dashboard', label: 'test-dashboard-2' });

					expect(reconnected.state.domain.missions[seededMission.getRecord().id]?.tower).toBeDefined();
					expect(reconnected.state.domain.missions[seededMission.getRecord().id]?.taskIds.length).toBeGreaterThan(0);
					expect(reconnected.airportProjections.dashboard.commandContext).toEqual({});
				} finally {
					firstClient.dispose();
					secondClient.dispose();
					await daemon.close();
				}
			} finally {
				seededMission.dispose();
				await fs.rm(getDaemonRuntimePath(), { recursive: true, force: true }).catch(() => undefined);
				await fs.rm(workspaceRoot, { recursive: true, force: true });
			}
		});
	});

	it('keeps airport observation transport-scoped when the dashboard reobserves the repository', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);

			try {
				const daemon = await startDaemon();
				const client = new DaemonClient();

				try {
					await client.connect({ surfacePath: workspaceRoot });
					const api = new DaemonApi(client);
					await api.airport.connectPanel({ gateId: 'dashboard', label: 'test-dashboard' });
					const reset = await api.airport.observeClient({
						repositoryId: workspaceRoot,
						focusedGateId: 'dashboard',
						intentGateId: 'dashboard'
					});

					expect(reset.state.domain.selection.repositoryId).toBe(workspaceRoot);
					expect(reset.state.domain.selection.missionId).toBeUndefined();
					expect(reset.airportProjections.dashboard.surfaceMode).toBe('repository');
					expect(reset.airportProjections.dashboard.centerRoute).toBe('repository-flow');
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
						focusedGateId: 'agentSession',
						intentGateId: 'agentSession'
					});

					expect(observed.state.airport.focus.intentGateId).toBe('agentSession');
					expect(observed.state.airport.focus.observedGateId).toBe('agentSession');
					expect(Object.values(observed.state.airport.focus.observedGateIdByClientId ?? {}).sort()).toEqual([
						'agentSession',
						'editor'
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
							gateId: 'agentSession',
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

						expect(snapshot.state.airport.gates.agentSession).toMatchObject({
							targetKind: 'task',
							targetId: 'persisted/task',
							mode: 'control'
						});
						expect(snapshot.state.airports.repositories[workspaceRoot]?.persistedIntent).toMatchObject({
							gates: {
								agentSession: {
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

	it('reconnects dashboard, editor, and agentSession gates as real clients after daemon restart', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			const workspaceRoot = await createTempRepo();
			await initializeMissionRepository(workspaceRoot);

			const connectAllGates = async () => {
				const dashboardClient = new DaemonClient();
				const editorClient = new DaemonClient();
				const agentClient = new DaemonClient();
				await dashboardClient.connect({ surfacePath: workspaceRoot });
				await editorClient.connect({ surfacePath: workspaceRoot });
				await agentClient.connect({ surfacePath: workspaceRoot });
				const dashboardApi = new DaemonApi(dashboardClient);
				const editorApi = new DaemonApi(editorClient);
				const agentApi = new DaemonApi(agentClient);

				await dashboardApi.airport.connectPanel({
					gateId: 'dashboard',
					label: 'mission-dashboard'
				});
				await editorApi.airport.connectPanel({
					gateId: 'editor',
					label: 'mission-editor'
				});
				const snapshot = await agentApi.airport.connectPanel({
					gateId: 'agentSession',
					label: 'mission-agent-session'
				});

				return {
					snapshot,
					dispose: () => {
						dashboardClient.dispose();
						editorClient.dispose();
						agentClient.dispose();
					}
				};
			};

			try {
				{
					const daemon = await startDaemon();
					try {
						const { snapshot, dispose } = await connectAllGates();
						try {
							expect(Object.values(snapshot.state.airport.clients)).toEqual(
								expect.arrayContaining([
									expect.objectContaining({ label: 'mission-dashboard', claimedGateId: 'dashboard' }),
									expect.objectContaining({ label: 'mission-editor', claimedGateId: 'editor' }),
									expect.objectContaining({ label: 'mission-agent-session', claimedGateId: 'agentSession' })
								])
							);
							expect(Object.values(snapshot.state.airport.clients).map((client) => client.claimedGateId).sort()).toEqual([
								'agentSession',
								'dashboard',
								'editor'
							]);
						} finally {
							dispose();
						}
					} finally {
						await daemon.close();
					}
				}

				{
					const daemon = await startDaemon();
					try {
						const { snapshot, dispose } = await connectAllGates();
						try {
							expect(Object.values(snapshot.state.airport.clients).map((client) => client.label).sort()).toEqual([
								'mission-agent-session',
								'mission-dashboard',
								'mission-editor'
							]);
							expect(snapshot.airportProjections.editor.connectedClientIds.length).toBe(1);
							expect(snapshot.airportProjections.agentSession.connectedClientIds.length).toBe(1);
							expect(snapshot.airportProjections.dashboard.connectedClientIds.length).toBe(1);
						} finally {
							dispose();
						}
					} finally {
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
						gateId: 'agentSession',
						binding: {
							targetKind: 'task',
							targetId: 'left/task',
							mode: 'control'
						}
					});
					const rightSnapshot = await rightApi.airport.bindGate({
						gateId: 'agentSession',
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
					expect(rightSnapshot.state.airports.repositories[leftWorkspaceRoot]?.airport.gates.agentSession).toMatchObject({
						targetKind: 'task',
						targetId: 'left/task',
						mode: 'control'
					});
					expect(rightSnapshot.state.airports.repositories[rightWorkspaceRoot]?.airport.gates.agentSession).toMatchObject({
						targetKind: 'task',
						targetId: 'right/task',
						mode: 'control'
					});
					expect(leftSnapshot.state.airport.repositoryRootPath).toBe(leftWorkspaceRoot);
					expect(leftSnapshot.state.airport.gates.agentSession).toMatchObject({
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
					const availableActions = await api.control.listAvailableActions();
					const setupCommand = availableActions.find((action) => action.action === '/setup');
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
						'missionWorkspaceRoot',
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

	it('bootstraps repo control inside the mission worktree when scaffolding is missing', async () => {
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
						const missionWorkspacePath = status.missionDir ?? workspaceRoot;
						const worktreeSettingsPath = path.join(missionWorkspacePath, '.mission', 'settings.json');
						const calls = await readFakeGitHubCalls(callsPath);

						expect(status).toMatchObject({
							found: true,
							issueId: 900,
							type: 'refactor'
						});
						expect(status.preparation).toBeUndefined();
						await expect(fs.access(getMissionDaemonSettingsPath(workspaceRoot))).rejects.toThrow();
						await expect(fs.access(worktreeSettingsPath)).resolves.toBeUndefined();
						expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
							['auth', 'status'],
							['api', 'repos/Flying-Pillow/mission/issues']
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

	it('creates a GitHub issue and then prepares a mission from a brief', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			await withFakeGitHubCli(async ({ callsPath }) => {
				const workspaceRoot = await createTempRepo();
				const originPath = await createTempBareRemote();
				runGit(workspaceRoot, ['remote', 'add', 'origin', originPath]);
				runGit(workspaceRoot, ['push', '--set-upstream', 'origin', 'master']);
				runGit(workspaceRoot, ['remote', 'add', 'github', 'https://github.com/Flying-Pillow/mission.git']);
				await initializeMissionRepository(workspaceRoot);
				await commitMissionRepositoryBootstrap(workspaceRoot);

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
							found: true,
							issueId: 900,
							type: 'refactor'
						});
						expect(status.preparation).toBeUndefined();
						expect(status.missionRootDir).toContain(path.join('.mission', 'missions', status.missionId ?? ''));
						expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
							['auth', 'status'],
							['api', 'repos/Flying-Pillow/mission/issues']
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

	it('prepares a mission from an existing issue without creating a new issue', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			await withFakeGitHubCli(async ({ callsPath }) => {
				const workspaceRoot = await createTempRepo();
				const originPath = await createTempBareRemote();
				runGit(workspaceRoot, ['remote', 'add', 'origin', originPath]);
				runGit(workspaceRoot, ['push', '--set-upstream', 'origin', 'master']);
				runGit(workspaceRoot, ['remote', 'add', 'github', 'https://github.com/Flying-Pillow/mission.git']);
				await initializeMissionRepository(workspaceRoot);
				await commitMissionRepositoryBootstrap(workspaceRoot);

				try {
					const daemon = await startDaemon();
					const client = new DaemonClient();

					try {
						await client.connect({ surfacePath: workspaceRoot });
						const api = new DaemonApi(client);
						const status = await api.mission.fromIssue(42);
						const calls = await readFakeGitHubCalls(callsPath);

						expect(status).toMatchObject({
							found: true,
							issueId: 42,
							missionId: expect.any(String)
						});
						expect(status.preparation).toBeUndefined();
						expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
							['auth', 'status'],
							['issue', 'view']
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

	it('returns the existing tracked mission when an issue already has a mission dossier', async () => {
		await withTemporaryDaemonConfigHome(async () => {
			await withFakeGitHubCli(async ({ callsPath }) => {
				const workspaceRoot = await createTempRepo();
				const originPath = await createTempBareRemote();
				runGit(workspaceRoot, ['remote', 'add', 'origin', originPath]);
				runGit(workspaceRoot, ['push', '--set-upstream', 'origin', 'master']);
				runGit(workspaceRoot, ['remote', 'add', 'github', 'https://github.com/Flying-Pillow/mission.git']);
				await initializeMissionRepository(workspaceRoot);
				await commitMissionRepositoryBootstrap(workspaceRoot);
				const adapter = new FilesystemAdapter(workspaceRoot);
				const missionId = '42-existing-issue';
				const missionWorktreePath = adapter.getMissionWorktreePath(missionId);
				const missionRootDir = adapter.getTrackedMissionDir(missionId, missionWorktreePath);
				const workflow = createDefaultWorkflowSettings();
				await adapter.materializeMissionWorktree(missionWorktreePath, 'mission/42-existing-issue');
				const worktreeAdapter = new FilesystemAdapter(missionWorktreePath);
				const preparedMission = Mission.hydrate(
					worktreeAdapter,
					missionRootDir,
					{
						missionId,
						missionDir: missionRootDir,
						brief: {
							issueId: 42,
							title: 'Existing issue 42',
							body: 'Existing issue 42 body',
							type: 'task',
							url: 'https://github.com/Flying-Pillow/mission/issues/42'
						},
						branchRef: 'mission/42-existing-issue',
						createdAt: new Date().toISOString()
					},
					{
						workflow,
						resolveWorkflow: () => workflow,
						taskRunners: new Map()
					}
				);
				await preparedMission.initialize();
				preparedMission.dispose();

				try {
					const daemon = await startDaemon();
					const client = new DaemonClient();

					try {
						await client.connect({ surfacePath: workspaceRoot });
						const api = new DaemonApi(client);
						const status = await api.mission.fromIssue(42);
						const calls = await readFakeGitHubCalls(callsPath);

						expect(status).toMatchObject({
							missionId,
							issueId: 42,
							missionRootDir,
							recommendedAction: expect.stringContaining('already has mission')
						});
						expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
							['auth', 'status'],
							['issue', 'view']
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

async function seedTrackedMission(workspaceRoot: string, issueId: number, title: string): Promise<Mission> {
	const adapter = new FilesystemAdapter(workspaceRoot);
	const missionId = adapter.createMissionId(createBrief(issueId, title));
	const missionWorktreePath = adapter.getMissionWorktreePath(missionId);
	const missionRootDir = adapter.getTrackedMissionDir(missionId, missionWorktreePath);
	const workflow = createDefaultWorkflowSettings();
	await adapter.materializeMissionWorktree(missionWorktreePath, adapter.deriveMissionBranchName(issueId, title));
	const worktreeAdapter = new FilesystemAdapter(missionWorktreePath);
	const mission = Mission.hydrate(
		worktreeAdapter,
		missionRootDir,
		{
			missionId,
			missionDir: missionRootDir,
			brief: createBrief(issueId, title),
			branchRef: adapter.deriveMissionBranchName(issueId, title),
			createdAt: new Date().toISOString()
		},
		{
			workflow,
			resolveWorkflow: () => workflow,
			taskRunners: new Map()
		}
	);
	await mission.initialize();
	return mission;
}

async function commitMissionRepositoryBootstrap(workspaceRoot: string): Promise<void> {
	const settingsPath = getMissionDaemonSettingsPath(workspaceRoot);
	const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
	settings['missionWorkspaceRoot'] = path.join(os.tmpdir(), 'mission-test-worktrees');
	await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
	runGit(workspaceRoot, ['add', '.mission']);
	runGit(workspaceRoot, ['commit', '-m', 'chore: bootstrap mission repository']);
	runGit(workspaceRoot, ['push', 'origin', 'master']);
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
const { execFileSync } = require('node:child_process');
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
		return { nextIssueNumber: 900, issues: {}, pullRequests: {} };
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
	const state = readState();
	const head = findArg('--head') || 'proposal';
	const base = findArg('--base') || 'master';
	state.pullRequests[head] = { base };
	writeState(state);
	process.stdout.write('https://github.com/Flying-Pillow/mission/pull/' + encodeURIComponent(head) + '\n');
	process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'merge') {
	const prRef = String(args[2] || '');
	const head = decodeURIComponent(prRef.split('/').pop() || 'proposal');
	const state = readState();
	const base = state.pullRequests?.[head]?.base || 'master';
	if (!base) {
		process.stderr.write('Could not resolve fake PR base branch.\n');
		process.exit(1);
	}
	execFileSync('git', ['fetch', 'origin'], { cwd: process.cwd(), stdio: 'ignore' });
	execFileSync('git', ['push', 'origin', head + ':refs/heads/' + base], { cwd: process.cwd(), stdio: 'ignore' });
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
