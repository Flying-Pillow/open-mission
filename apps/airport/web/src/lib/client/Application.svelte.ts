import type {
    AirportRuntimeEventEnvelope,
    GitHubVisibleRepository,
    MissionRuntimeSnapshot,
    RepositorySnapshot
} from '@flying-pillow/mission-core/schemas';
import { repositorySnapshotSchema } from '@flying-pillow/mission-core/schemas';
import type { ActiveMissionOutline } from '$lib/client/context/app-context.svelte';
import { GithubRepository } from '$lib/components/entities/Repository/GithubRepository.svelte.js';
import { Repository } from '$lib/components/entities/Repository/Repository.svelte.js';
import type { Mission } from '$lib/components/entities/Mission/Mission.svelte.js';
import { setApp } from '$lib/client/globals';
import { AirportClientRuntime } from '$lib/client/runtime/AirportClientRuntime';
import type { RuntimeSubscription } from '$lib/client/runtime/transport/EntityRuntimeTransport';
import { qry } from '../../routes/api/entities/remote/query.remote';
import type { SidebarRepositorySummary } from '$lib/components/entities/types';

type EventSourceFactory = (url: string) => EventSource;

type AddRepositoryState = {
    error?: string;
    success?: boolean;
    repositoryPath?: string;
    githubRepository?: string;
};

export class AirportApplication {
    private readonly repositories = new Map<string, Repository>();
    private readonly runtimes = new Map<string, AirportClientRuntime>();
    private repositoryVersion = $state(0);
    #isInitialized = false;
    #githubRepositoryLoadPromise: Promise<GitHubVisibleRepository[]> | null = null;
    public githubRepositoriesState = $state<GitHubVisibleRepository[]>([]);
    public githubRepositoriesLoading = $state(false);
    public githubRepositoriesError = $state<string | undefined>();
    public addRepositoryState = $state<AddRepositoryState | undefined>();
    public addRepositoryPending = $state(false);
    public activeRepositoryId = $state<string | undefined>();
    public activeRepositoryRootPath = $state<string | undefined>();
    public activeMissionId = $state<string | undefined>();
    public activeMissionOutline = $state<ActiveMissionOutline | undefined>();
    public activeMissionSelectedNodeId = $state<string | undefined>();

    public constructor(private readonly input: {
        fetch?: typeof fetch;
        createEventSource?: EventSourceFactory;
    } = {}) {
        setApp(this);
    }

    public async initialize(): Promise<void> {
        if (this.#isInitialized) {
            return;
        }

        await Repository.find();
        await this.loadGitHubRepositories().catch(() => undefined);
        this.#isInitialized = true;
    }

    public get repositoriesState(): SidebarRepositorySummary[] {
        this.repositoryVersion;
        return [...this.repositories.values()].map((repository) => ({
            ...repository.summary,
            missions: repository.missions
        }));
    }

    public get activeRepository(): Repository | undefined {
        const activeRepositoryId = this.activeRepositoryId;
        if (!activeRepositoryId) {
            return undefined;
        }

        return this.resolveRepository(activeRepositoryId);
    }

    public get activeMission(): Mission | undefined {
        return this.activeRepository?.selectedMission;
    }

    public hydrateRepositoryData(
        snapshot: RepositorySnapshot
    ): Repository {
        const repositoryId = snapshot.repository.repositoryId;
        const existing = this.repositories.get(repositoryId);
        if (existing) {
            existing.applyData(snapshot);
            this.repositoryVersion += 1;
            return existing;
        }

        const created = new Repository(snapshot, {
            loadSnapshot: (input) => this.loadRepositorySnapshot(input),
            resolveMission: (missionSnapshot) => this.hydrateMissionSnapshot(missionSnapshot)
        });
        this.repositories.set(repositoryId, created);
        this.repositoryVersion += 1;
        return created;
    }

    public reconcileRepositories(snapshots: RepositorySnapshot[]): Repository[] {
        const nextRepositories = new Map<string, Repository>();
        const repositories = snapshots.map((snapshot) => {
            const repository = this.hydrateRepositoryData(snapshot);
            nextRepositories.set(repository.repositoryId, repository);
            return repository;
        });

        this.repositories.clear();
        for (const [repositoryId, repository] of nextRepositories.entries()) {
            this.repositories.set(repositoryId, repository);
        }
        this.repositoryVersion += 1;

        return repositories;
    }

