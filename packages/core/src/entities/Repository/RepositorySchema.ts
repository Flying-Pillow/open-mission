import { z } from 'zod/v4';
import { field, table } from '@flying-pillow/zod-surreal';
import { WorkflowDefinitionSchema } from '../../workflow/WorkflowSchema.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';
import { parsePersistedWorkflowSettings } from '../../settings/validation.js';
import {
    MissionAssigneeSchema,
    MissionTypeSchema,
} from '../Mission/MissionSchema.js';
import {
    AgentExecutionLaunchModeSchema,
    AgentExecutionReasoningEffortSchema
} from '../AgentExecution/AgentExecutionSchema.js';
import { AgentOwnerSettingsSchema } from '../Agent/AgentSchema.js';
import {
    EntityCommandAcknowledgementSchema,
    EntityStorageSchema,
    EntityIdSchema,
    SelectSchema
} from '../Entity/EntitySchema.js';
import {
    createDefaultSystemAgentSettings,
    SystemAgentSettingsSchema
} from '../System/SystemSchema.js';
import { CodeGraphSnapshotSchema } from '../CodeGraphSnapshot/CodeGraphSnapshotSchema.js';

export const RepositoryWorkflowConfigurationSchema = z.preprocess((input) => {
    try {
        return parsePersistedWorkflowSettings(input);
    } catch {
        return input;
    }
}, WorkflowDefinitionSchema).meta({
    description: 'Repository-owned workflow definition used as the default Mission workflow configuration.'
});

export const repositoryEntityName = 'Repository' as const;
export const repositoryTableName = 'repository' as const;
export const RepositoryPlatformKindSchema = z.enum(['github']).meta({
    description: 'Supported hosted repository platform kind for Repository discovery and provisioning.'
});

const defaultMissionsRoot = 'missions';
const repositoryTextSchema = z.string().trim().min(1);
const repositoryOptionalTextSchema = repositoryTextSchema.optional();
const repositoryUrlSchema = z.string().trim().url();

function describedText(description: string) {
    return repositoryTextSchema.meta({ description });
}

function describedOptionalText(description: string) {
    return repositoryOptionalTextSchema.meta({ description });
}

function describedOptionalUrl(description: string) {
    return repositoryUrlSchema.optional().meta({ description });
}

function describedNullableOptionalUrl(description: string) {
    return repositoryUrlSchema.nullable().optional().meta({ description });
}

function storedText(description: string) {
    return describedText(description).register(field, { description });
}

