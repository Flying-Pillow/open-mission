import type { EntityCommandInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/daemon/protocol/entityRemote';
import {
    MissionCatalogEntrySchema,
    MissionRuntimeEventEnvelopeSchema,
    MissionSnapshotSchema,
    type MissionCatalogEntryType,
    type MissionRuntimeEventEnvelopeType,
    type MissionSnapshotType
} from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import { RepositoryDataSchema } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { RepositoryPlatformRepositoryType, RepositoryDataType } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { ActiveMissionOutline } from '$lib/client/context/app-context.svelte';
import { Repository } from '$lib/components/entities/Repository/Repository.svelte.js';
import {
    getRepositoryDisplayDescription,
    getRepositoryDisplayName,
    toRepositoryStorage
} from '$lib/components/entities/Repository/Repository.svelte.js';
import {
    Mission,
    type MissionGatewayDependencies
} from '$lib/components/entities/Mission/Mission.svelte.js';
import { setApp } from '$lib/client/globals';
import { EntityRuntimeStore } from '$lib/client/runtime/EntityRuntimeStore';
import type { RuntimeSubscription } from '$lib/client/runtime/RuntimeSubscription';
import { cmd } from '../../routes/api/entities/remote/command.remote';
import { qry } from '../../routes/api/entities/remote/query.remote';
import type {
    AirportRepositoryListItem,
    SidebarRepositoryData
} from '$lib/components/entities/types';

type EventSourceFactory = (url: string) => EventSource;
type EntityQueryExecutionContext = 'event' | 'render';
type EntityCommandExecutor = (input: EntityCommandInvocation) => Promise<EntityRemoteResult>;

type AddRepositoryState = {
    error?: string;
    success?: boolean;
    repositoryPath?: string;
    platformRepositoryRef?: string;
};

const missionEntityName = 'Mission';

async function executeDefaultQueryRemote(
    input: EntityQueryInvocation,
    context: EntityQueryExecutionContext = 'event'
): Promise<EntityRemoteResult> {
    const remoteQuery = qry(input);
    if (context === 'render') {
        return await remoteQuery;
    }

    return await remoteQuery.run();
}

export class AirportApplication {
    private readonly repositories = new Map<string, Repository>();
    private readonly missionStores = new Map<string, EntityRuntimeStore<string, MissionSnapshotType, Mission>>();
    private repositoryVersion = $state(0);
    private activeMissionState = $state<Mission | undefined>();
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
            ...toRepositoryStorage(repository.data),
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
        return this.activeMissionState;
    }

    public hydrateRepositoryData(
        data: RepositoryDataType
    ): Repository {
        const id = data.id;
        const existing = this.repositories.get(id);
        if (existing) {
            existing.applyData(data);
            this.repositoryVersion += 1;
            return existing;
        }

        const created = new Repository(data, {
            loadData: (input) => this.loadRepositoryData(input)
        });
        this.repositories.set(id, created);
        this.repositoryVersion += 1;
        return created;
    }

    public reconcileRepositories(repositoryData: RepositoryDataType[]): Repository[] {
        const nextRepositories = new Map<string, Repository>();
        const repositories = repositoryData.map((data) => {
            const repository = this.hydrateRepositoryData(data);
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
        const hydrated = this.hydrateRepositoryData(RepositoryDataSchema.parse(repository));
        hydrated.setMissionCatalog(missions ?? []);

        return hydrated;
    }

    public hydrateMissionData(
        data: MissionSnapshotType,
        input: {
            repositoryRootPath?: string;
        } = {}
    ) {
        return this.getMissionStore(input.repositoryRootPath).upsertData(data);
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
            .then(async (repositories) => {
                await Promise.all(repositories.map((repository) => this.loadMissionCatalog(repository)));
                return repositories;
            })
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
                repositoryPath: repository.data.repositoryRootPath,
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
        return await this.getMissionStore(input.repositoryRootPath).refresh(input.missionId);
    }

    public observeMission(input: {
        missionId: string;
        repositoryRootPath?: string;
        onUpdate?: (mission: Mission, event: MissionRuntimeEventEnvelopeType) => void;
        onError?: (error: Error) => void;
    }): RuntimeSubscription {
        const missionId = input.missionId.trim();
        if (!missionId) {
            throw new Error('Mission runtime operation requires a non-empty id.');
        }

        const repositoryRootPath = input.repositoryRootPath?.trim() || undefined;
        const query = new URLSearchParams({ missionId });
        if (repositoryRootPath) {
            query.set('repositoryRootPath', repositoryRootPath);
        }

        const eventSource = (this.input.createEventSource ?? ((url) => new EventSource(url)))(`/api/runtime/events?${query.toString()}`);
        const handleRuntimeEvent = (event: Event) => {
            const messageEvent = event as MessageEvent<string>;
            void (async () => {
                try {
                    const payload = JSON.parse(messageEvent.data);
                    const runtimeEvent = MissionRuntimeEventEnvelopeSchema.parse(payload);
                    const mission = await this.getMissionStore(repositoryRootPath).get(missionId);
                    input.onUpdate?.(mission, runtimeEvent);
                } catch (error) {
                    input.onError?.(error instanceof Error ? error : new Error(String(error)));
                }
            })();
        };

        const handleError = () => {
            input.onError?.(new Error(`Mission runtime event stream failed for '${missionId}'.`));
        };

        eventSource.addEventListener('runtime', handleRuntimeEvent as EventListener);
        eventSource.addEventListener('error', handleError as EventListener);

        return {
            dispose: () => {
                eventSource.removeEventListener('runtime', handleRuntimeEvent as EventListener);
                eventSource.removeEventListener('error', handleError as EventListener);
                eventSource.close();
            }
        };
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
            repositoryRootPath: repository.data.repositoryRootPath
        });
        this.activeRepositoryLoading = false;

        if (!input.missionId) {
            repository.applyData({
                ...repository.toData()
            });
            this.activeMissionState = undefined;
            this.activeMissionLoading = false;
            this.activeMissionError = undefined;
            return;
        }

        this.activeMissionLoading = true;
        try {
            const mission = await this.refreshMission({
                missionId: input.missionId,
                repositoryRootPath: repository.data.repositoryRootPath
            });
            const projectionSnapshot = await mission.getProjectionSnapshot();
            mission.setRouteState({
                projectionSnapshot,
                worktreePath: repository.data.repositoryRootPath
            });
            this.activeMissionState = mission;
            if (!this.isCurrentRouteSync(requestId, routeKey)) {
                return;
            }

            this.setActiveMissionSelection(mission.missionId);
            this.activeMissionError = undefined;
        } catch (error) {
            if (!this.isCurrentRouteSync(requestId, routeKey)) {
                return;
            }

            this.activeMissionState = undefined;
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
        this.activeMissionState = undefined;
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
            await this.loadRepositoryData({ id })
        );
    }

    private getMissionStore(repositoryRootPath?: string): EntityRuntimeStore<string, MissionSnapshotType, Mission> {
        const runtimeKey = repositoryRootPath?.trim() || '__default__';
        let store = this.missionStores.get(runtimeKey);
        if (!store) {
            const normalizedRepositoryRootPath = repositoryRootPath?.trim() || undefined;
            store = new EntityRuntimeStore({
                loadData: (missionId) => this.loadMissionData(missionId, normalizedRepositoryRootPath),
                createEntity: (data, loadData) => new Mission({
                    snapshot: data,
                    loadData,
                    gatewayDependencies: this.createMissionGatewayDependencies(normalizedRepositoryRootPath)
                }),
                selectId: (data) => data.mission.missionId
            });
            this.missionStores.set(runtimeKey, store);
        }

        return store;
    }

    private createMissionGatewayDependencies(repositoryRootPath?: string): MissionGatewayDependencies {
        return {
            ...(repositoryRootPath ? { repositoryRootPath } : {}),
            commandRemote: cmd as EntityCommandExecutor,
            queryRemote: executeDefaultQueryRemote
        };
    }

    private async loadMissionData(missionId: string, repositoryRootPath?: string): Promise<MissionSnapshotType> {
        const normalizedMissionId = missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission runtime operation requires a non-empty id.');
        }

        return MissionSnapshotSchema.parse(await executeDefaultQueryRemote({
            entity: missionEntityName,
            method: 'read',
            payload: {
                missionId: normalizedMissionId,
                ...(repositoryRootPath?.trim() ? { repositoryRootPath: repositoryRootPath.trim() } : {})
            }
        }));
    }

    private async loadRepositoryData(input: {
        id: string;
        repositoryRootPath?: string;
    }): Promise<RepositoryDataType> {
        return RepositoryDataSchema.parse(
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

    private async loadMissionCatalog(repository: Repository): Promise<MissionCatalogEntryType[]> {
        const missions = MissionCatalogEntrySchema.array().parse(await executeDefaultQueryRemote({
            entity: missionEntityName,
            method: 'find',
            payload: {
                repositoryRootPath: repository.data.repositoryRootPath
            }
        }));
        repository.setMissionCatalog(missions);
        this.repositoryVersion += 1;
        return missions;
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
        missions: (input.local?.missions ?? []) as MissionCatalogEntryType[],
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