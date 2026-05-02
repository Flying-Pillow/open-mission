// /apps/airport/web/src/lib/components/entities/Repository/Repository.svelte.ts: OO browser entity for repository data with remote issue and mission commands.
import type { MissionCatalogEntryType } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import { GitHubIssueDetailSchema, RepositoryDataSchema, RepositoryMissionStartAcknowledgementSchema, RepositoryPlatformRepositorySchema, RepositoryStorageSchema, TrackedIssueSummarySchema } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { GitHubIssueDetailType, RepositoryDataType, RepositoryStorageType, TrackedIssueSummaryType } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import { z } from 'zod/v4';
import { getApp } from '$lib/client/globals';
import { cmd } from '../../../../routes/api/entities/remote/command.remote';
import { qry } from '../../../../routes/api/entities/remote/query.remote';
import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';

export type RepositoryDataLoader = (input: {
    id: string;
    repositoryRootPath?: string;
}) => Promise<RepositoryDataType>;

export class Repository implements EntityModel<RepositoryDataType> {
    public data = $state() as RepositoryDataType;
    private readonly loadData: RepositoryDataLoader;
    public missions = $state<MissionCatalogEntryType[]>([]);

    public constructor(
        data: RepositoryDataType,
        input: {
            loadData: RepositoryDataLoader;
        }
    ) {
        this.data = structuredClone(data);
        this.loadData = input.loadData;
    }

    public get id(): string {
        return this.data.id;
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

    public static async add(repositoryPath: string): Promise<Repository> {
        const data = RepositoryDataSchema.parse(await cmd({
            entity: 'Repository',
            method: 'add',
            payload: {
                repositoryPath
            }
        }));

        return getApp().hydrateRepositoryData(data);
    }

    public static async findAvailable(input: {
        platform?: 'github';
    } = {}) {
        return RepositoryPlatformRepositorySchema.array().parse(await qry({
            entity: 'Repository',
            method: 'findAvailable',
            payload: input
        }).run());
    }

    public static async addPlatformRepository(input: {
        platform: 'github';
        repositoryRef: string;
        destinationPath: string;
    }): Promise<RepositoryDataType> {
        return RepositoryDataSchema.parse(await cmd({
            entity: 'Repository',
            method: 'add',
            payload: input
        }));
    }

    public setMissionCatalog(missions: MissionCatalogEntryType[]): this {
        this.missions = structuredClone(missions);
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

    public applySummary(input: RepositoryStorageType): this {
        this.data = RepositoryDataSchema.parse({
            ...this.toData(),
            ...structuredClone(input)
        });
        return this;
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

    public async getIssue(issueNumber: number): Promise<GitHubIssueDetailType> {
        return GitHubIssueDetailSchema.parse(
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
        const result = RepositoryMissionStartAcknowledgementSchema.parse(await cmd({
            entity: 'Repository',
            method: 'startMissionFromIssue',
            payload: {
                id: this.data.id,
                repositoryRootPath: this.data.repositoryRootPath,
                issueNumber
            }
        }));

        return {
            missionId: result.id,
            redirectTo: `/airport/${encodeURIComponent(this.data.id)}/${encodeURIComponent(result.id)}`
        };
    }

    public async startMissionFromBrief(input: {
        title: string;
        body: string;
        type: 'feature' | 'fix' | 'docs' | 'refactor' | 'task';
    }): Promise<{ missionId: string; redirectTo: string }> {
        const result = RepositoryMissionStartAcknowledgementSchema.parse(await cmd({
            entity: 'Repository',
            method: 'startMissionFromBrief',
            payload: {
                id: this.data.id,
                repositoryRootPath: this.data.repositoryRootPath,
                ...input
            }
        }));

        return {
            missionId: result.id,
            redirectTo: `/airport/${encodeURIComponent(this.data.id)}/${encodeURIComponent(result.id)}`
        };
    }
}

export function getRepositoryDisplayName(repository: RepositoryStorageType): string {
    return repository.platformRepositoryRef ?? repository.repoName;
}

export function getRepositoryDisplayDescription(repository: RepositoryStorageType): string {
    return repository.platformRepositoryRef ?? repository.repositoryRootPath;
}

export function toRepositoryStorage(data: RepositoryDataType): RepositoryStorageType {
    return RepositoryStorageSchema.parse({
        id: data.id,
        repositoryRootPath: data.repositoryRootPath,
        ownerId: data.ownerId,
        repoName: data.repoName,
        ...(data.platformRepositoryRef ? { platformRepositoryRef: data.platformRepositoryRef } : {}),
        settings: data.settings,
        workflowConfiguration: data.workflowConfiguration,
        isInitialized: data.isInitialized
    });
}