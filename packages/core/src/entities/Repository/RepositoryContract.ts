import { EntityCommandViewSchema, type EntityContractType } from '../Entity/EntitySchema.js';
import { Repository } from './Repository.js';
import {
    GitHubIssueDetailSchema,
    RepositoryAddSchema,
    RepositoryDataSchema,
    RepositoryInputSchema,
    RepositoryStorageSchema,
    RepositoryPlatformRepositorySchema,
    repositoryEntityName,
    RepositoryFindSchema,
    RepositoryFindAvailableSchema,
    RepositoryGetIssueSchema,
    RepositoryLocatorSchema,
    RepositoryMissionStartAcknowledgementSchema,
    RepositoryPrepareResultSchema,
    RepositoryRemoveAcknowledgementSchema,
    RepositoryStartMissionFromBriefSchema,
    RepositoryStartMissionFromIssueSchema,
    TrackedIssueSummarySchema
} from './RepositorySchema.js';

export const RepositoryContract: EntityContractType = {
    entity: repositoryEntityName,
    entityClass: Repository,
    inputSchema: RepositoryInputSchema,
    storageSchema: RepositoryStorageSchema,
    dataSchema: RepositoryDataSchema,
    properties: Object.fromEntries(
        Object.entries(RepositoryDataSchema.shape).map(([name, schema]) => [
            name,
            {
                schema,
                readonly: true
            }
        ])
    ),
    methods: {
        find: {
            kind: 'query',
            payload: RepositoryFindSchema,
            result: RepositoryDataSchema.array(),
            execution: 'class'
        },
        findAvailable: {
            kind: 'query',
            payload: RepositoryFindAvailableSchema,
            result: RepositoryPlatformRepositorySchema.array(),
            execution: 'class'
        },
        read: {
            kind: 'query',
            payload: RepositoryLocatorSchema,
            result: RepositoryDataSchema,
            execution: 'entity'
        },
        commands: {
            kind: 'query',
            payload: RepositoryLocatorSchema,
            result: EntityCommandViewSchema,
            execution: 'entity'
        },
        listIssues: {
            kind: 'query',
            payload: RepositoryLocatorSchema,
            result: TrackedIssueSummarySchema.array(),
            execution: 'entity'
        },
        getIssue: {
            kind: 'query',
            payload: RepositoryGetIssueSchema,
            result: GitHubIssueDetailSchema,
            execution: 'entity'
        },
        add: {
            kind: 'mutation',
            payload: RepositoryAddSchema,
            result: RepositoryDataSchema,
            execution: 'class',
            ui: {
                label: 'Add Repository',
                iconHint: 'folder-plus',
                presentationOrder: 0
            }
        },
        remove: {
            kind: 'mutation',
            payload: RepositoryLocatorSchema,
            result: RepositoryRemoveAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Remove Repository',
                variant: 'destructive',
                iconHint: 'trash-2',
                presentationOrder: 90
            }
        },
        prepare: {
            kind: 'mutation',
            payload: RepositoryLocatorSchema,
            result: RepositoryPrepareResultSchema,
            execution: 'entity',
            ui: {
                label: 'Prepare Repository',
                iconHint: 'git-pull-request-create',
                presentationOrder: 5
            }
        },
        startMissionFromIssue: {
            kind: 'mutation',
            payload: RepositoryStartMissionFromIssueSchema,
            result: RepositoryMissionStartAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Start Mission From Issue',
                iconHint: 'circle-play',
                presentationOrder: 10
            }
        },
        startMissionFromBrief: {
            kind: 'mutation',
            payload: RepositoryStartMissionFromBriefSchema,
            result: RepositoryMissionStartAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Start Mission From Brief',
                iconHint: 'file-plus-2',
                presentationOrder: 20
            }
        }
    },
    events: {
        missionStarted: {
            payload: RepositoryMissionStartAcknowledgementSchema
        }
    }
};