import type {
    RepositoryIssueDetailType,
    RepositoryStorageType,
    RepositoryPlatformRepositoryType,
    RepositoryDataType,
    TrackedIssueSummaryType
} from '@flying-pillow/mission-core/entities/Repository/RepositorySchema';
import type { MissionCatalogEntryType } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import type { AgentSessionDataType } from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import type { MissionSnapshotType } from '@flying-pillow/mission-core/entities/Mission/MissionSchema';

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
export type {
    RepositoryIssueDetailType,
    MissionCatalogEntryType,
    RepositoryStorageType,
    RepositoryPlatformRepositoryType,
    RepositoryDataType,
    TrackedIssueSummaryType,
    AgentSessionDataType,
    MissionSnapshotType
};
