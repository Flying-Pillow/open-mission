import type {
    GitHubIssueDetailType,
    RepositoryStorageType,
    RepositoryPlatformRepositoryType,
    RepositoryDataType,
    TrackedIssueSummaryType
} from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { MissionCatalogEntryType } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { AgentSessionDataType, AgentSessionTerminalSnapshotType } from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import type { MissionRuntimeEventEnvelopeType, MissionSnapshotType, MissionTerminalSnapshotType } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { MissionStageId, MissionTowerTreeNode, OperatorActionDescriptor, OperatorActionExecutionStep, OperatorActionFlowStep, OperatorActionListSnapshot, OperatorActionQueryContext, OperatorActionTargetContext, OperatorStatus } from '@flying-pillow/mission-core/types';

export type SidebarRepositoryData = RepositoryStorageType & {
    missions?: MissionCatalogEntryType[];
};
export type AirportRepositoryListItem = {
    key: string;
    local?: SidebarRepositoryData;
    github?: RepositoryPlatformRepositoryType;
    displayName: string;
    displayDescription: string;
    repositoryRootPath?: string;
    platformRepositoryRef?: string;
    missions: MissionCatalogEntryType[];
    isLocal: boolean;
};
export type MissionSessionSummary = AgentSessionDataType;
export type MissionRuntimeEventEnvelope = MissionRuntimeEventEnvelopeType;
export type MissionSessionTerminalSnapshotData = AgentSessionTerminalSnapshotType;
export type MissionTerminalSnapshotData = MissionTerminalSnapshotType;
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
    MissionCatalogEntryType,
    RepositoryStorageType,
    RepositoryPlatformRepositoryType,
    RepositoryDataType,
    TrackedIssueSummaryType,
    AgentSessionDataType,
    MissionSnapshotType
};
