// /apps/airport/web/src/lib/client/entities/Repository.ts: OO browser entity for repository surface state with remote issue and mission commands.
import type {
    GitHubIssueDetailDto,
    MissionRuntimeSnapshotDto,
    RepositorySurfaceSnapshotDto,
    TrackedIssueSummaryDto
} from '@flying-pillow/mission-core/airport/runtime';
import type { EntityModel } from '$lib/client/entities/EntityModel';
import { Mission, type MissionCommandGateway } from '$lib/client/entities/Mission';

export type RepositoryIssueGateway = {
    listIssues(input: {
        repositoryId: string;
        repositoryRootPath: string;
    }): Promise<TrackedIssueSummaryDto[]>;
    getIssue(input: {
        repositoryId: string;
        repositoryRootPath: string;
        issueNumber: number;
    }): Promise<GitHubIssueDetailDto>;
};

export type RepositoryMissionGateway = {
    startMissionFromIssue(input: {
        issueNumber: number;
    }): Promise<{
        missionId: string;
        redirectTo: string;
    }>;
};

export type RepositoryGateway = RepositoryIssueGateway & RepositoryMissionGateway;

export class Repository implements EntityModel<RepositorySurfaceSnapshotDto> {
    private surface: RepositorySurfaceSnapshotDto;
    private readonly gateway: RepositoryGateway;
    private readonly missionCommands: MissionCommandGateway;
    private selectedMissionModel?: Mission;

    public constructor(
        surface: RepositorySurfaceSnapshotDto,
        input: {
            gateway: RepositoryGateway;
            missionCommands: MissionCommandGateway;
        }
    ) {
        this.surface = structuredClone(surface);
        this.gateway = input.gateway;
        this.missionCommands = input.missionCommands;
        this.selectedMissionModel = this.createSelectedMission(surface.selectedMission);
    }

    public get repositoryId(): string {
        return this.surface.repository.repositoryId;
    }

    public get id(): string {
        return this.repositoryId;
    }

    public get repositoryRootPath(): string {
        return this.surface.repository.repositoryRootPath;
    }

    public get label(): string {
        return this.surface.repository.label;
    }

    public get summary(): RepositorySurfaceSnapshotDto['repository'] {
        return structuredClone(this.surface.repository);
    }

    public get selectedMissionId(): string | undefined {
        return this.surface.selectedMissionId;
    }

    public get selectedMission(): Mission | undefined {
        return this.selectedMissionModel;
    }

    public get missions(): RepositorySurfaceSnapshotDto['missions'] {
        return structuredClone(this.surface.missions);
    }

    public get operationalMode(): string | undefined {
        return this.surface.operationalMode;
    }

    public get controlRoot(): string | undefined {
        return this.surface.controlRoot;
    }

    public get currentBranch(): string | undefined {
        return this.surface.currentBranch;
    }

    public get settingsComplete(): boolean | undefined {
        return this.surface.settingsComplete;
    }

    public get githubRepository(): string | undefined {
        return this.surface.githubRepository;
    }

    public get missionCountLabel(): string {
        return this.surface.missions.length === 1
            ? '1 mission'
            : `${this.surface.missions.length} missions`;
    }

    public updateFromSnapshot(surface: RepositorySurfaceSnapshotDto): this {
        this.surface = structuredClone(surface);

        if (!surface.selectedMission) {
            this.selectedMissionModel = undefined;
            return this;
        }

        if (this.selectedMissionModel?.missionId === surface.selectedMission.missionId) {
            this.selectedMissionModel.updateFromSnapshot(surface.selectedMission);
            return this;
        }

        this.selectedMissionModel = this.createSelectedMission(surface.selectedMission);
        return this;
    }

    public applySurface(surface: RepositorySurfaceSnapshotDto): this {
        return this.updateFromSnapshot(surface);
    }

    public toSnapshot(): RepositorySurfaceSnapshotDto {
        return structuredClone(this.surface);
    }

    public toJSON(): RepositorySurfaceSnapshotDto {
        return this.toSnapshot();
    }

    public async listIssues(): Promise<TrackedIssueSummaryDto[]> {
        return this.gateway.listIssues({
            repositoryId: this.repositoryId,
            repositoryRootPath: this.repositoryRootPath
        });
    }

    public async getIssue(issueNumber: number): Promise<GitHubIssueDetailDto> {
        return this.gateway.getIssue({
            repositoryId: this.repositoryId,
            repositoryRootPath: this.repositoryRootPath,
            issueNumber
        });
    }

    public async startMissionFromIssue(issueNumber: number): Promise<{ missionId: string; redirectTo: string }> {
        return this.gateway.startMissionFromIssue({ issueNumber });
    }

    private createSelectedMission(snapshot?: MissionRuntimeSnapshotDto): Mission | undefined {
        if (!snapshot) {
            return undefined;
        }

        return new Mission(snapshot, async () => snapshot, this.missionCommands);
    }
}