export const RepositoryPlatformRepositorySchema = z.object({
    platform: RepositoryPlatformKindSchema.meta({
        description: 'Hosted platform that reported this available repository.'
    }),
    repositoryRef: describedText('Hosted platform repository ref, such as a GitHub repository ref.'),
    name: describedText('Repository name reported by the hosted platform.'),
    description: z.string().nullable().optional().meta({
        description: 'Optional hosted repository description.'
    }),
    topics: z.array(describedText('Topic attached to the hosted repository.')).meta({
        description: 'Topics reported for the hosted repository.'
    }),
    homepageUrl: describedNullableOptionalUrl('Optional homepage URL reported by the hosted repository.'),
    license: z.object({
        key: describedOptionalText('Optional hosted license key.'),
        name: describedOptionalText('Optional hosted license name.'),
        spdxId: describedOptionalText('Optional SPDX license id reported by the hosted repository.'),
        url: describedNullableOptionalUrl('Optional hosted license URL.')
    }).strict().nullable().optional().meta({
        description: 'Optional hosted license summary for the repository.'
    }),
    ownerLogin: describedOptionalText('Optional owner login reported by the hosted repository.'),
    ownerType: describedOptionalText('Optional owner type reported by the hosted repository.'),
    ownerUrl: describedOptionalUrl('Optional owner profile URL reported by the hosted repository.'),
    htmlUrl: describedOptionalUrl('Optional canonical hosted repository URL.'),
    visibility: z.enum(['private', 'public', 'internal']).meta({
        description: 'Hosted repository visibility reported by the platform.'
    }),
    defaultBranch: describedOptionalText('Optional default branch name reported by the hosted repository.'),
    archived: z.boolean().meta({
        description: 'Whether the hosted repository is archived.'
    }),
    starsCount: z.number().int().nonnegative().optional().meta({ description: 'Optional hosted star count.' }),
    forksCount: z.number().int().nonnegative().optional().meta({ description: 'Optional hosted fork count.' }),
    watchersCount: z.number().int().nonnegative().optional().meta({ description: 'Optional hosted watcher count.' }),
    subscribersCount: z.number().int().nonnegative().optional().meta({ description: 'Optional hosted subscriber count.' }),
    openIssuesCount: z.number().int().nonnegative().optional().meta({ description: 'Optional open issue count reported by the platform.' }),
    openPullRequestsCount: z.number().int().nonnegative().optional().meta({ description: 'Optional open pull request count reported by the platform.' }),
    closedIssuesCount: z.number().int().nonnegative().optional().meta({ description: 'Optional closed issue count reported by the platform.' }),
    commitsCount: z.number().int().nonnegative().optional().meta({ description: 'Optional commit count reported by the platform.' }),
    releasesCount: z.number().int().nonnegative().optional().meta({ description: 'Optional release count reported by the platform.' }),
    workflowRunsCount: z.number().int().nonnegative().optional().meta({ description: 'Optional workflow run count reported by the platform.' }),
    createdAt: describedOptionalText('Optional hosted repository creation timestamp.'),
    updatedAt: describedOptionalText('Optional hosted repository update timestamp.'),
    pushedAt: describedOptionalText('Optional hosted repository last-push timestamp.')
}).strict().meta({
    description: 'Hosted repository summary returned by Repository discovery commands.'
});

export const RepositoryPlatformOwnerSchema = z.object({
    platform: RepositoryPlatformKindSchema.meta({
        description: 'Hosted platform that reported this owner.'
    }),
    login: describedText('Hosted owner login used to scope repository discovery and creation.'),
    type: z.enum(['User', 'Organization']).meta({
        description: 'Hosted owner type returned by the repository platform.'
    }),
    displayName: describedOptionalText('Optional owner display name reported by the repository platform.'),
    url: describedOptionalUrl('Optional owner profile URL reported by the repository platform.'),
    avatarUrl: describedOptionalUrl('Optional owner avatar URL reported by the repository platform.')
}).strict().meta({
    description: 'Hosted repository owner summary returned by Repository discovery commands.'
});

export const RepositoryIconSchema = z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/iu,
        'Repository icon must be an Iconify id like "lucide:folder-git-2".'
    ).meta({
        description: 'Operator-facing Repository icon identifier in Iconify format.'
    });

export const RepositorySettingsSchema = z.object({
    missionsRoot: describedText('Repository-owned missions root path relative to the Repository root or workspace root.'),
    trackingProvider: z.literal('github').meta({
        description: 'Hosted provider used to track the Repository in the current implementation wave.'
    }),
    instructionsPath: describedText('Repository-relative path to Repository-owned agent instructions.'),
    skillsPath: describedText('Repository-relative path to Repository-owned skills.'),
    icon: RepositoryIconSchema.optional().meta({
        description: 'Optional operator-facing icon stored in the Repository settings document.'
    }),
    agentAdapter: SystemAgentSettingsSchema.shape.defaultAgentAdapter.meta({
        description: 'Default Agent adapter selected for Repository-scoped work.'
    }),
    enabledAgentAdapters: SystemAgentSettingsSchema.shape.enabledAgentAdapters.meta({
        description: 'Agent adapters enabled for Repository-scoped work.'
    }),
    defaultAgentMode: AgentExecutionLaunchModeSchema.optional().meta({
        description: 'Optional default AgentExecution launch mode for Repository-scoped work.'
    }),
    defaultModel: describedOptionalText('Optional default model name for Repository-scoped Agent launches.'),
    defaultReasoningEffort: AgentExecutionReasoningEffortSchema.optional().meta({
        description: 'Optional default reasoning effort for Repository-scoped Agent launches.'
    })
}).strict().meta({
    description: 'Repository settings document stored under .open-mission/settings.json.'
});

