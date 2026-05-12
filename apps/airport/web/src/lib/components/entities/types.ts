import type {
    RepositoryIssueDetailType,
    RepositoryPlatformRepositoryType,
    RepositoryDataType,
    TrackedIssueSummaryType
} from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { MissionCatalogEntryType } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { AgentExecutionDataType } from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import type { MissionType } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';

export type SidebarRepositoryData = RepositoryDataType & {
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
export type {
    RepositoryIssueDetailType,
    MissionCatalogEntryType,
    RepositoryPlatformRepositoryType,
    RepositoryDataType,
    TrackedIssueSummaryType,
    AgentExecutionDataType,
    MissionType
};
