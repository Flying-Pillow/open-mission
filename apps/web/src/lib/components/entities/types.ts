import type {
    RepositoryIssueDetailType,
    RepositoryPlatformRepositoryType,
    RepositoryType,
    TrackedIssueSummaryType
} from '@flying-pillow/open-mission-core/entities/Repository/RepositorySchema';
import type { MissionCatalogEntryType } from '@flying-pillow/open-mission-core/entities/Mission/MissionSchema';
import type { AgentExecutionDataType } from '@flying-pillow/open-mission-core/entities/AgentExecution/AgentExecutionSchema';
import type { MissionType } from '@flying-pillow/open-mission-core/entities/Mission/MissionSchema';

export type SidebarRepositoryData = RepositoryType & {
    missions?: MissionCatalogEntryType[];
};
export type AppRepositoryListItem = {
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
    RepositoryType,
    TrackedIssueSummaryType,
    AgentExecutionDataType,
    MissionType
};
