// /apps/airport/web/src/lib/components/entities/Repository/Repository.svelte.ts: OO browser entity for repository data with remote issue and mission commands.
import type { MissionCatalogEntryType } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import { AgentFindResultSchema, type AgentDataType } from '@flying-pillow/mission-core/entities/Agent/AgentSchema';
import { AgentExecutionDataSchema, type AgentExecutionDataType } from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import { RepositoryDataSchema, RepositoryIssueDetailSchema, RepositoryMissionStartAcknowledgementSchema, RepositoryPlatformOwnerSchema, RepositoryPlatformRepositorySchema, RepositoryRemovalSummarySchema, RepositorySetupResultSchema, RepositorySyncStatusSchema, TrackedIssueSummarySchema } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { RepositoryDataType, RepositoryIssueDetailType, RepositoryPlatformOwnerType, RepositoryRemovalSummaryType, RepositorySetupResultType, RepositorySettingsType, RepositorySyncStatusType, TrackedIssueSummaryType } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import { z } from 'zod/v4';
import { getApp } from '$lib/client/globals';
import type { AirportApplication } from '$lib/client/Application.svelte.js';
import { cmd } from '../../../../routes/api/entities/remote/command.remote';
import { qry } from '../../../../routes/api/entities/remote/query.remote';
import { AgentExecution } from '$lib/components/entities/AgentExecution/AgentExecution.svelte.js';
import { Entity } from '$lib/components/entities/Entity/Entity.svelte.js';

export type RepositoryNotificationTone = 'info' | 'success' | 'warning' | 'error';

export type RepositoryProvisionNotification = {
    message: string;
    tone: RepositoryNotificationTone;
    linkHref?: string;
    linkLabel?: string;
};

export type RepositoryProvisionResult = {
    ok: boolean;
    href?: string;
    repository?: Repository;
    notification: RepositoryProvisionNotification;
};

export type RepositoryProvisioningMode = 'clone' | 'new';

export class RepositoryProvisioningDialog {
    public open = $state(false);
    public mode = $state<RepositoryProvisioningMode>('clone');
    public repositorySearchQuery = $state('');
    public cloningRepositoryRef = $state<string | undefined>();
    public creatingRepository = $state(false);
    public availableGitHubOwners = $state<RepositoryPlatformOwnerType[]>([]);
    public availableGitHubOwnersLoading = $state(false);
    public availableGitHubOwnersError = $state<string | undefined>();
    public newRepositoryOwnerLogin = $state('');
    public newRepositoryName = $state('');
    public newRepositoryVisibility = $state<'private' | 'public' | 'internal'>('private');

    public readonly configuredRepositoriesRoot = $derived.by(() => {
        const destinationPath = this.input.readDestinationPath().trim();
        return destinationPath || '/repositories';
    });

    public readonly availableGitHubRepositories = $derived.by(() =>
        this.input.application.githubRepositoriesState
    );

    public readonly selectedOwner = $derived(
        this.availableGitHubOwners.find((owner) => owner.login === this.newRepositoryOwnerLogin)
    );

    public readonly newRepositoryRef = $derived.by(() => {
        const ownerLogin = this.newRepositoryOwnerLogin.trim();
        const repositoryName = this.newRepositoryName.trim();

        return ownerLogin && repositoryName
            ? `${ownerLogin}/${repositoryName}`
            : undefined;
    });

    public readonly canCreateRepository = $derived(
        Boolean(this.newRepositoryOwnerLogin.trim() && this.newRepositoryName.trim())
        && !this.creatingRepository
    );

    public readonly visibleGitHubRepositories = $derived.by(() => {
        const query = this.repositorySearchQuery.trim().toLowerCase();
        if (!query) {
            return this.availableGitHubRepositories;
        }

        return this.availableGitHubRepositories.filter((repository) =>
            [
                repository.repositoryRef,
                repository.description,
                repository.ownerLogin,
                repository.defaultBranch,
                ...(repository.topics ?? [])
            ].some((value) => value?.toLowerCase().includes(query))
        );
    });

    public constructor(private readonly input: {
        application: AirportApplication;
        readDestinationPath: () => string;
        notify: (notification: RepositoryProvisionNotification) => void;
        navigate: (href: string) => Promise<void> | void;
    }) { }