export const RepositoryOperationalModeSchema = z.enum(['setup', 'repository', 'invalid']).meta({
    description: 'Current Repository operating mode derived from Repository control state.'
});

export const RepositoryCheckoutStateSchema = z.enum(['checked-out', 'not-found']).meta({
    description: 'Derived checkout presence for the Repository root on the local filesystem.'
});

export const RepositoryInvalidStateSchema = z.object({
    code: z.enum(['invalid-settings-document', 'invalid-workflow-definition']).meta({
        description: 'Classifier for a recoverable invalid Repository control-state condition.'
    }),
    path: describedText('Filesystem path where the invalid Repository control-state document was detected.'),
    message: describedText('Operator-facing explanation of the invalid Repository control-state condition.')
}).strict().meta({
    description: 'Recoverable invalid Repository control-state summary.'
});

const defaultSystemAgentSettings = createDefaultSystemAgentSettings();

export const DEFAULT_REPOSITORY_AGENT_ADAPTER_ID = defaultSystemAgentSettings.defaultAgentAdapter;

const defaultRepositorySettings: RepositorySettingsType = {
    missionsRoot: defaultMissionsRoot,
    trackingProvider: 'github',
    instructionsPath: '.agents',
    skillsPath: '.agents/skills',
    agentAdapter: DEFAULT_REPOSITORY_AGENT_ADAPTER_ID,
    enabledAgentAdapters: defaultSystemAgentSettings.enabledAgentAdapters
}

export function createDefaultRepositorySettings(): RepositorySettingsType {
    return structuredClone(defaultRepositorySettings);
}

export const RepositoryInputSchema = z.object({
    repositoryRootPath: describedText('Filesystem root path of the checked-out Repository.'),
    platformRepositoryRef: describedOptionalText('Optional hosted repository ref associated with the checked-out Repository.'),
    settings: RepositorySettingsSchema.optional().meta({
        description: 'Optional hydrated Repository settings supplied during Repository creation or rehydration.'
    }),
    workflowConfiguration: RepositoryWorkflowConfigurationSchema.optional().meta({
        description: 'Optional hydrated Repository workflow configuration supplied during Repository creation or rehydration.'
    }),
    isInitialized: z.boolean().optional().meta({
        description: 'Optional hydrated Repository initialization flag supplied during Repository creation or rehydration.'
    })
}).strict().meta({
    description: 'Input used to create or hydrate a Repository Entity instance.'
});

export const RepositoryStorageSchema = EntityStorageSchema.extend({
    id: EntityIdSchema.clone().meta({
        description: 'Canonical Entity id for the Repository storage record.'
    }).register(field, {
        description: 'Canonical Entity id for the Repository storage record.'
    }),
    repositoryRootPath: RepositoryInputSchema.shape.repositoryRootPath.meta({
        description: 'Filesystem root path of the checked-out Repository.'
    }).register(field, {
        description: 'Filesystem root path of the checked-out Repository.'
    }),
    platformRepositoryRef: RepositoryInputSchema.shape.platformRepositoryRef.meta({
        description: 'Optional hosted repository ref associated with this local Repository.'
    }).register(field, {
        optional: true,
        description: 'Optional hosted repository ref associated with this local Repository.'
    }),
    ownerId: storedText('Owner segment derived from the platform repository ref or local Repository identity.'),
    repoName: storedText('Repository name segment derived from the local or hosted Repository identity.')
}).strict().meta({
    description: 'Canonical persisted Repository storage record.'
}).register(table, {
    table: repositoryTableName,
    schemafull: true,
    description: 'Canonical Repository storage records.',
    indexes: [
        {
            name: 'repository_root_path_idx',
            fields: ['repositoryRootPath'],
            unique: true
        }
    ]
});