    public seedRepositoryFromSummary(summary: SidebarRepositorySummary): Repository {
        const { missions, ...repository } = summary;

        return this.hydrateRepositoryData(repositorySnapshotSchema.parse({
            repository,
            missions: missions ?? []
        }));
    }

    public hydrateMissionSnapshot(
        snapshot: MissionRuntimeSnapshot,
        input: {
            repositoryRootPath?: string;
        } = {}
    ) {
        return this.getRuntime(input.repositoryRootPath).hydrateMissionSnapshot(snapshot);
    }

    public resolveRepository(repositoryId: string): Repository | undefined {
        this.repositoryVersion;
        return this.repositories.get(repositoryId);
    }

    public setRepositories(repositories: SidebarRepositorySummary[]): void {
        const nextRepositories = new Map<string, Repository>();
        for (const summary of repositories) {
            const repository = this.seedRepositoryFromSummary(summary);
            nextRepositories.set(repository.repositoryId, repository);
        }

        this.repositories.clear();
        for (const [repositoryId, repository] of nextRepositories.entries()) {
            this.repositories.set(repositoryId, repository);
        }
        this.repositoryVersion += 1;
    }

    public async loadGitHubRepositories(input: {
        force?: boolean;
    } = {}): Promise<GitHubVisibleRepository[]> {
        if (!input.force) {
            if (this.#githubRepositoryLoadPromise) {
                return await this.#githubRepositoryLoadPromise;
            }

            if (this.githubRepositoriesState.length > 0 || this.githubRepositoriesError) {
                return this.githubRepositoriesState;
            }
        }

        this.githubRepositoriesLoading = true;
        this.githubRepositoriesError = undefined;

        const loadPromise = GithubRepository.find()
            .then((repositories) => {
                this.githubRepositoriesState = structuredClone(repositories);
                return this.githubRepositoriesState;
            })
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                this.githubRepositoriesState = [];
                this.githubRepositoriesError = message;
                throw error;
            })
            .finally(() => {
                this.githubRepositoriesLoading = false;
                if (this.#githubRepositoryLoadPromise === loadPromise) {
                    this.#githubRepositoryLoadPromise = null;
                }
            });

        this.#githubRepositoryLoadPromise = loadPromise;
        return await loadPromise;
    }

    public async addRepository(input: {
        repositoryPath: string;
        githubRepository?: string;
    }): Promise<Repository> {
        this.addRepositoryPending = true;
        this.addRepositoryState = {
            repositoryPath: input.repositoryPath,
            ...(input.githubRepository ? { githubRepository: input.githubRepository } : {})
        };

        try {
            const repository = input.githubRepository
                ? this.hydrateRepositoryData(await GithubRepository.clone({
                    githubRepository: input.githubRepository,
                    destinationPath: `${input.repositoryPath.replace(/\/+$/u, '') || '/'}/${input.githubRepository}`
                }))
                : await Repository.add(input.repositoryPath);

            await Repository.find({ run: true });
            this.addRepositoryState = {
                success: true,
                repositoryPath: repository.repositoryRootPath,
                ...(input.githubRepository ? { githubRepository: input.githubRepository } : {})
            };
            return repository;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.addRepositoryState = {
                error: message,
                repositoryPath: input.repositoryPath,
                ...(input.githubRepository ? { githubRepository: input.githubRepository } : {})
            };
            throw error;
        } finally {
            this.addRepositoryPending = false;
        }
    }

    public async openRepositoryRoute(repositoryId: string): Promise<Repository> {
        await this.initialize();

        const repository = this.hydrateRepositoryData(
            await this.loadRepositorySnapshot({ repositoryId })
        );

        this.setActiveRepositorySelection({
            repositoryId: repository.repositoryId,
            repositoryRootPath: repository.repositoryRootPath
        });
        this.setActiveMissionSelection(repository.selectedMission?.missionId);
        this.setActiveMissionOutline(undefined);
        this.setActiveMissionSelectedNodeId(undefined);

        return repository;
    }

    public async refreshMission(input: {
        missionId: string;
        repositoryRootPath?: string;
    }) {
        return await this.getRuntime(input.repositoryRootPath).refreshMission(input.missionId);
    }

    public observeMission(input: {
        missionId: string;
        repositoryRootPath?: string;
        onUpdate?: (mission: ReturnType<AirportClientRuntime['hydrateMissionSnapshot']>, event: AirportRuntimeEventEnvelope) => void;
        onError?: (error: Error) => void;
    }): RuntimeSubscription {
        return this.getRuntime(input.repositoryRootPath).observeMission(input);
    }

    public setActiveRepositorySelection(input?: {
        repositoryId?: string;
        repositoryRootPath?: string;
    }): void {
        this.activeRepositoryId = input?.repositoryId?.trim() || undefined;
        this.activeRepositoryRootPath = input?.repositoryRootPath?.trim() || undefined;
    }

    public setActiveMissionSelection(missionId?: string): void {
        this.activeMissionId = missionId?.trim() || undefined;
    }

    public setActiveMissionOutline(outline?: ActiveMissionOutline): void {
        this.activeMissionOutline = outline;
    }

    public setActiveMissionSelectedNodeId(nodeId?: string): void {
        this.activeMissionSelectedNodeId = nodeId;
    }

    private getRuntime(repositoryRootPath?: string): AirportClientRuntime {
        const runtimeKey = repositoryRootPath?.trim() || '__default__';
        let runtime = this.runtimes.get(runtimeKey);
        if (!runtime) {
            runtime = new AirportClientRuntime({
                ...this.input,
                ...(repositoryRootPath?.trim()
                    ? { repositoryRootPath: repositoryRootPath.trim() }
                    : {})
            });
            this.runtimes.set(runtimeKey, runtime);
        }

        return runtime;
    }

    private async loadRepositorySnapshot(input: {
        repositoryId: string;
        repositoryRootPath?: string;
    }): Promise<RepositorySnapshot> {
        return repositorySnapshotSchema.parse(
            await qry({
                entity: 'Repository',
                method: 'read',
                payload: {
                    repositoryId: input.repositoryId,
                    ...(input.repositoryRootPath
                        ? { repositoryRootPath: input.repositoryRootPath }
                        : {})
                }
            }).run()
        );
    }

    // public hydrateMissionSnapshot(
    //     snapshot: MissionRuntimeSnapshot,
    //     input: {
    //         repositoryRootPath?: string;
    //     } = {}
    // ) {
    //     return this.getRuntime(input.repositoryRootPath).hydrateMissionSnapshot(snapshot);
    // }

    // public resolveRepository(repositoryId: string): Repository | undefined {
    //     return this.repositories.get(repositoryId);
    // }

    // public seedRepositoryFromSummary(summary: SidebarRepositorySummary): Repository {
    //     return this.hydrateRepositoryData({
    //         repository: parseRepositorySummary(summary),
    //         missions: summary.missions ? structuredClone(summary.missions) : []
    //     });
    // }

    // public async refreshMission(input: {
    //     missionId: string;
    //     repositoryRootPath?: string;
    // }) {
    //     return await this.getRuntime(input.repositoryRootPath).refreshMission(input.missionId);
    // }

    // public observeMission(input: {
    //     missionId: string;
    //     repositoryRootPath?: string;
    //     onUpdate?: (mission: ReturnType<AirportClientRuntime['hydrateMissionSnapshot']>, event: AirportRuntimeEventEnvelope) => void;
    //     onError?: (error: Error) => void;
    // }): RuntimeSubscription {
    //     return this.getRuntime(input.repositoryRootPath).observeMission(input);
    // }

    // public setActiveRepositorySelection(input?: {
    //     repositoryId?: string;
    //     repositoryRootPath?: string;
    // }): void {
    //     this.activeRepositoryId = input?.repositoryId?.trim() || undefined;
    //     this.activeRepositoryRootPath = input?.repositoryRootPath?.trim() || undefined;
    // }

    // public setActiveMissionSelection(missionId?: string): void {
    //     this.activeMissionId = missionId?.trim() || undefined;
    // }

    // public setActiveMissionOutline(outline?: ActiveMissionOutline): void {
    //     this.activeMissionOutline = outline;
    // }

    // public setActiveMissionSelectedNodeId(nodeId?: string): void {
    //     this.activeMissionSelectedNodeId = nodeId;
    // }

    // public setRepositories(repositories: SidebarRepositorySummary[]): void {
    //     this.repositoriesState = repositories.map((repository) => ({
    //         ...repository,
    //         ...(repository.missions ? { missions: repository.missions } : {})
    //     }));

    //     for (const summary of repositories) {
    //         const existing = this.repositories.get(summary.repositoryId);
    //         if (existing) {
    //             existing.applySummary(summary);
    //         }
    //     }
    // }

    // public async openAirportRoute(): Promise<AirportRouteData> {
    //     this.airportHomeLoading = true;
    //     this.airportHomeError = undefined;

    //     try {
    //         const data = this.syncAirportRouteData(
    //             await getAirportRouteData({}).run()
    //         );
    //         return data;
    //     } catch (error) {
    //         const message = error instanceof Error ? error.message : String(error);
    //         this.airportHomeError = message;
    //         throw error;
    //     } finally {
    //         this.airportHomeLoading = false;
    //     }
    // }

    // public async logout(): Promise<string> {
    //     const result = await logoutAirportSession({});
    //     this.reset();
    //     return result.redirectTo;
    // }

    // public async openRepositoryRoute(repositoryId: string): Promise<Repository> {
    //     const [airportRepositories, repositorySnapshot] = await Promise.all([
    //         this.loadRepositories(),
    //         this.loadRepositorySnapshot({ repositoryId })
    //     ]);

    //     return this.syncRepositoryRouteState({
    //         airportRepositories,
    //         repositorySnapshot
    //     });
    // }

    // public syncRepositoryRouteState(input: {
    //     airportRepositories: SidebarRepositorySummary[];
    //     repositorySnapshot: RepositorySnapshot;
    // }): Repository {
    //     const repository = this.hydrateRepositoryData(input.repositorySnapshot);
    //     this.setRepositories(this.mergeRepositories(
    //         input.airportRepositories,
    //         input.repositorySnapshot
    //     ));
    //     this.setActiveRepositorySelection({
    //         repositoryId: repository.repositoryId,
    //         repositoryRootPath: repository.repositoryRootPath
    //     });
    //     this.setActiveMissionSelection(repository.selectedMission?.missionId);
    //     this.setActiveMissionOutline(undefined);
    //     this.setActiveMissionSelectedNodeId(undefined);
    //     return repository;
    // }

    // public async openMissionRoute(input: {
    //     repositoryId: string;
    //     missionId: string;
    // }): Promise<Mission> {
    //     return this.syncMissionSnapshotBundle(
    //         await readMissionSnapshotBundle(input)
    //     );
    // }

    // public syncMissionSnapshotBundle(
    //     input: RemoteQueryValue<MissionSnapshotBundle> | undefined
    // ): Mission {
    //     const bundle = this.requireMissionSnapshotBundle(this.unwrapRemoteQueryValue(input));
    //     const repository = this.hydrateRepositoryData(bundle.repositorySnapshot);
    //     this.setRepositories(this.mergeRepositories(
    //         bundle.airportRepositories,
    //         bundle.repositorySnapshot
    //     ));
    //     const mission = this.hydrateMissionSnapshot(bundle.missionControl.missionRuntime, {
    //         repositoryRootPath: bundle.missionWorktreePath
    //     });

    //     mission.setRouteState({
    //         controlSnapshot: bundle.missionControl,
    //         worktreePath: bundle.missionWorktreePath
    //     });

    //     this.setActiveRepositorySelection({
    //         repositoryId: repository.repositoryId,
    //         repositoryRootPath: repository.repositoryRootPath
    //     });
    //     this.setActiveMissionSelection(mission.missionId);
    //     this.setActiveMissionOutline(toMissionOutline(bundle.missionControl));
    //     return mission;
    // }

    // public syncMissionControlState(input: {
    //     controlSnapshot: MissionControlSnapshot;
    //     repositoryRootPath?: string;
    // }): Mission {
    //     const mission = this.hydrateMissionSnapshot(input.controlSnapshot.missionRuntime, {
    //         repositoryRootPath: input.repositoryRootPath
    //     });

    //     mission.setRouteState({
    //         controlSnapshot: input.controlSnapshot,
    //         worktreePath: input.repositoryRootPath
    //     });
    //     this.setActiveMissionSelection(mission.missionId);
    //     this.setActiveMissionOutline(toMissionOutline(input.controlSnapshot));
    //     return mission;
    // }

    // public reset(): void {
    //     this.repositories.clear();
    //     this.runtimes.clear();
    //     this.#isInitialized = false;
    //     this.#repositoryLoadPromise = null;
    //     this.#githubRepositoryLoadPromise = null;
    //     this.airportHomeState = undefined;
    //     this.airportHomeLoading = false;
    //     this.airportHomeError = undefined;
    //     this.githubRepositoriesState = [];
    //     this.githubRepositoriesLoading = false;
    //     this.githubRepositoriesError = undefined;
    //     this.repositoriesLoading = false;
    //     this.repositoriesError = undefined;
    //     this.addRepositoryState = undefined;
    //     this.addRepositoryPending = false;
    //     this.repositoriesState = [];
    //     this.activeRepositoryId = undefined;
    //     this.activeRepositoryRootPath = undefined;
    //     this.activeMissionId = undefined;
    //     this.activeMissionOutline = undefined;
    //     this.activeMissionSelectedNodeId = undefined;
    // }

    // private getRuntime(repositoryRootPath?: string): AirportClientRuntime {
    //     const runtimeKey = repositoryRootPath?.trim() || '__default__';
    //     let runtime = this.runtimes.get(runtimeKey);
    //     if (!runtime) {
    //         runtime = new AirportClientRuntime({
    //             ...this.input,
    //             ...(repositoryRootPath?.trim()
    //                 ? { repositoryRootPath: repositoryRootPath.trim() }
    //                 : {})
    //         });
    //         this.runtimes.set(runtimeKey, runtime);
    //     }

    //     return runtime;
    // }

    // private async loadRepositories(input: {
    //     force?: boolean;
    // } = {}): Promise<SidebarRepositorySummary[]> {
    //     if (!input.force) {
    //         if (this.#repositoryLoadPromise) {
    //             return await this.#repositoryLoadPromise;
    //         }

    //         if (this.repositoriesState.length > 0) {
    //             return this.repositoriesState;
    //         }
    //     }

    //     this.repositoriesLoading = true;
    //     this.repositoriesError = undefined;

    //     const loadPromise = this.listRepositories()
    //         .then((repositories) => {
    //             this.setRepositories(repositories);
    //             return repositories;
    //         })
    //         .catch((error) => {
    //             const message = error instanceof Error ? error.message : String(error);
    //             this.repositoriesError = message;
    //             throw error;
    //         })
    //         .finally(() => {
    //             this.repositoriesLoading = false;
    //             if (this.#repositoryLoadPromise === loadPromise) {
    //                 this.#repositoryLoadPromise = null;
    //             }
    //         });

    //     this.#repositoryLoadPromise = loadPromise;
    //     return await loadPromise;
    // }

    // private unwrapRemoteQueryValue<T>(value: RemoteQueryValue<T> | null | undefined): T | undefined {
    //     if (!value || typeof value !== 'object') {
    //         return value ?? undefined;
    //     }

    //     if ('current' in value && value.current) {
    //         return value.current;
    //     }

    //     return value as T;
    // }

    // private requireMissionSnapshotBundle(input: MissionSnapshotBundle | undefined): MissionSnapshotBundle {
    //     if (input?.repositorySnapshot?.repository && input.missionControl && input.missionWorktreePath) {
    //         return input;
    //     }

    //     throw new Error('Mission snapshot bundle is missing repository snapshot or mission runtime state.');
    // }

    // private requireAirportRouteData(input: AirportRouteData | undefined): AirportRouteData {
    //     if (input?.airportHome?.repositories) {
    //         return input;
    //     }

    //     throw new Error('Airport route data is missing home snapshot state.');
    // }

    // private async listRepositories(): Promise<SidebarRepositorySummary[]> {
    //     const result = await qry({
    //         reference: { entity: 'Airport' },
    //         method: 'listRepositories',
    //         args: {}
    //     });

    //     if (!Array.isArray(result)) {
    //         throw new Error('Repository list response must be an array.');
    //     }

    //     return result.map((entry) => parseRepositorySummary(entry));
    // }

    // private async getRepository(repositoryId: string): Promise<Repository> {
    //     const existing = this.repositories.get(repositoryId);
    //     if (existing) {
    //         await existing.refresh();
    //         return existing;
    //     }

    //     return this.hydrateRepositoryData(
    //         await this.loadRepositorySnapshot({ repositoryId })
    //     );
    // }

    // private async loadRepositorySnapshot(input: {
    //     repositoryId: string;
    //     repositoryRootPath?: string;
    // }): Promise<RepositorySnapshot> {
    //     return parseRepositorySnapshot(
    //         await qry({
    //             reference: {
    //                 entity: 'Repository',
    //                 repositoryId: input.repositoryId,
    //                 ...(input.repositoryRootPath
    //                     ? { repositoryRootPath: input.repositoryRootPath }
    //                     : {})
    //             },
    //             method: 'read',
    //             args: {}
    //         })
    //     );
    // }

    // private mergeRepositories(
    //     repositories: SidebarRepositorySummary[],
    //     repositorySnapshot: RepositorySnapshot
    // ): SidebarRepositorySummary[] {
    //     return repositories.some(
    //         (candidate) => candidate.repositoryId === repositorySnapshot.repository.repositoryId
    //     )
    //         ? repositories.map((candidate) =>
    //             candidate.repositoryId === repositorySnapshot.repository.repositoryId
    //                 ? {
    //                     ...candidate,
    //                     missions: repositorySnapshot.missions
    //                 }
    //                 : candidate
    //         )
    //         : [
    //             {
    //                 ...repositorySnapshot.repository,
    //                 missions: repositorySnapshot.missions
    //             },
    //             ...repositories
    //         ];
    // }

    // private applyAirportHomeSnapshot(snapshot: AirportRouteData['airportHome']): void {
    //     this.setRepositories(snapshot.repositories);
    //     const selectedRepository = snapshot.selectedRepositoryRoot
    //         ? snapshot.repositories.find(
    //             (repository) => repository.repositoryRootPath === snapshot.selectedRepositoryRoot
    //         )
    //         : snapshot.repositories[0];
    //     const activeRepository = selectedRepository
    //         ? this.repositories.get(selectedRepository.repositoryId)
    //         : undefined;

    //     if (
    //         activeRepository
    //         && activeRepository.repositoryRootPath === selectedRepository?.repositoryRootPath
    //     ) {
    //         this.setActiveRepositorySelection({
    //             repositoryId: activeRepository.repositoryId,
    //             repositoryRootPath: activeRepository.repositoryRootPath
    //         });
    //     } else {
    //         this.setActiveRepositorySelection({
    //             repositoryId: selectedRepository?.repositoryId,
    //             repositoryRootPath: selectedRepository?.repositoryRootPath
    //         });
    //     }

    //     this.setActiveMissionSelection(undefined);
    //     this.setActiveMissionOutline(undefined);
    //     this.setActiveMissionSelectedNodeId(undefined);
    // }
}

// function toMissionOutline(snapshot: MissionControlSnapshot): ActiveMissionOutline {
//     return {
//         title: snapshot.operatorStatus.title,
//         currentStageId: snapshot.operatorStatus.workflow?.currentStageId,
//         briefPath: snapshot.operatorStatus.productFiles?.brief,
//         treeNodes: snapshot.operatorStatus.tower?.treeNodes ?? []
//     };
// }

export function createAirportApplication(input: {
    fetch?: typeof fetch;
    createEventSource?: EventSourceFactory;
} = {}): AirportApplication {
    void input;
    return app;
}

export const app = new AirportApplication();