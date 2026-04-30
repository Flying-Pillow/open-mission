import type {
    GitHubIssueDetailType,
    MissionReferenceType,
    RepositoryDataType,
    RepositoryPlatformRepositoryType,
    RepositorySnapshotType,
    TrackedIssueSummaryType
} from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { AgentSessionSnapshot, AgentSessionTerminalSnapshot } from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import type { MissionSnapshot, MissionTerminalSnapshot } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { MissionStageId, MissionTowerTreeNode, OperatorActionDescriptor, OperatorActionExecutionStep, OperatorActionFlowStep, OperatorActionListSnapshot, OperatorActionQueryContext, OperatorActionTargetContext, OperatorStatus } from '@flying-pillow/mission-core/types';
import type { AirportRuntimeEventEnvelope } from "$lib/contracts/runtime-events";

export type SidebarRepositoryData = RepositoryDataType & {
    missions?: MissionReferenceType[];
};
export type AirportRepositoryListItem = {
    key: string;
    local?: SidebarRepositoryData;
    github?: RepositoryPlatformRepositoryType;
    displayName: string;
    displayDescription: string;
    repositoryRootPath?: string;
    platformRepositoryRef?: string;
    missions: MissionReferenceType[];
    isLocal: boolean;
};
export type MissionSessionSummary = AgentSessionSnapshot;
export type MissionRuntimeEventEnvelope = AirportRuntimeEventEnvelope;
export type MissionSessionTerminalSnapshotData = AgentSessionTerminalSnapshot;
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

export type {
    GitHubIssueDetailType,
    MissionReferenceType,
    RepositoryDataType,
    RepositoryPlatformRepositoryType,
    RepositorySnapshotType,
    TrackedIssueSummaryType,
    AgentSessionSnapshot,
    MissionSnapshot
};
