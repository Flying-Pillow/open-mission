import { EntityClassCommandViewSchema, EntityCommandViewSchema, type EntityContractType } from '../Entity/EntitySchema.js';
import { AgentExecutionSchema } from '../AgentExecution/AgentExecutionSchema.js';
import { Repository } from './Repository.js';
import {
    RepositoryAddSchema,
    RepositoryCreateSchema,
    RepositoryInputSchema,
    RepositoryInstanceInputSchema,
    RepositorySchema,
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
    RepositoryCodeGraphSnapshotSchema,
    RepositoryReadCodeGraphSnapshotSchema,
    RepositoryReadRemovalSummarySchema,
    RepositoryMissionStartAcknowledgementSchema,
    RepositoryIssueDetailSchema,
    RepositoryConfigureAgentSchema,
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
    dataSchema: RepositorySchema,
    properties: Object.fromEntries(
        Object.entries(RepositorySchema.shape).map(([name, schema]) => [
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
            result: RepositorySchema.array(),
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
            result: AgentExecutionSchema,
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
            payload: RepositoryInstanceInputSchema,
            result: RepositorySchema,
            execution: 'entity'
        },
        commands: {
            kind: 'query',
            payload: RepositoryInstanceInputSchema,
            result: EntityCommandViewSchema,
            execution: 'entity'
        },
        syncStatus: {
            kind: 'query',
            payload: RepositoryInstanceInputSchema,
            result: RepositorySyncStatusSchema,
            execution: 'entity'
        },
        listIssues: {
            kind: 'query',
            payload: RepositoryInstanceInputSchema,
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
        readCodeGraphSnapshot: {
            kind: 'query',
            payload: RepositoryReadCodeGraphSnapshotSchema,
            result: RepositoryCodeGraphSnapshotSchema,
            execution: 'entity'
        },
        add: {
            kind: 'mutation',
            payload: RepositoryAddSchema,
            result: RepositorySchema,
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
            result: RepositorySchema,
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
            payload: RepositoryInstanceInputSchema,
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
            result: RepositorySchema,
            execution: 'entity'
        },
        configureAgent: {
            kind: 'mutation',
            payload: RepositoryConfigureAgentSchema,
            result: RepositorySchema,
            execution: 'entity'
        },
        configureDisplay: {
            kind: 'mutation',
            payload: RepositoryConfigureDisplaySchema,
            result: RepositorySchema,
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
            result: AgentExecutionSchema,
            execution: 'entity'
        },
        refreshRepositoryAgentExecution: {
            kind: 'mutation',
            payload: RepositoryInitializeSchema,
            result: AgentExecutionSchema,
            execution: 'entity'
        },
        fetchExternalState: {
            kind: 'mutation',
            payload: RepositoryInstanceInputSchema,
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
            payload: RepositoryInstanceInputSchema,
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
            payload: RepositoryInstanceInputSchema,
            result: RepositoryCodeIndexAcknowledgementSchema,
            execution: 'entity',
            ui: {
                label: 'Index code',
                description: 'Build a fresh code graph snapshot for this Repository.',
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
    }
};