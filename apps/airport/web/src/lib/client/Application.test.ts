import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionControlSnapshot } from '$lib/types/mission-control';
import type {
    MissionRuntimeSnapshot,
    RepositorySnapshot
} from '@flying-pillow/mission-core/airport/runtime';

const remoteMocks = vi.hoisted(() => ({
    qry: vi.fn(),
    getAirportRouteData: vi.fn(),
    readVisibleGitHubRepositories: vi.fn(),
    addAirportRepository: vi.fn(),
    logoutAirportSession: vi.fn(),
    readMissionSnapshotBundle: vi.fn(),
    hydrateMissionSnapshot: vi.fn((snapshot: MissionRuntimeSnapshot) => ({
        missionId: snapshot.missionId,
        setRouteState: vi.fn()
    })),
    refreshMission: vi.fn(),
    observeMission: vi.fn()
}));

vi.mock('../../routes/api/entities/remote/query.remote', () => ({
    qry: (input: unknown) => remoteMocks.qry(input)
}));

vi.mock('../../routes/api/airport/airport.remote', () => ({
    getAirportRouteData: (input: unknown) => ({
        run: () => remoteMocks.getAirportRouteData(input)
    }),
    readVisibleGitHubRepositories: (input: unknown) => remoteMocks.readVisibleGitHubRepositories(input),
    addAirportRepository: remoteMocks.addAirportRepository,
    logoutAirportSession: remoteMocks.logoutAirportSession,
    readMissionSnapshotBundle: (input: unknown) => remoteMocks.readMissionSnapshotBundle(input)
}));

vi.mock('$lib/client/runtime/AirportClientRuntime', () => ({
    AirportClientRuntime: class AirportClientRuntime {
        public hydrateMissionSnapshot(snapshot: MissionRuntimeSnapshot) {
            return remoteMocks.hydrateMissionSnapshot(snapshot);
        }

        public refreshMission(...args: unknown[]) {
            return remoteMocks.refreshMission(...args);
        }

        public observeMission(...args: unknown[]) {
            return remoteMocks.observeMission(...args);
        }
    }
}));

import { AirportApplication } from '$lib/client/Application.svelte';

function createRepositorySnapshot(): RepositorySnapshot {
    return {
        repository: {
            repositoryId: 'repo-1',
            repositoryRootPath: '/repositories/Flying-Pillow/mission',
            label: 'mission',
            description: 'mission'
        },
        missions: []
    } as unknown as RepositorySnapshot;
}

function createMissionRuntimeSnapshot(): MissionRuntimeSnapshot {
    return {
        missionId: 'mission-29',
        status: {
            missionId: 'mission-29',
            title: 'Mission 29',
            lifecycle: 'running',
            workflow: {
                lifecycle: 'running',
                updatedAt: '2026-04-23T19:00:00.000Z',
                currentStageId: 'implementation',
                stages: []
            }
        },
        sessions: []
    } as MissionRuntimeSnapshot;
}

function createMissionControlSnapshot(): MissionControlSnapshot {
    return {
        missionRuntime: createMissionRuntimeSnapshot(),
        operatorStatus: {
            missionId: 'mission-29',
            title: 'Mission 29',
            lifecycle: 'running',
            workflow: {
                lifecycle: 'running',
                updatedAt: '2026-04-23T19:00:00.000Z',
                currentStageId: 'implementation',
                stages: []
            },
            tower: {
                treeNodes: []
            },
            productFiles: {}
        }
    } as MissionControlSnapshot;
}