export const RepositoryLocatorSchema = z.object({
    id: EntityIdSchema.meta({
        description: 'Canonical Repository Entity id used to resolve one Repository.'
    }),
    repositoryRootPath: describedOptionalText('Optional Repository root path accepted only for compatibility-era direct callers.')
}).strict().meta({
    description: 'Compatibility locator for direct in-process Repository resolution.'
});

export const RepositoryInstanceInputSchema = z.object({}).strict().meta({
    description: 'Empty payload for Repository instance methods addressed only by canonical transport id.'
});

export const RepositoryFindSchema = z.object({
    select: SelectSchema.optional().meta({
        description: 'Optional persisted Repository selection used to filter stored Repository records.'
    })
}).strict().meta({
    description: 'Class-level query payload for listing persisted Repository entities, optionally filtered by a Select query.'
});

export const RepositoryFindAvailableSchema = z.object({
    platform: RepositoryPlatformKindSchema.optional().meta({
        description: 'Optional hosted platform filter for available repository discovery.'
    })
}).strict().meta({
    description: 'Class-level query payload for hosted repository discovery.'
});

export const RepositoryFindAvailableOwnersSchema = z.object({
    platform: RepositoryPlatformKindSchema.optional().meta({
        description: 'Optional hosted platform filter for available owner discovery.'
    })
}).strict().meta({
    description: 'Class-level query payload for hosted repository owner discovery.'
});

export const RepositoryEnsureSystemAgentExecutionSchema = z.object({}).strict().meta({
    description: 'Empty payload for ensuring the system-scoped repositories manager AgentExecution.'
});

export const RepositoryClassCommandsSchema = z.object({
    commandInput: z.unknown().optional().meta({
        description: 'Optional class-command availability context forwarded to Repository command descriptor generation.'
    })
}).strict().meta({
    description: 'Class-level query payload for Repository command descriptor generation.'
});

export const RepositoryLocalAddInputSchema = z.object({
    repositoryPath: describedText('Filesystem path of the local Repository to add to Open Mission.')
}).strict().meta({
    description: 'Payload for adding an already checked-out local Repository.'
});

export const RepositoryPlatformCheckoutInputSchema = z.object({
    platform: z.literal('github').meta({
        description: 'Hosted platform used for Repository checkout.'
    }),
    repositoryRef: describedText('Hosted repository ref to clone into the local workspace.'),
    destinationPath: describedText('Filesystem destination path where the Repository should be checked out.')
}).strict().meta({
    description: 'Payload for checking out a hosted Repository into the local workspace.'
});

export const RepositoryPlatformCreateInputSchema = z.object({
    platform: z.literal('github').meta({
        description: 'Hosted platform used for Repository creation.'
    }),
    ownerLogin: describedText('Hosted owner login under which the Repository should be created.'),
    repositoryName: describedText('Repository name to create on the hosted platform.'),
    destinationPath: describedText('Filesystem destination path where the new Repository should be checked out.'),
    visibility: RepositoryPlatformRepositorySchema.shape.visibility.default('private').meta({
        description: 'Hosted visibility for the newly created Repository.'
    })
}).strict().meta({
    description: 'Payload for creating a hosted Repository and checking it out locally.'
});

export const RepositoryAddSchema = z.union([
    RepositoryLocalAddInputSchema,
    RepositoryPlatformCheckoutInputSchema
]).meta({
    description: 'Class-level mutation payload for adding a local Repository or checking out a hosted Repository.'
});

export const RepositoryCreateSchema = RepositoryPlatformCreateInputSchema.meta({
    description: 'Class-level mutation payload for creating and checking out a hosted Repository.'
});