    public handleOpenChange = (open: boolean): void => {
        this.open = open;
        if (!open) {
            this.reset();
            return;
        }

        void this.ensureGitHubRepositoriesLoaded();
        if (this.mode === 'new') {
            void this.ensureGitHubOwnersLoaded();
        }
    };

    public selectMode = (mode: RepositoryProvisioningMode): void => {
        this.mode = mode;
        if (mode === 'new') {
            void this.ensureGitHubOwnersLoaded();
        }
    };

    public retryOwnerLookup = async (): Promise<void> => {
        await this.ensureGitHubOwnersLoaded(true);
    };

    public cloneRepository = async (repositoryRef: string): Promise<void> => {
        this.cloningRepositoryRef = repositoryRef;

        try {
            const result = await Repository.cloneFromGitHub({
                repositoryRef,
                destinationPath: this.configuredRepositoriesRoot
            });
            await this.handleProvisionResult(result);
        } finally {
            this.cloningRepositoryRef = undefined;
        }
    };

    public createRepository = async (): Promise<void> => {
        if (!this.canCreateRepository || !this.newRepositoryRef) {
            return;
        }

        this.creatingRepository = true;

        try {
            const result = await Repository.createOnGitHub({
                ownerLogin: this.newRepositoryOwnerLogin.trim(),
                repositoryName: this.newRepositoryName.trim(),
                destinationPath: this.configuredRepositoriesRoot,
                visibility: this.newRepositoryVisibility
            });
            await this.handleProvisionResult(result);
        } finally {
            this.creatingRepository = false;
        }
    };

    private reset(): void {
        this.mode = 'clone';
        this.repositorySearchQuery = '';
        this.cloningRepositoryRef = undefined;
        this.creatingRepository = false;
        this.newRepositoryOwnerLogin = this.availableGitHubOwners[0]?.login ?? '';
        this.newRepositoryName = '';
        this.newRepositoryVisibility = 'private';
    }

    private async ensureGitHubRepositoriesLoaded(): Promise<void> {
        if (this.availableGitHubRepositories.length > 0) {
            return;
        }

        await this.input.application.loadGitHubRepositories({ force: true });
    }

    private async ensureGitHubOwnersLoaded(force = false): Promise<void> {
        if (!force) {
            if (this.availableGitHubOwnersLoading) {
                return;
            }

            if (this.availableGitHubOwners.length > 0 || this.availableGitHubOwnersError) {
                return;
            }
        }

        this.availableGitHubOwnersLoading = true;
        this.availableGitHubOwnersError = undefined;

        try {
            this.availableGitHubOwners = await Repository.findAvailableGitHubOwners();
            if (!this.newRepositoryOwnerLogin && this.availableGitHubOwners.length > 0) {
                this.newRepositoryOwnerLogin = this.availableGitHubOwners[0].login;
            }
            if (
                this.newRepositoryVisibility === 'internal'
                && this.selectedOwner?.type !== 'Organization'
            ) {
                this.newRepositoryVisibility = 'private';
            }
        } catch (error) {
            this.availableGitHubOwners = [];
            this.availableGitHubOwnersError = error instanceof Error ? error.message : String(error);
        } finally {
            this.availableGitHubOwnersLoading = false;
        }
    }

    private async handleProvisionResult(result: RepositoryProvisionResult): Promise<void> {
        this.input.notify(result.notification);
        if (result.ok && result.href) {
            this.open = false;
            await this.input.navigate(result.href);
        }
    }
}

export type RepositoryDataLoader = (input: {
    id: string;
    repositoryRootPath?: string;
}) => Promise<RepositoryDataType>;

export class Repository extends Entity<RepositoryDataType> {
    public data = $state() as RepositoryDataType;
    private readonly loadData: RepositoryDataLoader;
    private readonly onChanged: (() => void) | undefined;
    private syncStatusValue = $state<RepositorySyncStatusType | undefined>();
    private repositoryAgentExecutionValue = $state<AgentExecutionDataType | undefined>();
    private repositoryAgentExecutionEntity = $state<AgentExecution | undefined>();
    public missions = $state<MissionCatalogEntryType[]>([]);
    private missionStatusesValue = $state<Record<string, string | undefined>>({});