describe('AirportApplication route hydration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        remoteMocks.qry.mockReset();
        remoteMocks.getAirportRouteData.mockReset();
        remoteMocks.readVisibleGitHubRepositories.mockReset();
        remoteMocks.addAirportRepository.mockReset();
        remoteMocks.logoutAirportSession.mockReset();
        remoteMocks.readMissionSnapshotBundle.mockReset();
        remoteMocks.refreshMission.mockResolvedValue(undefined);
        remoteMocks.observeMission.mockReturnValue({ dispose: vi.fn() });
    });

    it('hydrates the airport home route through the centralized airport contract', async () => {
        remoteMocks.getAirportRouteData.mockResolvedValue({
            airportHome: {
                repositories: [
                    {
                        repositoryId: 'repo-1',
                        repositoryRootPath: '/repositories/Flying-Pillow/mission',
                        label: 'mission',
                        description: 'mission'
                    }
                ]
            },
            loginHref: '/login?redirectTo=/airport'
        });

        const application = new AirportApplication();
        const data = await application.openAirportRoute();

        expect(data.airportHome.repositories).toHaveLength(1);
        expect(application.airportHomeState?.loginHref).toBe('/login?redirectTo=/airport');
        expect(application.activeRepositoryId).toBe('repo-1');
        expect(remoteMocks.getAirportRouteData).toHaveBeenCalledWith({});
    });

    it('does not eagerly load repository summaries during singleton initialization', async () => {
        const application = new AirportApplication();
        await application.initialize();

        expect(application.repositoriesState).toHaveLength(0);
        expect(remoteMocks.qry).not.toHaveBeenCalled();
    });

    it('hydrates the repository route through the generic entity query boundary', async () => {
        remoteMocks.qry.mockImplementation(async (input: unknown) => {
            const invocation = input as {
                reference?: { entity?: string; repositoryId?: string };
                method?: string;
            };

            if (invocation.reference?.entity === 'Airport' && invocation.method === 'listRepositories') {
                return [{
                    repositoryId: 'repo-1',
                    repositoryRootPath: '/repositories/Flying-Pillow/mission',
                    label: 'mission',
                    description: 'mission'
                }];
            }

            if (invocation.reference?.entity === 'Repository' && invocation.method === 'read') {
                return createRepositorySnapshot();
            }

            throw new Error(`Unexpected query invocation: ${JSON.stringify(invocation)}`);
        });

        const application = new AirportApplication();
        const repository = await application.openRepositoryRoute('repo-1');

        expect(repository.repositoryId).toBe('repo-1');
        expect(application.activeRepositoryId).toBe('repo-1');
        expect(application.activeRepositoryRootPath).toBe('/repositories/Flying-Pillow/mission');
        expect(remoteMocks.qry).toHaveBeenCalledWith({
            reference: { entity: 'Airport' },
            method: 'listRepositories',
            args: {}
        });
        expect(remoteMocks.qry).toHaveBeenCalledWith({
            reference: {
                entity: 'Repository',
                repositoryId: 'repo-1'
            },
            method: 'read',
            args: {}
        });
    });

    it('hydrates repository route state from explicit airport and entity inputs', async () => {
        const application = new AirportApplication();

        const repository = application.syncRepositoryRouteState({
            airportRepositories: [
                {
                    repositoryId: 'repo-1',
                    repositoryRootPath: '/repositories/Flying-Pillow/mission',
                    label: 'mission',
                    description: 'mission'
                }
            ],
            repositorySnapshot: createRepositorySnapshot()
        });

        expect(repository.repositoryId).toBe('repo-1');
        expect(application.activeRepositoryId).toBe('repo-1');
    });

    it('seeds a repository entity from sidebar summary data without route hydration', () => {
        const application = new AirportApplication();

        const repository = application.seedRepositoryFromSummary({
            repositoryId: 'repo-1',
            repositoryRootPath: '/repositories/Flying-Pillow/mission',
            label: 'mission',
            description: 'mission',
            missions: []
        });

        expect(repository.repositoryId).toBe('repo-1');
        expect(repository.summary.repositoryRootPath).toBe('/repositories/Flying-Pillow/mission');
        expect(repository.missionCountLabel).toBe('0 missions');
    });

    it('hydrates the mission route from a wrapped remote query result', async () => {
        remoteMocks.readMissionSnapshotBundle.mockResolvedValue({
            current: {
                airportRepositories: [],
                repositorySnapshot: createRepositorySnapshot(),
                missionControl: createMissionControlSnapshot(),
                missionWorktreePath: '/repositories/Flying-Pillow/mission/.flying-pillow/worktrees/mission-29',
                repositoryId: 'repo-1',
                missionId: 'mission-29'
            }
        });

        const application = new AirportApplication();
        const mission = await application.openMissionRoute({
            repositoryId: 'repo-1',
            missionId: 'mission-29'
        });

        expect(mission.missionId).toBe('mission-29');
        expect(application.activeMissionId).toBe('mission-29');
    });

    it('hydrates wrapped mission snapshot bundles from a reactive query instance', async () => {
        const application = new AirportApplication();

        const mission = application.syncMissionSnapshotBundle({
            current: {
                airportRepositories: [],
                repositorySnapshot: createRepositorySnapshot(),
                missionControl: createMissionControlSnapshot(),
                missionWorktreePath: '/repositories/Flying-Pillow/mission/.flying-pillow/worktrees/mission-29',
                repositoryId: 'repo-1',
                missionId: 'mission-29'
            }
        });

        expect(mission.missionId).toBe('mission-29');
        expect(application.activeMissionId).toBe('mission-29');
    });

    it('propagates entity query failures for invalid repository loads', async () => {
        remoteMocks.qry.mockImplementation(async (input: unknown) => {
            const invocation = input as {
                reference?: { entity?: string };
                method?: string;
            };

            if (invocation.reference?.entity === 'Airport' && invocation.method === 'listRepositories') {
                return [];
            }

            if (invocation.reference?.entity === 'Repository' && invocation.method === 'read') {
                throw new Error('Repository read failed.');
            }

            throw new Error(`Unexpected query invocation: ${JSON.stringify(invocation)}`);
        });

        const application = new AirportApplication();

        await expect(application.openRepositoryRoute('repo-1')).rejects.toThrow('Repository read failed.');
    });
});