export const RepositoryGetIssueSchema = z.object({
    issueNumber: z.coerce.number().int().positive().meta({
        description: 'GitHub issue number to read from the Repository platform ref.'
    })
}).strict().meta({
    description: 'Instance query payload for reading one Repository issue.'
});

export const RepositoryReadRemovalSummarySchema = RepositoryInstanceInputSchema.meta({
    description: 'Empty payload for reading the Repository removal summary.'
});

export const RepositoryReadCodeGraphSnapshotSchema = RepositoryInstanceInputSchema.meta({
    description: 'Empty payload for reading the active Repository code graph snapshot.'
});

export const RepositoryCodeGraphSnapshotSchema = CodeGraphSnapshotSchema.nullable().meta({
    description: 'Current Repository code graph snapshot, or null when no active snapshot is available.'
});

export const RepositoryWorktreeStatusSchema = z.object({
    clean: z.boolean().meta({ description: 'Whether the Git worktree is clean.' }),
    stagedCount: z.number().int().nonnegative().meta({ description: 'Number of staged file changes in the Git worktree.' }),
    unstagedCount: z.number().int().nonnegative().meta({ description: 'Number of unstaged file changes in the Git worktree.' }),
    untrackedCount: z.number().int().nonnegative().meta({ description: 'Number of untracked files in the Git worktree.' })
}).strict().meta({
    description: 'Git worktree cleanliness summary for a Repository root or Mission worktree.'
});

export const RepositorySyncStatusSchema = z.object({
    id: EntityIdSchema,
    repositoryRootPath: z.string().trim().min(1),
    checkedAt: z.string().trim().min(1),
    platform: RepositoryPlatformKindSchema.optional(),
    platformRepositoryRef: z.string().trim().min(1).optional(),
    remoteName: z.string().trim().min(1).optional(),
    branchRef: z.string().trim().min(1).optional(),
    defaultBranch: z.string().trim().min(1).optional(),
    worktree: RepositoryWorktreeStatusSchema,
    external: z.object({
        trackingRef: z.string().trim().min(1).optional(),
        status: z.enum(['up-to-date', 'behind', 'ahead', 'diverged', 'untracked', 'unavailable']),
        aheadCount: z.number().int().nonnegative(),
        behindCount: z.number().int().nonnegative(),
        localHead: z.string().trim().min(1).optional(),
        remoteHead: z.string().trim().min(1).optional(),
        unavailableReason: z.string().trim().min(1).optional()
    }).strict()
}).strict().meta({
    description: 'Repository sync status read model for local and external branch state.'
});

export const RepositoryRemovalSummaryMissionSchema = z.object({
    missionId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    branchRef: z.string().trim().min(1),
    createdAt: z.string().trim().min(1),
    issueId: z.number().int().positive().optional(),
    lifecycle: z.string().trim().min(1),
    currentStageId: z.string().trim().min(1).optional(),
    activeAgentExecutionCount: z.number().int().nonnegative(),
    missionRootPath: z.string().trim().min(1),
    missionWorktreePath: z.string().trim().min(1),
    worktree: RepositoryWorktreeStatusSchema
}).strict().meta({
    description: 'Mission-level entry included in the Repository removal summary.'
});

export const RepositoryRemovalSummarySchema = z.object({
    id: EntityIdSchema,
    repositoryRootPath: z.string().trim().min(1),
    missionWorktreesPath: z.string().trim().min(1),
    hasExternalMissionWorktrees: z.boolean(),
    repositoryWorktree: RepositoryWorktreeStatusSchema,
    missionCount: z.number().int().nonnegative(),
    dirtyMissionCount: z.number().int().nonnegative(),
    missionsWithActiveAgentExecutionsCount: z.number().int().nonnegative(),
    activeAgentExecutionCount: z.number().int().nonnegative(),
    missions: z.array(RepositoryRemovalSummaryMissionSchema)
}).strict().meta({
    description: 'Repository removal summary read model used before deleting a Repository and its Mission worktrees.'
});

