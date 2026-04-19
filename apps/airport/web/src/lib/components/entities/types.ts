import type {
    GitHubIssueDetailDto,
    MissionAgentSessionDto,
    MissionRuntimeSnapshotDto,
    MissionSelectionCandidateDto,
    RepositoryCandidateDto,
    RepositorySurfaceSnapshotDto,
    TrackedIssueSummaryDto,
} from "@flying-pillow/mission-core/airport/runtime";

export type RepositorySummary = RepositoryCandidateDto;
export type MissionSummary = MissionSelectionCandidateDto;
export type IssueSummary = TrackedIssueSummaryDto;
export type MissionSessionSummary = MissionAgentSessionDto;
export type SelectedMissionSummary = MissionRuntimeSnapshotDto;
export type SelectedIssueSummary = GitHubIssueDetailDto;
export type RepositorySurfaceData = RepositorySurfaceSnapshotDto;