    public constructor(
        data: RepositoryDataType,
        input: {
            loadData: RepositoryDataLoader;
            onChanged?: () => void;
        }
    ) {
        super();
        this.data = structuredClone(data);
        this.loadData = input.loadData;
        this.onChanged = input.onChanged;
    }

    private markChanged(): void {
        this.onChanged?.();
    }

    public get entityName(): string {
        return 'Repository';
    }

    public get id(): string {
        return this.data.id;
    }

    public get entityId(): string {
        return this.id;
    }

    public get syncStatus(): RepositorySyncStatusType | undefined {
        const status = $state.snapshot(this.syncStatusValue);
        return status ? structuredClone(status) : undefined;
    }

    public get repositoryAgentExecution(): AgentExecution | undefined {
        return this.repositoryAgentExecutionEntity;
    }

    public get agentExecution(): AgentExecution | undefined {
        return this.repositoryAgentExecution;
    }

    public get missionStatuses(): Record<string, string | undefined> {
        return structuredClone($state.snapshot(this.missionStatusesValue));
    }

    protected get entityLocator(): Record<string, unknown> {
        return {
            id: this.data.id,
            repositoryRootPath: this.data.repositoryRootPath
        };
    }

    public static async find(input: {
        run?: boolean;
    } = {}): Promise<Repository[]> {
        const repositoriesQuery = qry({
            entity: 'Repository',
            method: 'find',
            payload: {}
        });
        const repositoryData = z.array(RepositoryDataSchema).parse(
            input.run ? await repositoriesQuery.run() : await repositoriesQuery
        );

        return getApp().reconcileRepositories(repositoryData);
    }

    public static async findAvailable(input: {
        platform?: 'github';
        run?: boolean;
    } = {}) {
        const query = qry({
            entity: 'Repository',
            method: 'findAvailable',
            payload: input.platform ? { platform: input.platform } : {}
        });
        return RepositoryPlatformRepositorySchema.array().parse(input.run === false ? await query : await query.run());
    }

    public static async findAvailableOwners(input: {
        platform?: 'github';
        run?: boolean;
    } = {}): Promise<RepositoryPlatformOwnerType[]> {
        const query = qry({
            entity: 'Repository',
            method: 'findAvailableOwners',
            payload: input.platform ? { platform: input.platform } : {}
        });
        return RepositoryPlatformOwnerSchema.array().parse(input.run === false ? await query : await query.run());
    }

    public static async findAvailableGitHubOwners(): Promise<RepositoryPlatformOwnerType[]> {
        return await Repository.findAvailableOwners({
            platform: 'github'
        });
    }

    public static async cloneFromGitHub(input: {
        repositoryRef: string;
        destinationPath: string;
    }): Promise<RepositoryProvisionResult> {
        const application = getApp();

        try {
            const data = RepositoryDataSchema.parse(
                await Repository.executeClassCommand('repository.add', {
                    platform: 'github',
                    repositoryRef: input.repositoryRef,
                    destinationPath: input.destinationPath
                })
            );
            const repository = application.hydrateRepositoryData(data);
            await application.loadRepositories({ force: true });
            const href = `/airport/${encodeURIComponent(repository.id)}`;
            const notification = Repository.publishProvisionNotification({
                title: 'Repository cloned',
                message: `${input.repositoryRef} was added to the Airport workspace.`,
                tone: 'success',
                linkHref: href,
                linkLabel: 'Open repository'
            });

            return { ok: true, repository, href, notification };
        } catch (error) {
            const message = Repository.normalizeCommandErrorMessage(error);
            const existingRepositoryHref = Repository.resolveLocalRepositoryHref(input.repositoryRef);
            const isAlreadyCheckedOut = /already checked out/i.test(message);
            const notification = Repository.publishProvisionNotification({
                title: isAlreadyCheckedOut
                    ? 'Repository already available'
                    : 'Repository clone failed',
                message,
                tone: isAlreadyCheckedOut ? 'warning' : 'error',
                linkHref: existingRepositoryHref,
                linkLabel: isAlreadyCheckedOut ? 'Open repository' : undefined
            });

            return {
                ok: false,
                notification,
                ...(existingRepositoryHref ? { href: existingRepositoryHref } : {})
            };
        }
    }