export const RepositorySyncCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(repositoryEntityName),
    method: z.enum(['fetchExternalState', 'fastForwardFromExternal']),
    id: z.string().trim().min(1),
    syncStatus: RepositorySyncStatusSchema
}).strict().meta({
    description: 'Acknowledgement returned after Repository sync commands that also report refreshed sync status.'
});

export const RepositoryCodeIndexAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(repositoryEntityName),
    method: z.literal('indexCode'),
    id: z.string().trim().min(1),
    snapshotId: z.string().trim().min(1),
    indexedAt: z.string().trim().min(1),
    fileCount: z.number().int().nonnegative(),
    symbolCount: z.number().int().nonnegative(),
    relationCount: z.number().int().nonnegative()
}).strict().meta({
    description: 'Acknowledgement returned after building a Repository code graph snapshot.'
});

export const MissionFromIssueInputSchema = z.object({
    issueNumber: z.coerce.number().int().positive().meta({
        description: 'GitHub issue number to convert into a Mission brief.'
    })
}).strict().meta({
    description: 'Mission-start payload fields derived from a Repository issue.'
});

export const MissionFromBriefInputSchema = z.object({
    title: describedText('Mission title supplied by the operator.'),
    body: describedText('Mission brief body supplied by the operator.'),
    type: MissionTypeSchema.meta({
        description: 'Mission type selected for the new Mission.'
    }),
    assignee: MissionAssigneeSchema.optional().meta({
        description: 'Optional Mission assignee to attach to the new Mission brief.'
    })
}).strict().meta({
    description: 'Mission-start payload fields supplied directly by the operator.'
});

export const RepositoryStartMissionFromIssueSchema = MissionFromIssueInputSchema.extend({
    ...MissionFromIssueInputSchema.shape
}).strict().meta({
    description: 'Instance mutation payload for starting a Mission from a Repository issue.'
});

export const RepositoryStartMissionFromBriefSchema = MissionFromBriefInputSchema.extend({
    ...MissionFromBriefInputSchema.shape
}).strict().meta({
    description: 'Instance mutation payload for starting a Mission from an operator-written brief.'
});

export const RepositorySetupSchema = z.object({
    settings: RepositorySettingsSchema.meta({
        description: 'Repository settings to scaffold into the Repository setup proposal.'
    })
}).strict().meta({
    description: 'Instance mutation payload for Repository setup scaffolding.'
});

export const RepositoryConfigureAgentsSchema = z.object({
    defaultAgentAdapter: SystemAgentSettingsSchema.shape.defaultAgentAdapter,
    enabledAgentAdapters: SystemAgentSettingsSchema.shape.enabledAgentAdapters,
    defaultAgentMode: SystemAgentSettingsSchema.shape.defaultAgentMode,
    defaultModel: SystemAgentSettingsSchema.shape.defaultModel,
    defaultReasoningEffort: SystemAgentSettingsSchema.shape.defaultReasoningEffort
}).strict().meta({
    description: 'Instance mutation payload for configuring Repository-owned agent defaults and enabled adapters.'
});

export const RepositoryConfigureAgentSchema = z.object(AgentOwnerSettingsSchema.shape).strict().meta({
    description: 'Instance mutation payload for Repository-owned agent settings.'
});

export const RepositoryConfigureDisplaySchema = z.object({
    icon: RepositoryIconSchema.nullable().meta({
        description: 'Optional operator-facing Repository icon stored in the settings document.'
    })
}).strict().meta({
    description: 'Instance mutation payload for Repository display settings.'
});

export const RepositoryInitializeSchema = RepositoryInstanceInputSchema.meta({
    description: 'Empty payload for initializing Repository control state.'
});

export const TrackedIssueSummarySchema = z.object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1),
    url: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1).optional(),
    labels: z.array(z.string()),
    assignees: z.array(z.string())
}).strict().meta({
    description: 'Tracked issue summary returned by Repository issue listing queries.'
});

