import type { EntityCommandInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/entities/Entity/EntityRemote';
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import { z } from 'zod/v4';
import {
    ArtifactDataSchema,
} from '@flying-pillow/mission-core/entities/Artifact/ArtifactSchema';
import {
    MissionCatalogEntrySchema,
    MissionSchema,
    MissionRuntimeEventEnvelopeSchema,
    MissionStatusSchema,
    type MissionCatalogEntryType,
    type MissionType,
    type MissionRuntimeEventEnvelopeType
} from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import { StageDataSchema } from '@flying-pillow/mission-core/entities/Stage/StageSchema';
import { TaskDataSchema } from '@flying-pillow/mission-core/entities/Task/TaskSchema';
import type { TaskConfigureCommandOptionsType } from '@flying-pillow/mission-core/entities/Task/TaskSchema';
import { RepositoryDataSchema } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import { AgentExecutionDataChangedSchema, AgentExecutionDataSchema } from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import type { RepositoryPlatformRepositoryType, RepositoryDataType } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { SystemState } from '@flying-pillow/mission-core/entities/System/SystemSchema';
import { Repository } from '$lib/components/entities/Repository/Repository.svelte.js';
import { System } from '$lib/components/entities/System/System.svelte.js';
import type { Stage } from '$lib/components/entities/Stage/Stage.svelte.js';
import type { Task } from '$lib/components/entities/Task/Task.svelte.js';
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

export type AirportNotificationTone = 'info' | 'success' | 'warning' | 'error';

export type AirportNotificationRecord = {
    id: string;
    title: string;
    message: string;
    tone: AirportNotificationTone;
    createdAt: string;
    read: boolean;
    linkHref?: string;
    linkLabel?: string;
};

const airportNotificationStorageKey = 'mission.airport.notifications.v1';
const maxAirportNotifications = 50;

const airportNotificationRecordSchema = z.object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    message: z.string().trim().min(1),
    tone: z.enum(['info', 'success', 'warning', 'error']),
    createdAt: z.string().trim().min(1),
    read: z.boolean(),
    linkHref: z.string().trim().min(1).optional(),
    linkLabel: z.string().trim().min(1).optional()
});

