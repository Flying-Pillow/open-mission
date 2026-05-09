import type { EntityCommandInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/entities/Entity/EntityRemote';
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import { z } from 'zod/v4';
import {
    MissionCatalogEntrySchema,
    MissionRuntimeEventEnvelopeSchema,
    MissionSnapshotSchema,
    type MissionCatalogEntryType,
    type MissionRuntimeEventEnvelopeType,
    type MissionSnapshotType
} from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { TaskConfigureCommandOptionsType } from '@flying-pillow/mission-core/entities/Task/TaskSchema';
import { RepositoryDataSchema } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import { AgentExecutionDataChangedSchema } from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import type { RepositoryPlatformRepositoryType, RepositoryDataType } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import { Repository } from '$lib/components/entities/Repository/Repository.svelte.js';
import {
    getRepositoryDisplayDescription,
    getRepositoryDisplayName
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

const applicationEntityEventSchema = z.object({
    type: z.string().trim().min(1),
    entityId: z.string().trim().min(1),
    channel: z.string().trim().min(1),
    eventName: z.string().trim().min(1),
    occurredAt: z.string().trim().min(1),
    entity: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional()
}).passthrough();

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
    private repositorySummaries = $state<SidebarRepositoryData[]>([]);
    private applicationEventSubscription: RuntimeSubscription | undefined;
    private activeMissionState = $state<Mission | undefined>();
    #selectionRequestId = 0;
    #isInitialized = false;
    #repositoryLoadPromise: Promise<Repository[]> | null = null;
    #githubRepositoryLoadPromise: Promise<RepositoryPlatformRepositoryType[]> | null = null;
    #repositoryClassCommandLoadPromise: Promise<EntityCommandDescriptorType[]> | null = null;
    public repositoryClassCommandsState = $state<EntityCommandDescriptorType[]>([]);
    public repositoryClassCommandsLoading = $state(false);
    public repositoryClassCommandsError = $state<string | undefined>();
    public githubRepositoriesState = $state<RepositoryPlatformRepositoryType[]>([]);
    public githubRepositoriesLoading = $state(false);
    public githubRepositoriesError = $state<string | undefined>();
    public activeRepositoryLoading = $state(false);
    public activeRepositoryError = $state<string | undefined>();
    public activeRepositoryId = $state<string | undefined>();
    public activeRepositoryRootPath = $state<string | undefined>();
    public activeMissionLoading = $state(false);
    public activeMissionError = $state<string | undefined>();
    public activeMissionId = $state<string | undefined>();
    public activeMissionSelectedFocusId = $state<string | undefined>();

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
        this.applicationEventSubscription ??= this.observeApplicationEvents();
    }

    public get repositoriesState(): SidebarRepositoryData[] {
        this.repositoryVersion;
        return structuredClone($state.snapshot(this.repositorySummaries));
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

    public async configureActiveMissionTask(input: {
        taskId: string;
        options: TaskConfigureCommandOptionsType;
    }): Promise<void> {
        const mission = this.activeMissionState;
        const taskId = input.taskId.trim();
        if (!mission || !taskId) {
            return;
        }

        const task = mission.getTask(taskId);
        if (!task) {
            return;
        }

        await task.configure(input.options);
        this.activeMissionState = mission;
    }

    public get activeMission(): Mission | undefined {
        return this.activeMissionState;
    }

    public get repositoryClassCommands(): EntityCommandDescriptorType[] {
        return structuredClone($state.snapshot(this.repositoryClassCommandsState));
    }

    public hydrateRepositoryData(
        data: RepositoryDataType
    ): Repository {
        const id = data.id;
        const existing = this.repositories.get(id);
        if (existing) {
            existing.applyData(data);
            this.syncRepositorySummaries();
            this.repositoryVersion += 1;
            return existing;
        }

        const created = new Repository(data, {
            loadData: (input) => this.loadRepositoryData(input)
        });
        this.repositories.set(id, created);
        this.syncRepositorySummaries();
        this.repositoryVersion += 1;
        return created;
    }

    public removeRepositoryData(repositoryId: string): void {
        if (!this.repositories.delete(repositoryId)) {
            return;
        }
        if (this.activeRepositoryId === repositoryId) {
            this.setActiveRepositorySelection(undefined);
            this.setActiveMissionSelection(undefined);
            this.activeMissionState = undefined;
            this.setActiveMissionSelectedFocusId(undefined);
        }
        this.syncRepositorySummaries();
        this.repositoryVersion += 1;
    }

    public reconcileRepositories(repositoryData: RepositoryDataType[]): Repository[] {
        const nextRepositories = new Map<string, Repository>();
        const repositories = repositoryData.map((data) => {
            const repository = this.hydrateRepositoryData(data);
            nextRepositories.set(repository.id, repository);
            return repository;
        });

        if (this.activeRepositoryId && !nextRepositories.has(this.activeRepositoryId)) {
            this.setActiveRepositorySelection(undefined);
            this.setActiveMissionSelection(undefined);
            this.activeMissionState = undefined;
            this.setActiveMissionSelectedFocusId(undefined);
        }

        this.repositories.clear();
        for (const [repositoryId, repository] of nextRepositories.entries()) {
            this.repositories.set(repositoryId, repository);
        }
        this.syncRepositorySummaries();
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
        this.syncRepositorySummaries();
        this.repositoryVersion += 1;
    }

    private syncRepositorySummaries(): void {
        this.repositorySummaries = [...this.repositories.values()].map((repository) => ({
            ...repository.toData(),
            missions: structuredClone($state.snapshot(repository.missions))
        }));
    }

    public async loadRepositories(input: {
        force?: boolean;
        refreshDetails?: boolean;
        executionContext?: EntityQueryExecutionContext;
    } = {}): Promise<Repository[]> {
        if (!input.force) {
            if (this.#repositoryLoadPromise) {
                return await this.#repositoryLoadPromise;
            }

            if (this.repositories.size > 0) {
                return [...this.repositories.values()];
            }
        }

        const loadPromise = Repository.find({ run: input.executionContext !== 'render' })
            .then(async (repositories) => {
                await Promise.all(repositories.map((repository) => this.loadMissionCatalog(repository)));
                if (input.refreshDetails) {
                    void Promise.all(repositories.map((repository) => repository.refreshCommands().catch(() => undefined)));
                    void Promise.all(repositories.map((repository) => repository.refreshSyncStatus().catch(() => undefined)));
                }
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

    public async loadRepositoryClassCommands(input: {
        force?: boolean;
        executionContext?: EntityQueryExecutionContext;
    } = {}): Promise<EntityCommandDescriptorType[]> {
        if (!input.force) {
            if (this.#repositoryClassCommandLoadPromise) {
                return await this.#repositoryClassCommandLoadPromise;
            }

            if (this.repositoryClassCommandsState.length > 0 || this.repositoryClassCommandsError) {
                return this.repositoryClassCommands;
            }
        }

        this.repositoryClassCommandsLoading = true;
        this.repositoryClassCommandsError = undefined;

        const loadPromise = Repository.classCommands(undefined, { run: input.executionContext !== 'render' })
            .then((commands) => {
                this.repositoryClassCommandsState = structuredClone(commands);
                return this.repositoryClassCommands;
            })
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                this.repositoryClassCommandsState = [];
                this.repositoryClassCommandsError = message;
                throw error;
            })
            .finally(() => {
                this.repositoryClassCommandsLoading = false;
                if (this.#repositoryClassCommandLoadPromise === loadPromise) {
                    this.#repositoryClassCommandLoadPromise = null;
                }
            });

        this.#repositoryClassCommandLoadPromise = loadPromise;
        return await loadPromise;
    }

    public async loadGitHubRepositories(input: {
        force?: boolean;
        executionContext?: EntityQueryExecutionContext;
    } = {}): Promise<RepositoryPlatformRepositoryType[]> {
        void this.loadRepositoryClassCommands({ executionContext: input.executionContext }).catch(() => undefined);

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

        const loadPromise = Repository.findAvailable({ platform: 'github', run: input.executionContext !== 'render' })
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

    public clearAirportSelection(): void {
        this.#selectionRequestId += 1;
        this.resetActiveRouteState();
    }

    public async loadAirportRepositories(): Promise<void> {
        await this.initialize();
        await Promise.allSettled([
            this.loadRepositories({ force: true, refreshDetails: true }),
            this.loadGitHubRepositories({ force: true }),
            this.loadRepositoryClassCommands({ force: true })
        ]);
    }

    public async loadRepositoryPage(input: { repositoryId: string }): Promise<void> {
        const requestId = ++this.#selectionRequestId;
        await this.applyRepositoryPageState({ repositoryId: input.repositoryId.trim() }, requestId);
    }

    public async loadMissionPage(input: { repositoryId: string; missionId: string }): Promise<void> {
        const requestId = ++this.#selectionRequestId;
        await this.applyMissionPageState({
            repositoryId: input.repositoryId.trim(),
            missionId: input.missionId.trim()
        }, requestId);
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
        onConnected?: (mission: Mission) => void;
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
        const handleConnected = () => {
            void this.refreshMission({
                missionId,
                ...(repositoryRootPath ? { repositoryRootPath } : {})
            }).then((mission) => {
                input.onConnected?.(mission);
            }).catch((error) => {
                input.onError?.(error instanceof Error ? error : new Error(String(error)));
            });
        };
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

        eventSource.addEventListener('connected', handleConnected as EventListener);
        eventSource.addEventListener('runtime', handleRuntimeEvent as EventListener);
        eventSource.addEventListener('error', handleError as EventListener);

        return {
            dispose: () => {
                eventSource.removeEventListener('connected', handleConnected as EventListener);
                eventSource.removeEventListener('runtime', handleRuntimeEvent as EventListener);
                eventSource.removeEventListener('error', handleError as EventListener);
                eventSource.close();
            }
        };
    }

    private observeApplicationEvents(): RuntimeSubscription {
        const eventSource = (this.input.createEventSource ?? ((url) => new EventSource(url)))(`/api/runtime/events?scope=application`);
        const handleConnected = () => undefined;
        const handleEntityEvent = (event: Event) => {
            const messageEvent = event as MessageEvent<string>;
            try {
                const payload = applicationEntityEventSchema.parse(JSON.parse(messageEvent.data));
                if (payload.type === 'entity.deleted' && payload.entity === 'Repository' && payload.id) {
                    this.removeRepositoryData(payload.id);
                    return;
                }
                if (payload.type === 'entity.changed' && payload.entity === 'Repository' && payload.id) {
                    const repository = this.repositories.get(payload.id);
                    if (repository && this.activeRepositoryId === payload.id) {
                        void repository.refreshSyncStatus().catch(() => undefined);
                        void repository.refreshCommands().catch(() => undefined);
                    }
                    void this.loadRepositories({ force: true }).catch(() => undefined);
                }
                if (payload.type === 'agentExecution.data.changed') {
                    const eventPayload = AgentExecutionDataChangedSchema.parse(payload.payload);
                    const repository = this.activeRepository;
                    const repositoryExecution = repository?.repositoryAgentExecution;
                    if (repositoryExecution?.sessionId === eventPayload.data.sessionId) {
                        repository?.applyRepositoryAgentExecutionData(eventPayload.data);
                    }
                }
            } catch {
                // Ignore malformed application events; request-time reads remain authoritative.
            }
        };

        const handleError = () => {
            // EventSource already reconnects; forcing repository reads here creates a retry storm while the daemon is unavailable.
        };

        eventSource.addEventListener('connected', handleConnected as EventListener);
        eventSource.addEventListener('entity', handleEntityEvent as EventListener);
        eventSource.addEventListener('error', handleError as EventListener);

        return {
            dispose: () => {
                eventSource.removeEventListener('connected', handleConnected as EventListener);
                eventSource.removeEventListener('entity', handleEntityEvent as EventListener);
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

    public setActiveMissionSelectedFocusId(focusId?: string): void {
        this.activeMissionSelectedFocusId = focusId;
    }

    private async applyRepositoryPageState(input: {
        repositoryId: string;
        skipMissionCatalogLoad?: boolean;
    }, requestId: number): Promise<boolean> {
        await this.initialize();
        if (!this.isCurrentSelectionRequest(requestId)) {
            return false;
        }

        this.activeRepositoryLoading = true;
        this.activeRepositoryError = undefined;
        this.activeMissionLoading = false;
        this.activeMissionError = undefined;
        this.setActiveMissionSelection(undefined);
        this.setActiveMissionSelectedFocusId(undefined);

        let repository: Repository;
        try {
            repository = await this.loadActiveRepository(input.repositoryId);
        } catch (error) {
            if (!this.isCurrentSelectionRequest(requestId)) {
                return false;
            }

            this.resetActiveRouteState();
            this.activeRepositoryError = error instanceof Error ? error.message : String(error);
            return false;
        }

        if (!this.isCurrentSelectionRequest(requestId)) {
            return false;
        }

        this.setActiveRepositorySelection({
            id: repository.id,
            repositoryRootPath: repository.data.repositoryRootPath
        });
        this.activeRepositoryLoading = false;

        if (!input.skipMissionCatalogLoad) {
            void repository.refreshCommands().catch(() => undefined);
            void repository.refreshSyncStatus().catch(() => undefined);
        }

        if (!input.skipMissionCatalogLoad && repository.missions.length === 0) {
            try {
                await this.loadMissionCatalog(repository);
            } catch (error) {
                if (!this.isCurrentSelectionRequest(requestId)) {
                    return false;
                }

                this.activeMissionError = error instanceof Error ? error.message : String(error);
            }
        }

        repository.applyData({
            ...repository.toData()
        });
        this.activeMissionState = undefined;
        this.activeMissionLoading = false;
        if (!this.activeMissionError) {
            this.activeMissionError = undefined;
        }
        return true;
    }

    private async applyMissionPageState(input: {
        repositoryId: string;
        missionId: string;
    }, requestId: number): Promise<void> {
        const repositoryLoaded = await this.applyRepositoryPageState({
            repositoryId: input.repositoryId,
            skipMissionCatalogLoad: true
        }, requestId);
        if (!repositoryLoaded || !this.isCurrentSelectionRequest(requestId)) {
            return;
        }

        this.activeMissionLoading = true;
        try {
            const repository = this.activeRepository;
            if (!repository) {
                throw new Error(`Repository '${input.repositoryId}' is unavailable.`);
            }
            const missionCatalogEntry = repository.missions.find((mission) => mission.missionId === input.missionId);
            const missionRepositoryRootPath = missionCatalogEntry?.repositoryRootPath ?? repository.data.repositoryRootPath;
            const mission = await this.refreshMission({
                missionId: input.missionId,
                repositoryRootPath: missionRepositoryRootPath
            });
            mission.setRouteState({
                worktreePath: missionRepositoryRootPath
            });
            this.activeMissionState = mission;
            if (!this.isCurrentSelectionRequest(requestId)) {
                return;
            }

            this.setActiveMissionSelection(mission.missionId);
            this.activeMissionError = undefined;
            const controlViewSnapshot = await mission.getControlViewSnapshot();
            if (!this.isCurrentSelectionRequest(requestId)) {
                return;
            }

            mission.setRouteState({
                controlViewSnapshot,
                worktreePath: missionRepositoryRootPath
            });
            this.activeMissionState = mission;
            if (!this.isCurrentSelectionRequest(requestId)) {
                return;
            }

            this.activeMissionError = undefined;
        } catch (error) {
            if (!this.isCurrentSelectionRequest(requestId)) {
                return;
            }

            this.activeMissionState = undefined;
            this.setActiveMissionSelection(undefined);
            this.activeMissionError = error instanceof Error ? error.message : String(error);
        } finally {
            if (this.isCurrentSelectionRequest(requestId)) {
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
        this.setActiveMissionSelectedFocusId(undefined);
    }

    private isCurrentSelectionRequest(requestId: number): boolean {
        return this.#selectionRequestId === requestId;
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