    public static async createOnGitHub(input: {
        ownerLogin: string;
        repositoryName: string;
        destinationPath: string;
        visibility: 'private' | 'public' | 'internal';
    }): Promise<RepositoryProvisionResult> {
        const application = getApp();
        const repositoryRef = `${input.ownerLogin.trim()}/${input.repositoryName.trim()}`;

        try {
            const data = RepositoryDataSchema.parse(
                await Repository.executeClassCommand('repository.createPlatformRepository', {
                    platform: 'github',
                    ownerLogin: input.ownerLogin,
                    repositoryName: input.repositoryName,
                    destinationPath: input.destinationPath,
                    visibility: input.visibility
                })
            );
            const repository = application.hydrateRepositoryData(data);
            await Promise.all([
                application.loadRepositories({ force: true }),
                application.loadGitHubRepositories({ force: true })
            ]);
            const href = `/airport/${encodeURIComponent(repository.id)}`;
            const notification = Repository.publishProvisionNotification({
                title: 'Repository created',
                message: `${repositoryRef} was created on GitHub and prepared in the Airport workspace.`,
                tone: 'success',
                linkHref: href,
                linkLabel: 'Open repository'
            });

            return { ok: true, repository, href, notification };
        } catch (error) {
            const message = Repository.normalizeCommandErrorMessage(error);
            const existingRepositoryHref = Repository.resolveLocalRepositoryHref(repositoryRef);
            const isAlreadyCheckedOut = /already checked out/i.test(message);
            const notification = Repository.publishProvisionNotification({
                title: isAlreadyCheckedOut
                    ? 'Repository already available'
                    : 'Repository creation failed',
                message,
                tone: isAlreadyCheckedOut ? 'warning' : 'error',
                linkHref: existingRepositoryHref,
                linkLabel: isAlreadyCheckedOut ? 'Open repository' : undefined
            });

            return {
                ok: false,
                notification,
                ...(existingRepositoryHref ? { href: existingRepositoryHref } : {})
            };
        }
    }

    public static async classCommands(commandInput?: unknown, input: { run?: boolean } = {}): Promise<EntityCommandDescriptorType[]> {
        return Entity.classCommands('Repository', commandInput, input);
    }

    public static async executeClassCommand<TResult = unknown>(commandId: string, input?: unknown): Promise<TResult> {
        return Entity.executeClassCommand<TResult>('Repository', commandId, input);
    }

    private static publishProvisionNotification(input: {
        title: string;
        message: string;
        tone: RepositoryNotificationTone;
        linkHref?: string;
        linkLabel?: string;
    }): RepositoryProvisionNotification {
        getApp().publishNotification(input);

        return {
            message: input.message,
            tone: input.tone,
            ...(input.linkHref ? { linkHref: input.linkHref } : {}),
            ...(input.linkLabel ? { linkLabel: input.linkLabel } : {})
        };
    }

    private static resolveLocalRepositoryHref(repositoryRef: string): string | undefined {
        const normalizedRepositoryRef = repositoryRef.trim().toLowerCase();
        if (!normalizedRepositoryRef) {
            return undefined;
        }

        const repository = getApp().repositoryListItems.find((candidate) =>
            candidate.isLocal
            && candidate.platformRepositoryRef?.trim().toLowerCase() === normalizedRepositoryRef
        );

        return repository ? `/airport/${encodeURIComponent(repository.key)}` : undefined;
    }

    private static normalizeCommandErrorMessage(error: unknown): string {
        const fallback = error instanceof Error ? error.message : String(error);

        try {
            const parsed = JSON.parse(fallback) as { message?: unknown };
            if (typeof parsed.message === 'string' && parsed.message.trim()) {
                return parsed.message.trim();
            }
        } catch {
            return fallback;
        }

        return fallback;
    }

    public setMissionCatalog(missions: MissionCatalogEntryType[]): this {
        this.missions = structuredClone(missions);
        const missionIds = new Set(missions.map((mission) => mission.missionId));
        this.missionStatusesValue = Object.fromEntries(
            Object.entries($state.snapshot(this.missionStatusesValue)).filter(
                ([missionId]) => missionIds.has(missionId),
            ),
        );
        this.markChanged();
        return this;
    }

