import { EntityClassCommandViewSchema, EntityCommandViewSchema, type EntityContractType } from '../Entity/EntitySchema.js';
import { AgentExecutionDataSchema } from '../AgentExecution/AgentExecutionSchema.js';
import { Repository } from './Repository.js';
import {
    RepositoryAddSchema,
    RepositoryDataSchema,
    RepositoryInputSchema,
    RepositoryStorageSchema,
    RepositoryPlatformRepositorySchema,
    repositoryEntityName,
    RepositoryFindSchema,
    RepositoryFindAvailableSchema,
    RepositoryClassCommandsSchema,
    RepositoryGetIssueSchema,
    RepositoryLocatorSchema,
    RepositoryMissionStartAcknowledgementSchema,
    RepositoryIssueDetailSchema,
    RepositoryRemoveAcknowledgementSchema,
    RepositoryPrepareResultSchema,
    RepositoryPrepareSchema,
    RepositorySetupResultSchema,
    RepositorySetupSchema,
    RepositorySyncCommandAcknowledgementSchema,
    RepositorySyncStatusSchema,
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
        classCommands: {
            kind: 'query',
            payload: RepositoryClassCommandsSchema,
            result: EntityClassCommandViewSchema,
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
        syncStatus: {
            kind: 'query',
            payload: RepositoryLocatorSchema,
            result: RepositorySyncStatusSchema,
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
            result: RepositoryIssueDetailSchema,
            execution: 'entity'
        },
        add: {
            kind: 'mutation',
            payload: RepositoryAddSchema,
            result: RepositoryDataSchema,
            execution: 'class',
            ui: {
                label: 'Clone',
                variant: 'default',
                icon: 'folder-plus',
                presentationOrder: 0
            }
        },
        remove: {
            kind: 'mutation',
            payload: RepositoryLocatorSchema,
            result: RepositoryRemoveAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Remove',
                variant: 'destructive',
                icon: 'trash-2',
                confirmation: {
                    required: true,
                    prompt: 'Remove this repository from Mission and delete its files from this computer? This cannot be undone.'
                },
                presentationOrder: 90
            }
        },
        setup: {
            kind: 'mutation',
            payload: RepositorySetupSchema,
            result: RepositorySetupResultSchema,
            execution: 'entity'
        },
        prepare: {
            kind: 'mutation',
            payload: RepositoryPrepareSchema,
            result: RepositoryPrepareResultSchema,
            execution: 'entity'
        },
        ensureSetupAgentExecution: {
            kind: 'mutation',
            payload: RepositoryPrepareSchema,
            result: AgentExecutionDataSchema,
            execution: 'entity'
        },
        fetchExternalState: {
            kind: 'mutation',
            payload: RepositoryLocatorSchema,
            result: RepositorySyncCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                variant: 'outline',
                label: 'Refresh',
                icon: 'refresh-cw',
                presentationOrder: 20
            }
        },
        fastForwardFromExternal: {
            kind: 'mutation',
            payload: RepositoryLocatorSchema,
            result: RepositorySyncCommandAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Pull from GitHub',
                description: 'Fast-forward this Repository from its GitHub tracking branch, preserving local changes with Git autostash.',
                variant: 'default',
                icon: 'git-pull-request-arrow',
                confirmation: {
                    required: true,
                    prompt: 'Pull changes from GitHub by fast-forwarding this Repository from its tracking branch? Local changes are preserved with Git autostash, and divergent local commits are not merged.'
                },
                presentationOrder: 25
            }
        },
        startMissionFromIssue: {
            kind: 'mutation',
            payload: RepositoryStartMissionFromIssueSchema,
            result: RepositoryMissionStartAcknowledgementSchema,
            execution: 'entity'
        },
        startMissionFromBrief: {
            kind: 'mutation',
            payload: RepositoryStartMissionFromBriefSchema,
            result: RepositoryMissionStartAcknowledgementSchema,
            execution: 'entity'
        }
    },
    events: {
        missionStarted: {
            payload: RepositoryMissionStartAcknowledgementSchema
        }
    }
};