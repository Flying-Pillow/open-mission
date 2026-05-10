// /apps/airport/web/src/lib/components/entities/Repository/Repository.svelte.ts: OO browser entity for repository data with remote issue and mission commands.
import type { MissionCatalogEntryType } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { EntityCommandDescriptorType } from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import { AgentFindResultSchema, type AgentDataType } from '@flying-pillow/mission-core/entities/Agent/AgentSchema';
import { AgentExecutionDataSchema, type AgentExecutionDataType } from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import { RepositoryDataSchema, RepositoryIssueDetailSchema, RepositoryMissionStartAcknowledgementSchema, RepositoryPlatformRepositorySchema, RepositorySetupResultSchema, RepositorySyncStatusSchema, TrackedIssueSummarySchema } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { RepositoryDataType, RepositoryIssueDetailType, RepositorySetupResultType, RepositorySettingsType, RepositorySyncStatusType, TrackedIssueSummaryType } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import { z } from 'zod/v4';
import { getApp } from '$lib/client/globals';
import { cmd } from '../../../../routes/api/entities/remote/command.remote';
import { qry } from '../../../../routes/api/entities/remote/query.remote';
import { AgentExecution } from '$lib/components/entities/AgentExecution/AgentExecution.svelte.js';
import { Entity } from '$lib/components/entities/shared/Entity.svelte.js';

export type RepositoryDataLoader = (input: {
    id: string;
    repositoryRootPath?: string;
}) => Promise<RepositoryDataType>;

export class Repository extends Entity<RepositoryDataType> {
    public data = $state() as RepositoryDataType;
    private readonly loadData: RepositoryDataLoader;
    private commandDescriptors = $state<EntityCommandDescriptorType[]>([]);
    private syncStatusValue = $state<RepositorySyncStatusType | undefined>();
    private repositoryAgentExecutionValue = $state<AgentExecutionDataType | undefined>();
    private repositoryAgentExecutionEntity = $state<AgentExecution | undefined>();
    public missions = $state<MissionCatalogEntryType[]>([]);
    private missionStatusesValue = $state<Record<string, string | undefined>>({});

    public constructor(
        data: RepositoryDataType,
        input: {
            loadData: RepositoryDataLoader;
        }
    ) {
        super();
        this.data = structuredClone(data);
        this.loadData = input.loadData;
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

    public get commands(): EntityCommandDescriptorType[] {
        return structuredClone($state.snapshot(this.commandDescriptors));
    }

    public get syncStatus(): RepositorySyncStatusType | undefined {
        const status = $state.snapshot(this.syncStatusValue);
        return status ? structuredClone(status) : undefined;
    }

    public get repositoryAgentExecution(): AgentExecution | undefined {
        return this.repositoryAgentExecutionEntity;
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

    public static async classCommands(commandInput?: unknown, input: { run?: boolean } = {}): Promise<EntityCommandDescriptorType[]> {
        return Entity.classCommands('Repository', commandInput, input);
    }

    public static async executeClassCommand<TResult = unknown>(commandId: string, input?: unknown): Promise<TResult> {
        return Entity.executeClassCommand<TResult>('Repository', commandId, input);
    }

    public setMissionCatalog(missions: MissionCatalogEntryType[]): this {
        this.missions = structuredClone(missions);
        const missionIds = new Set(missions.map((mission) => mission.missionId));
        this.missionStatusesValue = Object.fromEntries(
            Object.entries($state.snapshot(this.missionStatusesValue)).filter(
                ([missionId]) => missionIds.has(missionId),
            ),
        );
        return this;
    }

    public setMissionStatuses(statuses: Record<string, string | undefined>): this {
        this.missionStatusesValue = structuredClone(statuses);
        return this;
    }

    public setMissionStatus(missionId: string, status: string | undefined): this {
        this.missionStatusesValue = {
            ...$state.snapshot(this.missionStatusesValue),
            [missionId]: status,
        };
        return this;
    }

    public updateFromData(data: RepositoryDataType): this {
        this.data = structuredClone(data);
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

    public async refreshCommands(): Promise<this> {
        this.commandDescriptors = await this.loadCommands();
        return this;
    }

    public applySyncStatus(input: unknown): this {
        this.syncStatusValue = RepositorySyncStatusSchema.parse(input);
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
