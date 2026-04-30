import type { EntityContractType } from '../Entity/EntitySchema.js';
import { Repository } from './Repository.js';
import {
    GitHubIssueDetailSchema,
    RepositoryAddPayloadSchema,
    RepositoryDataSchema,
    RepositoryPlatformRepositorySchema,
    repositoryEntityName,
    RepositoryFindPayloadSchema,
    RepositoryFindAvailablePayloadSchema,
    RepositoryGetIssuePayloadSchema,
    RepositoryListIssuesPayloadSchema,
    RepositoryMissionStartAcknowledgementSchema,
    RepositoryPreparePayloadSchema,
    RepositoryPrepareResultSchema,
    RepositoryRemoveAcknowledgementSchema,
    RepositoryRemovePayloadSchema,
    RepositoryReadPayloadSchema,
    RepositorySnapshotSchema,
    RepositoryStartMissionFromBriefPayloadSchema,
    RepositoryStartMissionFromIssuePayloadSchema,
    TrackedIssueSummarySchema
} from './RepositorySchema.js';

export const repositoryContract: EntityContractType = {
    entity: repositoryEntityName,
    entityClass: Repository,
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
            payload: RepositoryFindPayloadSchema,
            result: RepositorySnapshotSchema.array(),
            execution: 'class'
        },
        findAvailable: {
            kind: 'query',
            payload: RepositoryFindAvailablePayloadSchema,
            result: RepositoryPlatformRepositorySchema.array(),
            execution: 'class'
        },
        read: {
            kind: 'query',
            payload: RepositoryReadPayloadSchema,
            result: RepositorySnapshotSchema,
            execution: 'entity'
        },
        listIssues: {
            kind: 'query',
            payload: RepositoryListIssuesPayloadSchema,
            result: TrackedIssueSummarySchema.array(),
            execution: 'entity'
        },
        getIssue: {
            kind: 'query',
            payload: RepositoryGetIssuePayloadSchema,
            result: GitHubIssueDetailSchema,
            execution: 'entity'
        },
        add: {
            kind: 'mutation',
            payload: RepositoryAddPayloadSchema,
            result: RepositorySnapshotSchema,
            execution: 'class',
            ui: {
                label: 'Add Repository',
                iconHint: 'folder-plus',
                presentationOrder: 0
            }
        },
        remove: {
            kind: 'mutation',
            payload: RepositoryRemovePayloadSchema,
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
            payload: RepositoryPreparePayloadSchema,
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
            payload: RepositoryStartMissionFromIssuePayloadSchema,
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
            payload: RepositoryStartMissionFromBriefPayloadSchema,
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