    public setMissionStatuses(statuses: Record<string, string | undefined>): this {
        this.missionStatusesValue = structuredClone(statuses);
        this.markChanged();
        return this;
    }

    public setMissionStatus(missionId: string, status: string | undefined): this {
        this.missionStatusesValue = {
            ...$state.snapshot(this.missionStatusesValue),
            [missionId]: status,
        };
        this.markChanged();
        return this;
    }

    public updateFromData(data: RepositoryDataType): this {
        this.data = structuredClone(data);
        this.markChanged();
        return this;
    }

    public applyData(data: RepositoryDataType): this {
        return this.updateFromData(data);
    }

    public async refresh(): Promise<this> {
        return this.updateFromData(
            await this.loadData({
                id: this.data.id,
                repositoryRootPath: this.data.repositoryRootPath
            })
        );
    }

    public applySyncStatus(input: unknown): this {
        this.syncStatusValue = RepositorySyncStatusSchema.parse(input);
        this.markChanged();
        return this;
    }

    public async refreshSyncStatus(): Promise<this> {
        return this.applySyncStatus(await qry({
            entity: 'Repository',
            method: 'syncStatus',
            payload: this.entityLocator
        }).run());
    }

    public toData(): RepositoryDataType {
        return structuredClone($state.snapshot(this.data));
    }

    public async listIssues(): Promise<TrackedIssueSummaryType[]> {
        return z.array(TrackedIssueSummarySchema).parse(
            await this.listIssuesQuery().run()
        );
    }

    public listIssuesQuery() {
        return qry({
            entity: 'Repository',
            method: 'listIssues',
            payload: {
                id: this.data.id,
                repositoryRootPath: this.data.repositoryRootPath
            }
        });
    }

    public async getIssue(issueNumber: number): Promise<RepositoryIssueDetailType> {
        return RepositoryIssueDetailSchema.parse(
            await qry({
                entity: 'Repository',
                method: 'getIssue',
                payload: {
                    id: this.data.id,
                    repositoryRootPath: this.data.repositoryRootPath,
                    issueNumber
                }
            }).run()
        );
    }

    public async readRemovalSummary(): Promise<RepositoryRemovalSummaryType> {
        return RepositoryRemovalSummarySchema.parse(
            await qry({
                entity: 'Repository',
                method: 'readRemovalSummary',
                payload: this.entityLocator
            }).run()
        );
    }

    public async startMissionFromIssue(issueNumber: number): Promise<{ missionId: string; redirectTo: string }> {
        const result = RepositoryMissionStartAcknowledgementSchema.parse(await this.executeCommand(
            this.commandIdFor('startMissionFromIssue'),
            { issueNumber }
        ));

        return {
            missionId: result.id,
            redirectTo: `/airport/${encodeURIComponent(this.data.id)}/${encodeURIComponent(result.id)}`
        };
    }

    public async setup(settings: RepositorySettingsType): Promise<RepositorySetupResultType> {
        const result = RepositorySetupResultSchema.parse(await this.executeCommand(
            this.commandIdFor('setup'),
            { settings }
        ));
        await this.refresh();
        await this.refreshCommands();
        return result;
    }

    public async configureAgents(input: {
        defaultAgentAdapter: string;
        enabledAgentAdapters: string[];
    }): Promise<this> {
        const commandInput = {
            defaultAgentAdapter: input.defaultAgentAdapter,
            enabledAgentAdapters: [...input.enabledAgentAdapters]
        };
        this.applyData(RepositoryDataSchema.parse(await this.executeCommand(
            this.commandIdFor('configureAgents'),
            commandInput
        )));
        await this.refreshCommands();
        return this;
    }

    public async configureDisplay(input: {
        icon: string | null;
    }): Promise<this> {
        this.applyData(RepositoryDataSchema.parse(await this.executeCommand(
            this.commandIdFor('configureDisplay'),
            input
        )));
        await this.refreshCommands();
        return this;
    }

    public async findAgents(): Promise<AgentDataType[]> {
        const agentsQuery = qry({
            entity: 'Agent',
            method: 'find',
            payload: {
                repositoryRootPath: this.data.repositoryRootPath
            }
        });
        return AgentFindResultSchema.parse(await agentsQuery.run());
    }