function canUseBrowserStorage(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStoredAirportNotifications(): AirportNotificationRecord[] {
    if (!canUseBrowserStorage()) {
        return [];
    }

    try {
        const stored = window.localStorage.getItem(airportNotificationStorageKey);
        if (!stored) {
            return [];
        }

        return z.array(airportNotificationRecordSchema).parse(JSON.parse(stored));
    } catch {
        return [];
    }
}

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
    private readonly missions = new Map<string, Mission>();
    private readonly missionStores = new Map<string, EntityRuntimeStore<string, MissionType, Mission>>();
    private repositoryVersion = $state(0);
    private missionVersion = $state(0);
    private repositorySummaries = $state<SidebarRepositoryData[]>([]);
    private applicationEventSubscription: RuntimeSubscription | undefined;
    private missionEventSubscription: RuntimeSubscription | undefined;
    private notificationsState = $state<AirportNotificationRecord[]>(readStoredAirportNotifications());
    public system = $state<System | undefined>();
    public repository = $state<Repository | undefined>();
    public mission = $state<Mission | undefined>();
    public stage = $state<Stage | undefined>();
    public task = $state<Task | undefined>();
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
    public repositoryLoading = $state(false);
    public repositoryError = $state<string | undefined>();
    public missionLoading = $state(false);
    public missionError = $state<string | undefined>();
    public focusId = $state<string | undefined>();
    public artifactId = $state<string | undefined>();

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

    public setSystemState(state?: SystemState): void {
        if (!state) {
            this.system = undefined;
            return;
        }

        if (this.system) {
            this.system.applyData(state);
            return;
        }

        this.system = new System(state);
    }

    public async configureTask(input: {
        taskId: string;
        options: TaskConfigureCommandOptionsType;
    }): Promise<void> {
        const mission = this.mission;
        const taskId = input.taskId.trim();
        if (!mission || !taskId) {
            return;
        }

        const task = mission.getTask(taskId);
        if (!task) {
            return;
        }

        await task.configure(input.options);
        this.mission = mission;
    }

    public get repositoryClassCommands(): EntityCommandDescriptorType[] {
        return structuredClone($state.snapshot(this.repositoryClassCommandsState));
    }

    public get notifications(): AirportNotificationRecord[] {
        return structuredClone($state.snapshot(this.notificationsState));
    }

    public get unreadNotificationCount(): number {
        return this.notificationsState.filter((notification) => !notification.read).length;
    }

    public publishNotification(input: {
        title: string;
        message: string;
        tone?: AirportNotificationTone;
        linkHref?: string;
        linkLabel?: string;
    }): AirportNotificationRecord {
        const notification: AirportNotificationRecord = {
            id: crypto.randomUUID(),
            title: input.title.trim(),
            message: input.message.trim(),
            tone: input.tone ?? 'info',
            createdAt: new Date().toISOString(),
            read: false,
            linkHref: input.linkHref?.trim() || undefined,
            linkLabel: input.linkLabel?.trim() || undefined
        };

        this.notificationsState = [notification, ...this.notificationsState].slice(0, maxAirportNotifications);
        this.persistNotifications();
        return notification;
    }

    public markNotificationRead(notificationId: string): void {
        const normalizedNotificationId = notificationId.trim();
        if (!normalizedNotificationId) {
            return;
        }

        let changed = false;
        this.notificationsState = this.notificationsState.map((notification) => {
            if (notification.id !== normalizedNotificationId || notification.read) {
                return notification;
            }

            changed = true;
            return { ...notification, read: true };
        });

        if (changed) {
            this.persistNotifications();
        }
    }

    public markAllNotificationsRead(): void {
        if (this.notificationsState.every((notification) => notification.read)) {
            return;
        }

        this.notificationsState = this.notificationsState.map((notification) => ({
            ...notification,
            read: true
        }));
        this.persistNotifications();
    }

    public clearNotifications(): void {
        if (this.notificationsState.length === 0) {
            return;
        }

        this.notificationsState = [];
        this.persistNotifications();
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
            loadData: (input) => this.loadRepositoryData(input),
            onChanged: () => {
                this.syncRepositorySummaries();
                this.repositoryVersion += 1;
            }
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
        if (this.repository?.id === repositoryId) {
            this.clearEntitySelection();
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

        if (this.repository && !nextRepositories.has(this.repository.id)) {
            this.clearEntitySelection();
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
        data: MissionType,
        input: {
            repositoryRootPath?: string;
        } = {}
    ) {
        const mission = this.getMissionStore(input.repositoryRootPath).upsertData(data);
        this.syncTrackedMission(mission, input.repositoryRootPath);
        return mission;
    }

    public resolveMission(input: {
        missionId: string;
        repositoryRootPath?: string;
    }): Mission | undefined {
        this.missionVersion;
        return this.missions.get(createMissionRegistryKey(input.missionId, input.repositoryRootPath));
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
        this.resetRouteState();
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
        const mission = await this.getMissionStore(input.repositoryRootPath).refresh(input.missionId);
        this.syncTrackedMission(mission, input.repositoryRootPath);
        return mission;
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
                    if (repository && repository.id === this.repository?.id) {
                        void repository.refreshSyncStatus().catch(() => undefined);
                        void repository.refreshCommands().catch(() => undefined);
                    }
                    void this.loadRepositories({ force: true }).catch(() => undefined);
                }
                const runtimeEvent = MissionRuntimeEventEnvelopeSchema.safeParse(payload);
                if (runtimeEvent.success) {
                    void this.applyApplicationMissionRuntimeEvent(runtimeEvent.data).catch(() => undefined);
                    return;
                }
                if (payload.type === 'agentExecution.data.changed') {
                    const eventPayload = AgentExecutionDataChangedSchema.parse(payload.payload);
                    const repository = this.repository;
                    const repositoryExecution = repository?.repositoryAgentExecution;
                    if (repositoryExecution?.agentExecutionId === eventPayload.data.agentExecutionId) {
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

    public selectStage(stage?: Stage): void {
        this.stage = stage;
        this.task = undefined;
        this.focusId = stage ? `stage:${stage.stageId}` : undefined;
    }

    public selectTask(task?: Task): void {
        this.task = task;
        this.stage = task ? this.mission?.getStage(task.stageId) : undefined;
        this.focusId = task ? `task:${task.taskId}` : this.stage ? `stage:${this.stage.stageId}` : undefined;
    }

    public selectFocus(focusId: string): void {
        const normalizedFocusId = focusId.trim();
        if (!normalizedFocusId || !this.mission) {
            this.selectStage(undefined);
            return;
        }

        if (normalizedFocusId.startsWith('task:')) {
            this.selectTask(this.mission.getTask(normalizedFocusId.slice('task:'.length)));
            return;
        }

        if (normalizedFocusId.startsWith('stage:')) {
            this.selectStage(this.mission.getStage(normalizedFocusId.slice('stage:'.length)));
            return;
        }

        this.selectStage(undefined);
    }

    public selectArtifact(artifactId?: string): void {
        this.artifactId = artifactId?.trim() || undefined;
    }

    private async applyRepositoryPageState(input: {
        repositoryId: string;
        skipMissionCatalogLoad?: boolean;
    }, requestId: number): Promise<boolean> {
        await this.initialize();
        if (!this.isCurrentSelectionRequest(requestId)) {
            return false;
        }

        this.repositoryLoading = true;
        this.repositoryError = undefined;
        this.missionLoading = false;
        this.missionError = undefined;
        this.mission = undefined;
        this.selectStage(undefined);
        this.selectArtifact(undefined);

        let repository: Repository;
        try {
            repository = await this.loadRepositoryEntity(input.repositoryId);
        } catch (error) {
            if (!this.isCurrentSelectionRequest(requestId)) {
                return false;
            }

            this.resetRouteState();
            this.repositoryError = error instanceof Error ? error.message : String(error);
            return false;
        }

        if (!this.isCurrentSelectionRequest(requestId)) {
            return false;
        }

        this.repository = repository;
        this.repositoryLoading = false;

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

                this.missionError = error instanceof Error ? error.message : String(error);
            }
        }

        repository.applyData({
            ...repository.toData()
        });
        this.mission = undefined;
        this.missionLoading = false;
        if (!this.missionError) {
            this.missionError = undefined;
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

        this.missionLoading = true;
        try {
            const repository = this.repository;
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
            this.mission = mission;
            if (!this.isCurrentSelectionRequest(requestId)) {
                return;
            }

            this.missionError = undefined;
            const controlData = await mission.getControlData();
            if (!this.isCurrentSelectionRequest(requestId)) {
                return;
            }

            mission.setRouteState({
                controlData,
                worktreePath: missionRepositoryRootPath
            });
            this.mission = mission;
            this.reconcileMissionSelection();
            this.observeLoadedMission(missionRepositoryRootPath);
            if (!this.isCurrentSelectionRequest(requestId)) {
                return;
            }

            this.missionError = undefined;
        } catch (error) {
            if (!this.isCurrentSelectionRequest(requestId)) {
                return;
            }

            this.mission = undefined;
            this.selectStage(undefined);
            this.missionError = error instanceof Error ? error.message : String(error);
        } finally {
            if (this.isCurrentSelectionRequest(requestId)) {
                this.missionLoading = false;
            }
        }
    }

    private resetRouteState(): void {
        this.repositoryLoading = false;
        this.repositoryError = undefined;
        this.missionLoading = false;
        this.missionError = undefined;
        this.missionEventSubscription?.dispose();
        this.missionEventSubscription = undefined;
        this.clearEntitySelection();
    }

    private clearEntitySelection(): void {
        this.repository = undefined;
        this.mission = undefined;
        this.selectStage(undefined);
        this.selectArtifact(undefined);
    }

    private observeLoadedMission(repositoryRootPath?: string): void {
        this.missionEventSubscription?.dispose();
        const mission = this.mission;
        if (!mission) {
            this.missionEventSubscription = undefined;
            return;
        }

        this.missionEventSubscription = this.observeMission({
            missionId: mission.missionId,
            ...(repositoryRootPath ? { repositoryRootPath } : {}),
            onConnected: (connectedMission) => {
                this.mission = connectedMission;
                this.reconcileMissionSelection();
            },
            onUpdate: (_, event) => {
                this.applyMissionRuntimeEvent(event);
                this.reconcileMissionSelection();
            },
            onError: (error) => {
                this.missionError = error.message;
            }
        });
    }

    private applyMissionRuntimeEvent(event: MissionRuntimeEventEnvelopeType): void {
        const mission = this.mission;
        if (!mission) {
            return;
        }

        switch (event.type) {
            case 'mission.changed': {
                const payload = event.payload as { mission?: unknown };
                mission.applyMissionData(MissionSchema.parse(payload.mission));
                return;
            }
            case 'mission.status': {
                const payload = event.payload as { status?: unknown };
                mission.applyMissionStatus(MissionStatusSchema.parse(payload.status));
                return;
            }
            case 'stage.data.changed': {
                const payload = event.payload as { data?: unknown };
                mission.applyStageData(StageDataSchema.parse(payload.data));
                return;
            }
            case 'task.data.changed': {
                const payload = event.payload as { data?: unknown };
                mission.applyTaskData(TaskDataSchema.parse(payload.data));
                return;
            }
            case 'artifact.data.changed': {
                const payload = event.payload as { data?: unknown };
                mission.applyArtifactData(ArtifactDataSchema.parse(payload.data));
                return;
            }
            case 'agentExecution.data.changed': {
                const payload = event.payload as { data?: unknown };
                mission.applyAgentExecutionData(AgentExecutionDataSchema.parse(payload.data));
                return;
            }
            case 'execution.event': {
                const payload = event.payload as { session?: unknown };
                mission.applyAgentExecutionData(AgentExecutionDataSchema.parse(payload.session));
                return;
            }
            case 'execution.lifecycle':
            default:
                return;
        }
    }

    private reconcileMissionSelection(): void {
        const mission = this.mission;
        if (!mission) {
            this.selectStage(undefined);
            return;
        }

        if (this.task) {
            this.selectTask(mission.getTask(this.task.taskId));
            return;
        }

        if (this.stage) {
            this.selectStage(mission.getStage(this.stage.stageId));
            return;
        }

        const currentStageId = mission.controlData?.workflow?.currentStageId;
        this.selectStage(currentStageId ? mission.getStage(currentStageId) : undefined);
    }

    private isCurrentSelectionRequest(requestId: number): boolean {
        return this.#selectionRequestId === requestId;
    }

    private async loadRepositoryEntity(id: string): Promise<Repository> {
        const repository = this.resolveRepository(id);
        if (repository) {
            return await repository.refresh();
        }

        return this.hydrateRepositoryData(
            await this.loadRepositoryData({ id })
        );
    }

    private getMissionStore(repositoryRootPath?: string): EntityRuntimeStore<string, MissionType, Mission> {
        const runtimeKey = repositoryRootPath?.trim() || '__default__';
        let store = this.missionStores.get(runtimeKey);
        if (!store) {
            const normalizedRepositoryRootPath = repositoryRootPath?.trim() || undefined;
            store = new EntityRuntimeStore({
                loadData: (missionId) => this.loadMissionData(missionId, normalizedRepositoryRootPath),
                createEntity: (data, loadData) => new Mission({
                    data,
                    loadData,
                    gatewayDependencies: this.createMissionGatewayDependencies(normalizedRepositoryRootPath)
                }),
                selectId: (data) => data.missionId
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

    private persistNotifications(): void {
        if (!canUseBrowserStorage()) {
            return;
        }

        try {
            window.localStorage.setItem(
                airportNotificationStorageKey,
                JSON.stringify(this.notificationsState)
            );
        } catch {
            // Ignore persistence failures and keep in-memory notifications available.
        }
    }

    private async loadMissionData(missionId: string, repositoryRootPath?: string): Promise<MissionType> {
        const normalizedMissionId = missionId.trim();
        if (!normalizedMissionId) {
            throw new Error('Mission runtime operation requires a non-empty id.');
        }

        return MissionSchema.parse(await executeDefaultQueryRemote({
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
        await this.loadMissionCatalogStatuses(repository);
        this.repositoryVersion += 1;
        return missions;
    }

    private async loadMissionCatalogStatuses(repository: Repository): Promise<Record<string, string | undefined>> {
        const missions = [...repository.missions];
        if (missions.length === 0) {
            repository.setMissionStatuses({});
            return {};
        }

        const results = await Promise.allSettled(
            missions.map(async (mission) => {
                const missionEntity = await this.refreshMission({
                    missionId: mission.missionId,
                    repositoryRootPath: mission.repositoryRootPath ?? repository.data.repositoryRootPath,
                });

                return [mission.missionId, missionEntity.workflowLifecycle] as const;
            }),
        );

        const statuses: Record<string, string | undefined> = {};
        for (const result of results) {
            if (result.status !== 'fulfilled') {
                continue;
            }

            statuses[result.value[0]] = result.value[1];
        }

        repository.setMissionStatuses(statuses);
        return statuses;
    }

    private async applyApplicationMissionRuntimeEvent(event: MissionRuntimeEventEnvelopeType): Promise<void> {
        const missionId = readMissionIdFromRuntimeEvent(event);
        if (!missionId) {
            return;
        }

        const repositoryRootPath = this.resolveMissionRepositoryRootPath(missionId);
        const trackedMission = this.resolveMission({
            missionId,
            ...(repositoryRootPath ? { repositoryRootPath } : {})
        });

        switch (event.type) {
            case 'mission.status': {
                const lifecycle = event.payload.workflow?.lifecycle;
                this.applyMissionCatalogStatus(missionId, lifecycle);

                if (trackedMission) {
                    trackedMission.applyMissionStatus(event.payload);
                    this.syncTrackedMission(trackedMission, repositoryRootPath);
                    return;
                }

                if (shouldTrackMissionLifecycle(lifecycle) && repositoryRootPath) {
                    await this.refreshMission({ missionId, repositoryRootPath });
                }
                return;
            }
            case 'mission.changed': {
                const data = event.payload.mission;
                const mission = this.hydrateMissionData(data, {
                    ...(repositoryRootPath ? { repositoryRootPath } : {})
                });
                this.applyMissionCatalogStatus(data.missionId, mission.workflowLifecycle);
                this.syncTrackedMission(mission, repositoryRootPath);
                return;
            }
            default:
                return;
        }
    }

    private applyMissionCatalogStatus(missionId: string, lifecycle: string | undefined): void {
        for (const repository of this.repositories.values()) {
            if (!repository.missions.some((mission) => mission.missionId === missionId)) {
                continue;
            }

            repository.setMissionStatus(missionId, lifecycle);
        }
    }

    private resolveMissionRepositoryRootPath(missionId: string): string | undefined {
        for (const repository of this.repositories.values()) {
            const mission = repository.missions.find((candidate) => candidate.missionId === missionId);
            if (!mission) {
                continue;
            }

            return mission.repositoryRootPath ?? repository.data.repositoryRootPath;
        }

        return undefined;
    }

    private syncTrackedMission(mission: Mission, repositoryRootPath?: string): void {
        const key = createMissionRegistryKey(mission.missionId, repositoryRootPath);
        if (!shouldTrackMissionLifecycle(mission.workflowLifecycle)) {
            if (this.missions.delete(key)) {
                this.missionVersion += 1;
            }
            return;
        }

        const existing = this.missions.get(key);
        if (existing !== mission) {
            this.missions.set(key, mission);
            this.missionVersion += 1;
        }
    }

}

function createMissionRegistryKey(missionId: string, repositoryRootPath?: string): string {
    return `${repositoryRootPath?.trim() || '__default__'}::${missionId.trim()}`;
}

function readMissionIdFromRuntimeEvent(event: MissionRuntimeEventEnvelopeType): string | undefined {
    switch (event.type) {
        case 'mission.status':
            return event.payload.missionId;
        case 'mission.changed':
            return event.payload.mission.missionId;
        default:
            return undefined;
    }
}

function shouldTrackMissionLifecycle(lifecycle: string | undefined): boolean {
    const normalizedLifecycle = lifecycle?.trim().toLowerCase();
    if (!normalizedLifecycle) {
        return false;
    }

    return !new Set(['completed', 'failed', 'cancelled', 'terminated', 'delivered']).has(normalizedLifecycle);
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
