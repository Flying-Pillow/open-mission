import { RepositorySnapshotSchema } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { MissionReferenceType, RepositoryPlatformRepositoryType, RepositorySnapshotType } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { MissionSnapshot } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { AirportRuntimeEventEnvelope } from '$lib/contracts/runtime-events';
import type { ActiveMissionOutline } from '$lib/client/context/app-context.svelte';
import { Repository } from '$lib/components/entities/Repository/Repository.svelte.js';
import {
    getRepositoryDisplayDescription,
    getRepositoryDisplayName
} from '$lib/components/entities/Repository/Repository.svelte.js';
import type { Mission } from '$lib/components/entities/Mission/Mission.svelte.js';
import { setApp } from '$lib/client/globals';
import { AirportClientRuntime } from '$lib/client/runtime/AirportClientRuntime';
import type { RuntimeSubscription } from '$lib/client/runtime/transport/EntityRuntimeTransport';
import { qry } from '../../routes/api/entities/remote/query.remote';
import type {
    AirportRepositoryListItem,
    SidebarRepositoryData
} from '$lib/components/entities/types';

type EventSourceFactory = (url: string) => EventSource;

type AddRepositoryState = {
    error?: string;
    success?: boolean;
    repositoryPath?: string;
    platformRepositoryRef?: string;
};

export class AirportApplication {
    private readonly repositories = new Map<string, Repository>();
    private readonly runtimes = new Map<string, AirportClientRuntime>();
    private repositoryVersion = $state(0);
    #activeRouteKey: string | undefined;
    #routeSyncRequestId = 0;
    #isInitialized = false;
    #repositoryLoadPromise: Promise<Repository[]> | null = null;
    #githubRepositoryLoadPromise: Promise<RepositoryPlatformRepositoryType[]> | null = null;
    public githubRepositoriesState = $state<RepositoryPlatformRepositoryType[]>([]);
    public githubRepositoriesLoading = $state(false);
    public githubRepositoriesError = $state<string | undefined>();
    public addRepositoryState = $state<AddRepositoryState | undefined>();
    public addRepositoryPending = $state(false);
    public activeRepositoryLoading = $state(false);
    public activeRepositoryError = $state<string | undefined>();
    public activeRepositoryId = $state<string | undefined>();
    public activeRepositoryRootPath = $state<string | undefined>();
    public activeMissionLoading = $state(false);
    public activeMissionError = $state<string | undefined>();
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

        this.#isInitialized = true;

