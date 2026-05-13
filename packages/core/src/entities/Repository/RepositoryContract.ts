import { EntityClassCommandViewSchema, EntityCommandViewSchema, type EntityContractType } from '../Entity/EntitySchema.js';
import { AgentExecutionDataSchema } from '../AgentExecution/AgentExecutionSchema.js';
import { Repository } from './Repository.js';
import {
    RepositoryAddSchema,
    RepositoryCreateSchema,
    RepositoryDataSchema,
    RepositoryInputSchema,
    RepositoryStorageSchema,
    RepositoryPlatformOwnerSchema,
    RepositoryPlatformRepositorySchema,
    repositoryEntityName,
    RepositoryFindSchema,
    RepositoryFindAvailableSchema,
    RepositoryFindAvailableOwnersSchema,
    RepositoryEnsureSystemAgentExecutionSchema,
    RepositoryClassCommandsSchema,
    RepositoryGetIssueSchema,
    RepositoryLocatorSchema,
    RepositoryCodeIntelligenceIndexSchema,
    RepositoryReadCodeIntelligenceIndexSchema,
    RepositoryReadRemovalSummarySchema,
    RepositoryMissionStartAcknowledgementSchema,
    RepositoryIssueDetailSchema,
    RepositoryConfigureAgentsSchema,
    RepositoryConfigureDisplaySchema,
    RepositoryCodeIndexAcknowledgementSchema,
    RepositoryInitializeResultSchema,
    RepositoryInitializeSchema,
    RepositoryRemoveAcknowledgementSchema,
    RepositorySetupResultSchema,
    RepositorySetupSchema,
    RepositorySyncCommandAcknowledgementSchema,
    RepositorySyncStatusSchema,
    RepositoryRemovalSummarySchema,
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
        findAvailableOwners: {
            kind: 'query',
            payload: RepositoryFindAvailableOwnersSchema,
            result: RepositoryPlatformOwnerSchema.array(),
            execution: 'class'
        },
        ensureSystemAgentExecution: {
            kind: 'mutation',
            payload: RepositoryEnsureSystemAgentExecutionSchema,
            result: AgentExecutionDataSchema,
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
        readRemovalSummary: {
            kind: 'query',
            payload: RepositoryReadRemovalSummarySchema,
            result: RepositoryRemovalSummarySchema,
            execution: 'entity'
        },
        readCodeIntelligenceIndex: {
            kind: 'query',
            payload: RepositoryReadCodeIntelligenceIndexSchema,
            result: RepositoryCodeIntelligenceIndexSchema,
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
        createPlatformRepository: {
            kind: 'mutation',
            payload: RepositoryCreateSchema,
            result: RepositoryDataSchema,
            execution: 'class',
            ui: {
                label: 'Create repository',
                variant: 'default',
                icon: 'folder-plus',
                presentationOrder: 1
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
        configureAgents: {
            kind: 'mutation',
            payload: RepositoryConfigureAgentsSchema,
            result: RepositoryDataSchema,
            execution: 'entity'
        },
        configureDisplay: {
            kind: 'mutation',
            payload: RepositoryConfigureDisplaySchema,
            result: RepositoryDataSchema,
            execution: 'entity'
        },
        initialize: {
            kind: 'mutation',
            payload: RepositoryInitializeSchema,
            result: RepositoryInitializeResultSchema,
            execution: 'entity'
        },
        ensureRepositoryAgentExecution: {
            kind: 'mutation',
            payload: RepositoryInitializeSchema,
            result: AgentExecutionDataSchema,
            execution: 'entity'
        },
        refreshRepositoryAgentExecution: {
            kind: 'mutation',
            payload: RepositoryInitializeSchema,
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
        indexCode: {
            kind: 'mutation',
            payload: RepositoryLocatorSchema,
            result: RepositoryCodeIndexAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Index code',
                description: 'Build a fresh local code intelligence index for this Repository.',
                variant: 'outline',
                icon: 'database-zap',
                presentationOrder: 30
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