    public findAgentsQuery() {
        return qry({
            entity: 'Agent',
            method: 'find',
            payload: {
                repositoryRootPath: this.data.repositoryRootPath
            }
        });
    }

    public readAgentsQueryCurrent(input: { current?: unknown }): AgentDataType[] {
        return Array.isArray(input.current)
            ? AgentFindResultSchema.parse(input.current)
            : [];
    }

    public async ensureRepositoryAgentExecution(): Promise<AgentExecutionDataType> {
        const result = AgentExecutionDataSchema.parse(await this.executeCommand(
            this.commandIdFor('ensureRepositoryAgentExecution')
        ));
        return this.updateRepositoryAgentExecution(result);
    }

    public async commandRepositoryAgentExecution(input: {
        ownerId: string;
        agentExecutionId: string;
        commandId: string;
        input?: unknown;
    }): Promise<AgentExecutionDataType> {
        await cmd({
            entity: 'AgentExecution',
            method: 'command',
            payload: {
                ownerId: input.ownerId,
                agentExecutionId: input.agentExecutionId,
                commandId: input.commandId,
                ...(input.input !== undefined ? { input: input.input } : {})
            }
        });
        return this.updateRepositoryAgentExecution(AgentExecutionDataSchema.parse(await qry({
            entity: 'AgentExecution',
            method: 'read',
            payload: {
                ownerId: input.ownerId,
                agentExecutionId: input.agentExecutionId
            }
        }).run()));
    }

    public async refreshRepositoryAgentExecution(): Promise<AgentExecutionDataType | undefined> {
        const result = AgentExecutionDataSchema.parse(await this.executeCommand(
            this.commandIdFor('refreshRepositoryAgentExecution')
        ));
        return this.updateRepositoryAgentExecution(result);
    }

    public applyRepositoryAgentExecutionData(data: AgentExecutionDataType): void {
        this.updateRepositoryAgentExecution(data);
    }

    private updateRepositoryAgentExecution(data: AgentExecutionDataType): AgentExecutionDataType {
        const nextData = AgentExecutionDataSchema.parse(data);
        this.repositoryAgentExecutionValue = nextData;
        if (this.repositoryAgentExecutionEntity?.agentExecutionId === nextData.agentExecutionId) {
            this.repositoryAgentExecutionEntity.updateFromData(nextData);
            this.markChanged();
            return nextData;
        }

        this.repositoryAgentExecutionEntity = new AgentExecution(nextData, {
            resolveCommands: () => [],
            executeCommand: async (ownerId, agentExecutionId, commandId, input) => {
                await this.commandRepositoryAgentExecution({
                    ownerId,
                    agentExecutionId,
                    commandId,
                    ...(input !== undefined ? { input } : {})
                });
            }
        });
        this.markChanged();
        return nextData;
    }

    public async startMissionFromBrief(input: {
        title: string;
        body: string;
        type: 'feature' | 'fix' | 'docs' | 'refactor' | 'task';
    }): Promise<{ missionId: string; redirectTo: string }> {
        this.assertCanStartMission();
        const result = RepositoryMissionStartAcknowledgementSchema.parse(await this.executeCommand(
            this.commandIdFor('startMissionFromBrief'),
            input
        ));

        return {
            missionId: result.id,
            redirectTo: `/airport/${encodeURIComponent(this.data.id)}/${encodeURIComponent(result.id)}`
        };
    }

    private assertCanStartMission(): void {
        if (!this.data.isInitialized) {
            throw new Error('Complete Repository initialization before starting regular missions.');
        }
    }
}

export function getRepositoryDisplayName(repository: Pick<RepositoryDataType, 'platformRepositoryRef' | 'repoName'>): string {
    return repository.platformRepositoryRef ?? repository.repoName;
}

export function getRepositoryDisplayDescription(repository: Pick<RepositoryDataType, 'platformRepositoryRef' | 'repositoryRootPath'>): string {
    return repository.platformRepositoryRef ?? repository.repositoryRootPath;
}

export function getRepositoryIconIdentifier(
    repository: { settings?: { icon?: string | undefined } } | undefined,
    fallback = 'lucide:folder-git-2'
): string {
    const configuredIcon = repository?.settings?.icon?.trim();
    return configuredIcon && configuredIcon.length > 0 ? configuredIcon : fallback;
}