export const RepositoryIssueDetailSchema = z.object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1),
    body: z.string(),
    url: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    labels: z.array(z.string()),
    assignees: z.array(z.string())
}).strict().meta({
    description: 'Detailed Repository issue read model returned by Repository issue lookup queries.'
});

export const RepositorySchema = RepositoryStorageSchema.extend({
    settings: RepositorySettingsSchema,
    workflowConfiguration: RepositoryWorkflowConfigurationSchema,
    isInitialized: z.boolean(),
    checkoutState: RepositoryCheckoutStateSchema.optional(),
    operationalMode: RepositoryOperationalModeSchema.optional(),
    invalidState: RepositoryInvalidStateSchema.optional(),
    currentBranch: z.string().trim().min(1).optional()
}).strict().meta({
    description: 'Complete hydrated Repository Entity returned by the Repository boundary.'
});

export const RepositoryMissionStartMethodSchema = z.enum([
    'startMissionFromIssue',
    'startMissionFromBrief'
]).meta({
    description: 'Repository mutation method that started the Mission.'
});

export const RepositoryMissionStartAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(repositoryEntityName),
    method: RepositoryMissionStartMethodSchema,
    id: z.string().trim().min(1)
}).strict().meta({
    description: 'Acknowledgement returned after a Repository command prepares and starts a Mission.'
});

export const RepositoryRemoveAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(repositoryEntityName),
    method: z.literal('remove'),
    id: z.string().trim().min(1)
}).strict().meta({
    description: 'Acknowledgement returned after removing a Repository and its local files.'
});

export const RepositorySetupResultSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(repositoryEntityName),
    method: z.literal('setup'),
    id: z.string().trim().min(1),
    kind: z.literal('repository-setup'),
    state: z.enum(['pull-request-opened', 'auto-merge-requested', 'merged']),
    branchRef: z.string().trim().min(1),
    baseBranch: z.string().trim().min(1),
    pullRequestUrl: z.string().trim().min(1),
    settingsPath: z.string().trim().min(1),
    workflowDefinitionPath: z.string().trim().min(1),
    autoMergeAttempted: z.boolean(),
    autoMergeSucceeded: z.boolean(),
    merged: z.boolean(),
    basePulled: z.boolean(),
    basePullError: z.string().trim().min(1).optional(),
    autoMergeError: z.string().trim().min(1).optional()
}).strict().meta({
    description: 'Acknowledgement returned after opening or completing Repository setup.'
});

export const RepositoryInitializeResultSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(repositoryEntityName),
    method: z.literal('initialize'),
    id: z.string().trim().min(1),
    state: z.enum(['initialized', 'already-initialized', 'skipped-invalid-settings']),
    settingsPath: z.string().trim().min(1).optional(),
    defaultAgentAdapter: SystemAgentSettingsSchema.shape.defaultAgentAdapter.optional(),
    enabledAgentAdapters: SystemAgentSettingsSchema.shape.enabledAgentAdapters
}).strict().meta({
    description: 'Acknowledgement returned after initializing Repository control state.'
});