        try {
            await this.loadRepositories();
        } catch (error) {
            this.#isInitialized = false;
            throw error;
        }
    }

    public get repositoriesState(): SidebarRepositoryData[] {
        this.repositoryVersion;
        return [...this.repositories.values()].map((repository) => ({
            ...repository.summary,
            missions: repository.missions
        }));
    }

    public get repositoryListItems(): AirportRepositoryListItem[] {
        const localRepositories = this.repositoriesState;
        const githubRepositories = this.githubRepositoriesState;
        const localByPlatformRepositoryRef = new Map<string, SidebarRepositoryData>();

        for (const repository of localRepositories) {
            const platformRepositoryRef = repository.platformRepositoryRef?.trim().toLowerCase();
            if (platformRepositoryRef) {
                localByPlatformRepositoryRef.set(platformRepositoryRef, repository);
            }
        }

        const items = localRepositories.map((repository): AirportRepositoryListItem => {
            const github = repository.platformRepositoryRef
                ? githubRepositories.find((candidate) => candidate.repositoryRef.toLowerCase() === repository.platformRepositoryRef?.toLowerCase())
                : undefined;
            return createRepositoryListItem({ local: repository, github });
        });

        for (const github of githubRepositories) {
            if (localByPlatformRepositoryRef.has(github.repositoryRef.toLowerCase())) {
                continue;
            }
            items.push(createRepositoryListItem({ github }));
        }

        return items.sort((left, right) => Number(right.isLocal) - Number(left.isLocal) || left.displayName.localeCompare(right.displayName));
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
        snapshot: RepositorySnapshotType
    ): Repository {
        const id = snapshot.repository.id;
        const existing = this.repositories.get(id);
        if (existing) {
            existing.applyData(snapshot);
            this.repositoryVersion += 1;
            return existing;
        }

        const created = new Repository(snapshot, {
            loadSnapshot: (input) => this.loadRepositorySnapshot(input),
            resolveMission: (missionSnapshot) => this.hydrateMissionSnapshot(missionSnapshot)
        });
        this.repositories.set(id, created);
        this.repositoryVersion += 1;
        return created;
    }

    public reconcileRepositories(snapshots: RepositorySnapshotType[]): Repository[] {
        const nextRepositories = new Map<string, Repository>();
        const repositories = snapshots.map((snapshot) => {
            const repository = this.hydrateRepositoryData(snapshot);
            nextRepositories.set(repository.id, repository);
            return repository;
        });

        this.repositories.clear();
        for (const [repositoryId, repository] of nextRepositories.entries()) {
            this.repositories.set(repositoryId, repository);
        }
        this.repositoryVersion += 1;

        return repositories;
    }

    public seedRepositoryFromSummary(summary: SidebarRepositoryData): Repository {
        const { missions, ...repository } = summary;

        return this.hydrateRepositoryData(RepositorySnapshotSchema.parse({
            repository,
            missions: missions ?? []
        }));
    }

    public hydrateMissionSnapshot(
        snapshot: MissionSnapshot,
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

    public setRepositories(repositories: SidebarRepositoryData[]): void {
        const nextRepositories = new Map<string, Repository>();
        for (const summary of repositories) {
            const repository = this.seedRepositoryFromSummary(summary);
            nextRepositories.set(repository.id, repository);
        }

        this.repositories.clear();
        for (const [repositoryId, repository] of nextRepositories.entries()) {
            this.repositories.set(repositoryId, repository);
        }
        this.repositoryVersion += 1;
    }

    public async loadRepositories(input: {
        force?: boolean;
    } = {}): Promise<Repository[]> {
        if (!input.force) {
            if (this.#repositoryLoadPromise) {
                return await this.#repositoryLoadPromise;
            }

            if (this.repositories.size > 0) {
                return [...this.repositories.values()];
            }
        }

        const loadPromise = Repository.find({ run: true })
            .finally(() => {
                if (this.#repositoryLoadPromise === loadPromise) {
                    this.#repositoryLoadPromise = null;
                }
            });

        this.#repositoryLoadPromise = loadPromise;
        return await loadPromise;
    }

    public async loadGitHubRepositories(input: {
        force?: boolean;
    } = {}): Promise<RepositoryPlatformRepositoryType[]> {
        if (!input.force) {
            if (this.#githubRepositoryLoadPromise) {
                return await this.#githubRepositoryLoadPromise;
            }

            if (this.githubRepositoriesState.length > 0 || this.githubRepositoriesError) {
                void this.loadRepositories({ force: true }).catch(() => undefined);
                return this.githubRepositoriesState;
            }
        }

        this.githubRepositoriesLoading = true;
        this.githubRepositoriesError = undefined;

        const loadPromise = Repository.findAvailable({ platform: 'github' })
            .then((repositories) => {
                this.githubRepositoriesState = structuredClone(repositories);
                void this.loadRepositories({ force: true }).catch(() => undefined);
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
        platformRepositoryRef?: string;
    }): Promise<Repository> {
        this.addRepositoryPending = true;
        this.addRepositoryState = {
            repositoryPath: input.repositoryPath,
            ...(input.platformRepositoryRef ? { platformRepositoryRef: input.platformRepositoryRef } : {})
        };

        try {
            const repository = input.platformRepositoryRef
                ? this.hydrateRepositoryData(await Repository.addPlatformRepository({
                    platform: 'github',
                    repositoryRef: input.platformRepositoryRef,
                    destinationPath: input.repositoryPath
                }))
                : await Repository.add(input.repositoryPath);

            await this.loadRepositories({ force: true });
            this.addRepositoryState = {
                success: true,
                repositoryPath: repository.repositoryRootPath,
                ...(input.platformRepositoryRef ? { platformRepositoryRef: input.platformRepositoryRef } : {})
            };
            return repository;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.addRepositoryState = {
                error: message,
                repositoryPath: input.repositoryPath,
                ...(input.platformRepositoryRef ? { platformRepositoryRef: input.platformRepositoryRef } : {})
            };
            throw error;
        } finally {
            this.addRepositoryPending = false;
        }
    }

    public syncPageState(input: {
        pathname: string;
        repositoryId?: string;
        missionId?: string;
    }): void {
        const pathname = input.pathname.trim() || '/';
        const repositoryId = input.repositoryId?.trim() || undefined;
        const missionId = input.missionId?.trim() || undefined;
        const routeKey = `${pathname}:${repositoryId ?? ''}:${missionId ?? ''}`;
        if (routeKey === this.#activeRouteKey) {
            return;
        }

        this.#activeRouteKey = routeKey;
        const requestId = ++this.#routeSyncRequestId;
        void this.applyPageState({
            pathname,
            repositoryId,
            missionId
        }, requestId, routeKey);
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
        id?: string;
        repositoryRootPath?: string;
    }): void {
        this.activeRepositoryId = input?.id?.trim() || undefined;
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

    private async applyPageState(input: {
        pathname: string;
        repositoryId?: string;
        missionId?: string;
    }, requestId: number, routeKey: string): Promise<void> {
        if (!input.pathname.startsWith('/airport')) {
            if (!this.isCurrentRouteSync(requestId, routeKey)) {
                return;
            }

            this.resetActiveRouteState();
            return;
        }

        await this.initialize();
        if (!this.isCurrentRouteSync(requestId, routeKey)) {
            return;
        }

        if (!input.repositoryId) {
            this.resetActiveRouteState();
            void this.loadRepositories({ force: true }).catch(() => undefined);
            void this.loadGitHubRepositories({ force: true }).catch(() => undefined);
            return;
        }

        this.activeRepositoryLoading = true;
        this.activeRepositoryError = undefined;
        this.activeMissionLoading = false;
        this.activeMissionError = undefined;
        this.setActiveMissionSelection(undefined);
        this.setActiveMissionOutline(undefined);
        this.setActiveMissionSelectedNodeId(undefined);

        let repository: Repository;
        try {
            repository = await this.loadActiveRepository(input.repositoryId);
        } catch (error) {
            if (!this.isCurrentRouteSync(requestId, routeKey)) {
                return;
            }

            this.resetActiveRouteState();
            this.activeRepositoryError = error instanceof Error ? error.message : String(error);
            return;
        }

        if (!this.isCurrentRouteSync(requestId, routeKey)) {
            return;
        }

        this.setActiveRepositorySelection({
            id: repository.id,
            repositoryRootPath: repository.repositoryRootPath
        });
        this.activeRepositoryLoading = false;

        if (!input.missionId) {
            repository.applyData({
                ...repository.toSnapshot(),
                selectedMissionId: undefined,
                selectedMission: undefined
            });
            this.activeMissionLoading = false;
            this.activeMissionError = undefined;
            return;
        }

        this.activeMissionLoading = true;
        try {
            const mission = await this.refreshMission({
                missionId: input.missionId,
                repositoryRootPath: repository.repositoryRootPath
            });
            const projectionSnapshot = await mission.getProjectionSnapshot();
            mission.setRouteState({
                projectionSnapshot,
                worktreePath: repository.repositoryRootPath
            });
            repository.applyData({
                ...repository.toSnapshot(),
                selectedMissionId: mission.missionId,
                selectedMission: mission.toSnapshot()
            });
            if (!this.isCurrentRouteSync(requestId, routeKey)) {
                return;
            }

            this.setActiveMissionSelection(mission.missionId);
            this.activeMissionError = undefined;
        } catch (error) {
            if (!this.isCurrentRouteSync(requestId, routeKey)) {
                return;
            }

            repository.applyData({
                ...repository.toSnapshot(),
                selectedMissionId: undefined,
                selectedMission: undefined
            });
            this.setActiveMissionSelection(undefined);
            this.activeMissionError = error instanceof Error ? error.message : String(error);
        } finally {
            if (this.isCurrentRouteSync(requestId, routeKey)) {
                this.activeMissionLoading = false;
            }
        }
    }

    private resetActiveRouteState(): void {
        this.activeRepositoryLoading = false;
        this.activeRepositoryError = undefined;
        this.activeMissionLoading = false;
        this.activeMissionError = undefined;
        this.setActiveRepositorySelection(undefined);
        this.setActiveMissionSelection(undefined);
        this.setActiveMissionOutline(undefined);
        this.setActiveMissionSelectedNodeId(undefined);
    }

    private isCurrentRouteSync(requestId: number, routeKey: string): boolean {
        return this.#routeSyncRequestId === requestId && this.#activeRouteKey === routeKey;
    }

    private async loadActiveRepository(id: string): Promise<Repository> {
        const repository = this.resolveRepository(id);
        if (repository) {
            return await repository.refresh();
        }

        return this.hydrateRepositoryData(
            await this.loadRepositorySnapshot({ id })
        );
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
        id: string;
        repositoryRootPath?: string;
    }): Promise<RepositorySnapshotType> {
        return RepositorySnapshotSchema.parse(
            await qry({
                entity: 'Repository',
                method: 'read',
                payload: {
                    id: input.id,
                    ...(input.repositoryRootPath
                        ? { repositoryRootPath: input.repositoryRootPath }
                        : {})
                }
            }).run()
        );
    }

}

function createRepositoryListItem(input: {
    local?: SidebarRepositoryData;
    github?: RepositoryPlatformRepositoryType;
}): AirportRepositoryListItem {
    const githubDescription = input.github?.description?.trim();
    const localDescription = input.local ? getRepositoryDisplayDescription(input.local) : undefined;
    return {
        key: input.local?.id ?? `github:${input.github?.repositoryRef ?? 'unknown'}`,
        ...(input.local ? { local: input.local } : {}),
        ...(input.github ? { github: input.github } : {}),
        displayName: input.github?.repositoryRef ?? (input.local ? getRepositoryDisplayName(input.local) : 'Repository'),
        displayDescription: githubDescription || localDescription || input.github?.htmlUrl || 'No description available',
        repositoryRootPath: input.local?.repositoryRootPath,
        platformRepositoryRef: input.github?.repositoryRef ?? input.local?.platformRepositoryRef,
        missions: (input.local?.missions ?? []) as MissionReferenceType[],
        isLocal: input.local !== undefined
    };
}

export function createAirportApplication(input: {
    fetch?: typeof fetch;
    createEventSource?: EventSourceFactory;
} = {}): AirportApplication {
    void input;
    return app;
}

export const app = new AirportApplication();