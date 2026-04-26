// /apps/airport/web/src/lib/components/entities/Repository/Repository.svelte.ts: OO browser entity for repository data with remote issue and mission commands.
import type {
    GitHubIssueDetail,
    MissionRuntimeSnapshot,
    Repository as RepositorySummary,
    RepositorySnapshot,
    TrackedIssueSummary
} from '@flying-pillow/mission-core/airport/runtime';
import {
    githubIssueDetailSchema,
    repositorySnapshotSchema,
    repositorySchema,
    trackedIssueSummarySchema
} from '@flying-pillow/mission-core/airport/runtime';
import {
    repositoryMissionMutationStatusSchema
} from '@flying-pillow/mission-core/entities/Repository/RepositoryRemote';
import { z } from 'zod/v4';
import { getApp } from '$lib/client/globals';
import { cmd } from '../../../../routes/api/entities/remote/command.remote';
import { qry } from '../../../../routes/api/entities/remote/query.remote';
import type { EntityModel } from '$lib/components/entities/shared/EntityModel.svelte.js';
import { Mission } from '$lib/components/entities/Mission/Mission.svelte.js';

export type RepositoryMissionResolver = (snapshot: MissionRuntimeSnapshot) => Mission;
export type RepositorySnapshotLoader = (input: {
    repositoryId: string;
    repositoryRootPath?: string;
}) => Promise<RepositorySnapshot>;

export class Repository implements EntityModel<RepositorySnapshot> {
    private dataState = $state<RepositorySnapshot | undefined>();
    private readonly loadSnapshot: RepositorySnapshotLoader;
    private readonly resolveMission: RepositoryMissionResolver;
    private selectedMissionState = $state<Mission | undefined>();

    public constructor(
        snapshot: RepositorySnapshot,
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

    private get data(): RepositorySnapshot {
        const data = this.dataState;
        if (!data) {
            throw new Error('Repository data is not initialized.');
        }

        return data;
    }

    private set data(snapshot: RepositorySnapshot) {
        this.dataState = structuredClone(snapshot);
    }

    private get selectedMissionModel(): Mission | undefined {
        return this.selectedMissionState;
    }

    private set selectedMissionModel(mission: Mission | undefined) {
        this.selectedMissionState = mission;
    }

    public get repositoryId(): string {
        return this.data.repository.repositoryId;
    }

    public get id(): string {
        return this.repositoryId;
    }

    public get repositoryRootPath(): string {
        return this.data.repository.repositoryRootPath;
    }

    public get label(): string {
        return this.data.repository.label;
    }

    public get summary(): RepositorySnapshot['repository'] {
        return structuredClone($state.snapshot(this.data.repository));
    }

    public static async find(): Promise<Repository[]> {
        const snapshots = z.array(repositorySnapshotSchema).parse(
            await qry({
                entity: 'Repository',
                method: 'find',
                payload: {}
            })
        );

        return getApp().reconcileRepositories(snapshots);
    }

    public get selectedMissionId(): string | undefined {
        return this.data.selectedMissionId;
    }

    public get selectedMission(): Mission | undefined {
        return this.selectedMissionModel;
    }

    public get missions(): RepositorySnapshot['missions'] {
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

    public get githubRepository(): string | undefined {
        return this.data.githubRepository;
    }

    public get missionCountLabel(): string {
        return this.data.missions.length === 1
            ? '1 mission'
            : `${this.data.missions.length} missions`;
    }

    public updateFromSnapshot(snapshot: RepositorySnapshot): this {
        this.data = snapshot;

        if (!snapshot.selectedMission) {
            this.selectedMissionModel = undefined;
            return this;
        }

        if (this.selectedMissionModel?.missionId === snapshot.selectedMission.missionId) {
            this.selectedMissionModel.updateFromSnapshot(snapshot.selectedMission);
            return this;
        }

        this.selectedMissionModel = this.createSelectedMission(snapshot.selectedMission);
        return this;
    }

    public applyData(snapshot: RepositorySnapshot): this {
        return this.updateFromSnapshot(snapshot);
    }

    public async refresh(): Promise<this> {
        return this.updateFromSnapshot(
            await this.loadSnapshot({
                repositoryId: this.repositoryId,
                repositoryRootPath: this.repositoryRootPath
            })
        );
    }

    public applySummary(input: RepositorySnapshot['repository']): this {
        this.data = {
            ...this.toSnapshot(),
            repository: structuredClone(input)
        };
        return this;
    }

    public toSnapshot(): RepositorySnapshot {
        return structuredClone($state.snapshot(this.data));
    }

    public async listIssues(): Promise<TrackedIssueSummary[]> {
        return z.array(trackedIssueSummarySchema).parse(
            await this.listIssuesQuery()
        );
    }

    public listIssuesQuery() {
        return qry({
            entity: 'Repository',
            method: 'listIssues',
            payload: {
                repositoryId: this.repositoryId,
                repositoryRootPath: this.repositoryRootPath
            }
        });
    }

    public async getIssue(issueNumber: number): Promise<GitHubIssueDetail> {
        return githubIssueDetailSchema.parse(
            await qry({
                entity: 'Repository',
                method: 'getIssue',
                payload: {
                    repositoryId: this.repositoryId,
                    repositoryRootPath: this.repositoryRootPath,
                    issueNumber
                }
            })
        );
    }

    public async startMissionFromIssue(issueNumber: number): Promise<{ missionId: string; redirectTo: string }> {
        const result = repositoryMissionMutationStatusSchema.parse(await cmd({
            entity: 'Repository',
            method: 'startMissionFromIssue',
            payload: {
                repositoryId: this.repositoryId,
                issueNumber
            }
        }));

        return {
            missionId: result.missionId,
            redirectTo: `/repository/${encodeURIComponent(this.repositoryId)}/missions/${encodeURIComponent(result.missionId)}`
        };
    }

    public async startMissionFromBrief(input: {
        title: string;
        body: string;
        type: 'feature' | 'fix' | 'docs' | 'refactor' | 'task';
    }): Promise<{ missionId: string; redirectTo: string }> {
        const result = repositoryMissionMutationStatusSchema.parse(await cmd({
            entity: 'Repository',
            method: 'startMissionFromBrief',
            payload: {
                repositoryId: this.repositoryId,
                ...input
            }
        }));

        return {
            missionId: result.missionId,
            redirectTo: `/repository/${encodeURIComponent(this.repositoryId)}/missions/${encodeURIComponent(result.missionId)}`
        };
    }

    private createSelectedMission(snapshot?: MissionRuntimeSnapshot): Mission | undefined {
        if (!snapshot) {
            return undefined;
        }

        return this.resolveMission(snapshot);
    }
}