export type RepositoryInputType = z.infer<typeof RepositoryInputSchema>;
export type RepositoryStorageType = z.infer<typeof RepositoryStorageSchema>;
export type RepositoryPlatformKindType = z.infer<typeof RepositoryPlatformKindSchema>;
export type RepositoryPlatformRepositoryType = z.infer<typeof RepositoryPlatformRepositorySchema>;
export type RepositoryPlatformOwnerType = z.infer<typeof RepositoryPlatformOwnerSchema>;
export type RepositoryFindType = z.infer<typeof RepositoryFindSchema>;
export type RepositoryFindAvailableType = z.infer<typeof RepositoryFindAvailableSchema>;
export type RepositoryFindAvailableOwnersType = z.infer<typeof RepositoryFindAvailableOwnersSchema>;
export type RepositoryEnsureSystemAgentExecutionType = z.infer<typeof RepositoryEnsureSystemAgentExecutionSchema>;
export type RepositoryClassCommandsType = z.infer<typeof RepositoryClassCommandsSchema>;
export type RepositoryAddType = z.infer<typeof RepositoryAddSchema>;
export type RepositoryCreateType = z.infer<typeof RepositoryCreateSchema>;
export type RepositoryLocatorType = z.infer<typeof RepositoryLocatorSchema>;
export type RepositoryInstanceInputType = z.infer<typeof RepositoryInstanceInputSchema>;
export type RepositoryGetIssueType = z.infer<typeof RepositoryGetIssueSchema>;
export type RepositoryReadRemovalSummaryType = z.infer<typeof RepositoryReadRemovalSummarySchema>;
export type RepositoryReadCodeGraphSnapshotType = z.infer<typeof RepositoryReadCodeGraphSnapshotSchema>;
export type RepositoryCodeGraphSnapshotType = z.infer<typeof RepositoryCodeGraphSnapshotSchema>;
export type RepositorySyncStatusType = z.infer<typeof RepositorySyncStatusSchema>;
export type RepositoryWorktreeStatusType = z.infer<typeof RepositoryWorktreeStatusSchema>;
export type RepositoryRemovalSummaryMissionType = z.infer<typeof RepositoryRemovalSummaryMissionSchema>;
export type RepositoryRemovalSummaryType = z.infer<typeof RepositoryRemovalSummarySchema>;
export type RepositorySyncCommandAcknowledgementType = z.infer<typeof RepositorySyncCommandAcknowledgementSchema>;
export type RepositoryCodeIndexAcknowledgementType = z.infer<typeof RepositoryCodeIndexAcknowledgementSchema>;
export type RepositoryStartMissionFromIssueType = z.infer<typeof RepositoryStartMissionFromIssueSchema>;
export type RepositoryStartMissionFromBriefType = z.infer<typeof RepositoryStartMissionFromBriefSchema>;
export type RepositorySetupType = z.infer<typeof RepositorySetupSchema>;
export type RepositoryConfigureAgentsType = z.infer<typeof RepositoryConfigureAgentsSchema>;
export type RepositoryConfigureAgentType = z.infer<typeof RepositoryConfigureAgentSchema>;
export type RepositoryConfigureDisplayType = z.infer<typeof RepositoryConfigureDisplaySchema>;
export type RepositoryInitializeType = z.infer<typeof RepositoryInitializeSchema>;
export type RepositoryOperationalModeType = z.infer<typeof RepositoryOperationalModeSchema>;
export type RepositoryCheckoutStateType = z.infer<typeof RepositoryCheckoutStateSchema>;
export type RepositoryInvalidStateType = z.infer<typeof RepositoryInvalidStateSchema>;
export type RepositoryType = z.infer<typeof RepositorySchema>;
export type RepositoryIssueDetailType = z.infer<typeof RepositoryIssueDetailSchema>;
export type TrackedIssueSummaryType = z.infer<typeof TrackedIssueSummarySchema>;
export type RepositoryMissionStartAcknowledgementType = z.infer<typeof RepositoryMissionStartAcknowledgementSchema>;
export type RepositoryRemoveAcknowledgementType = z.infer<typeof RepositoryRemoveAcknowledgementSchema>;
export type RepositorySetupResultType = z.infer<typeof RepositorySetupResultSchema>;
export type RepositoryInitializeResultType = z.infer<typeof RepositoryInitializeResultSchema>;
export type RepositorySettingsType = z.infer<typeof RepositorySettingsSchema>;

export function createDefaultRepositoryConfiguration(): Pick<RepositoryType, 'settings' | 'workflowConfiguration' | 'isInitialized'> {
    const settings = createDefaultRepositorySettings();
    return {
        settings,
        workflowConfiguration: createDefaultWorkflowSettings(),
        isInitialized: false
    };
}
