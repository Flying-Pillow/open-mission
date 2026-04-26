import type {
    GitHubIssueDetail,
    AgentSession,
    AirportRuntimeEventEnvelope,
    MissionRuntimeSnapshot,
    MissionReference,
    MissionSessionTerminalSnapshot,
    MissionTerminalSnapshot,
    MissionStageId,
    MissionTowerTreeNode,
    OperatorActionDescriptor,
    OperatorActionExecutionStep,
    OperatorActionFlowStep,
    OperatorActionListSnapshot,
    OperatorActionQueryContext,
    OperatorActionTargetContext,
    OperatorStatus,
    Repository,
    RepositorySnapshot,
    TrackedIssueSummary,
} from "@flying-pillow/mission-core/schemas";
import type { GitHubVisibleRepository } from "@flying-pillow/mission-core/schemas";

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
export type RepositorySnapshotData = RepositorySnapshot;
export type MissionRuntimeEventEnvelope = AirportRuntimeEventEnvelope;
export type MissionSessionTerminalSnapshotData = MissionSessionTerminalSnapshot;
export type MissionTerminalSnapshotData = MissionTerminalSnapshot;
export type MissionStageIdData = MissionStageId;
export type MissionTowerTreeNodeData = MissionTowerTreeNode;
export type OperatorActionDescriptorData = OperatorActionDescriptor;
export type OperatorActionExecutionStepData = OperatorActionExecutionStep;
export type OperatorActionFlowStepData = OperatorActionFlowStep;
export type OperatorActionListSnapshotData = OperatorActionListSnapshot;
export type OperatorActionQueryContextData = OperatorActionQueryContext;
export type OperatorActionTargetContextData = OperatorActionTargetContext;
export type OperatorStatusData = OperatorStatus;
