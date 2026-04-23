import type {
    GitHubVisibleRepository,
    GitHubIssueDetail,
    AgentSession,
    MissionRuntimeSnapshot,
    MissionReference,
    Repository,
    RepositorySurfaceSnapshot,
    TrackedIssueSummary,
} from "@flying-pillow/mission-core/airport/runtime";

export type RepositorySummary = Repository;
export type GitHubVisibleRepositorySummary = GitHubVisibleRepository;
export type MissionSummary = MissionReference;
export type SidebarRepositorySummary = RepositorySummary & {
    missions?: MissionSummary[];
};
export type IssueSummary = TrackedIssueSummary;
export type MissionSessionSummary = AgentSession;
export type SelectedMissionSummary = MissionRuntimeSnapshot;
export type SelectedIssueSummary = GitHubIssueDetail;
export type RepositorySurfaceData = RepositorySurfaceSnapshot;
