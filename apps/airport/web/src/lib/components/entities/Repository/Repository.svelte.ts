// /apps/airport/web/src/lib/components/entities/Repository/Repository.svelte.ts: OO browser entity for repository data with remote issue and mission commands.
import type { MissionSnapshot } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import { GitHubIssueDetailSchema, RepositoryMissionStartAcknowledgementSchema, RepositoryPlatformRepositorySchema, RepositorySnapshotSchema, TrackedIssueSummarySchema } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { GitHubIssueDetailType, RepositorySnapshotType, TrackedIssueSummaryType } from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import { z } from 'zod/v4';
import { getApp } from '$lib/client/globals';
import { cmd } from '../../../../routes/api/entities/remote/command.remote';
import { qry } from '../../../../routes/api/entities/remote/query.remote';
import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';
import { Mission } from '$lib/components/entities/Mission/Mission.svelte.js';

type RepositorySummary = RepositorySnapshotType['repository'];

export type RepositoryMissionResolver = (snapshot: MissionSnapshot) => Mission;
export type RepositorySnapshotLoader = (input: {
    id: string;
    repositoryRootPath?: string;
}) => Promise<RepositorySnapshotType>;

export class Repository implements EntityModel<RepositorySnapshotType> {
    private dataState = $state<RepositorySnapshotType | undefined>();
    private readonly loadSnapshot: RepositorySnapshotLoader;
    private readonly resolveMission: RepositoryMissionResolver;
    private selectedMissionState = $state<Mission | undefined>();

    public constructor(
        snapshot: RepositorySnapshotType,
        input: {
            loadSnapshot: RepositorySnapshotLoader;
            resolveMission: RepositoryMissionResolver;
        }
    ) {
        this.data = snapshot;
        this.loadSnapshot = input.loadSnapshot;
        this.resolveMission = input.resolveMission;
        this.selectedMissionModel = this.createSelectedMission(snapshot.selectedMission);
    }

    private get data(): RepositorySnapshotType {
        const data = this.dataState;
        if (!data) {
            throw new Error('Repository data is not initialized.');
        }

        return data;
    }

    private set data(snapshot: RepositorySnapshotType) {
        this.dataState = structuredClone(snapshot);
    }

    private get selectedMissionModel(): Mission | undefined {
        return this.selectedMissionState;
    }

    private set selectedMissionModel(mission: Mission | undefined) {
        this.selectedMissionState = mission;
    }

    public get id(): string {
        return this.data.repository.id;
    }

    public get repositoryRootPath(): string {
        return this.data.repository.repositoryRootPath;
    }

    public get displayName(): string {
        return getRepositoryDisplayName(this.data.repository);
    }

    public get displayDescription(): string {
        return getRepositoryDisplayDescription(this.data.repository);
    }

    public get summary(): RepositorySummary {
        return structuredClone($state.snapshot(this.data.repository));
    }

    public static async find(input: {
        run?: boolean;
    } = {}): Promise<Repository[]> {
        const repositoriesQuery = qry({
            entity: 'Repository',
            method: 'find',
            payload: {}
        });
        const snapshots = z.array(RepositorySnapshotSchema).parse(
            input.run ? await repositoriesQuery.run() : await repositoriesQuery
        );

        return getApp().reconcileRepositories(snapshots);
    }

    public static async add(repositoryPath: string): Promise<Repository> {
        const snapshot = RepositorySnapshotSchema.parse(await cmd({
            entity: 'Repository',
            method: 'add',
            payload: {
                repositoryPath
            }
        }));

        return getApp().hydrateRepositoryData(snapshot);
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
    }): Promise<RepositorySnapshotType> {
        return RepositorySnapshotSchema.parse(await cmd({
            entity: 'Repository',
            method: 'add',
            payload: input
        }));
    }

    public get selectedMissionId(): string | undefined {
        return this.data.selectedMissionId;
    }

    public get selectedMission(): Mission | undefined {
        return this.selectedMissionModel;
    }

    public get missions(): RepositorySnapshotType['missions'] {
        return structuredClone($state.snapshot(this.data.missions));
    }

    public get operationalMode(): string | undefined {
        return this.data.operationalMode;
    }

    public get controlRoot(): string | undefined {
        return this.data.controlRoot;
    }

    public get currentBranch(): string | undefined {
        return this.data.currentBranch;
    }

    public get settingsComplete(): boolean | undefined {
        return this.data.settingsComplete;
    }

    public get platformRepositoryRef(): string | undefined {
        return this.data.platformRepositoryRef;
    }

    public get missionCountLabel(): string {
        return this.data.missions.length === 1
            ? '1 mission'
            : `${this.data.missions.length} missions`;
    }

    public updateFromSnapshot(snapshot: RepositorySnapshotType): this {
        this.data = snapshot;

        if (!snapshot.selectedMission) {
            this.selectedMissionModel = undefined;
            return this;
        }

        const selectedMission = snapshot.selectedMission;
        if (this.selectedMissionModel?.missionId === selectedMission.mission.missionId) {
            this.selectedMissionModel.updateFromSnapshot(selectedMission);
            return this;
        }

        this.selectedMissionModel = this.createSelectedMission(selectedMission);
        return this;
    }

    public applyData(snapshot: RepositorySnapshotType): this {
        return this.updateFromSnapshot(snapshot);
    }

    public async refresh(): Promise<this> {
        return this.updateFromSnapshot(
            await this.loadSnapshot({
                id: this.id,
                repositoryRootPath: this.repositoryRootPath
            })
        );
    }

    public applySummary(input: RepositorySnapshotType['repository']): this {
        this.data = {
            ...this.toSnapshot(),
            repository: structuredClone(input)
        };
        return this;
    }

    public toSnapshot(): RepositorySnapshotType {
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
                id: this.id,
                repositoryRootPath: this.repositoryRootPath
            }
        });
    }

    public async getIssue(issueNumber: number): Promise<GitHubIssueDetailType> {
        return GitHubIssueDetailSchema.parse(
            await qry({
                entity: 'Repository',
                method: 'getIssue',
                payload: {
                    id: this.id,
                    repositoryRootPath: this.repositoryRootPath,
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
                id: this.id,
                repositoryRootPath: this.repositoryRootPath,
                issueNumber
            }
        }));

        return {
            missionId: result.id,
            redirectTo: `/airport/${encodeURIComponent(this.id)}/${encodeURIComponent(result.id)}`
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
                id: this.id,
                repositoryRootPath: this.repositoryRootPath,
                ...input
            }
        }));

        return {
            missionId: result.id,
            redirectTo: `/airport/${encodeURIComponent(this.id)}/${encodeURIComponent(result.id)}`
        };
    }

    private createSelectedMission(snapshot?: MissionSnapshot): Mission | undefined {
        if (!snapshot) {
            return undefined;
        }

        return this.resolveMission(snapshot);
    }
}

export function getRepositoryDisplayName(repository: RepositorySummary): string {
    return repository.platformRepositoryRef ?? repository.repoName;
}

export function getRepositoryDisplayDescription(repository: RepositorySummary): string {
    return repository.platformRepositoryRef ?? repository.repositoryRootPath;
}