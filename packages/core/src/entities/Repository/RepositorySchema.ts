import { z } from 'zod/v4';
import { WorkflowDefinitionSchema } from '../../workflow/WorkflowSchema.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';
import { parsePersistedWorkflowSettings } from '../../settings/validation.js';
import {
    MissionDefaultAgentModeSchema,
    MissionReasoningEffortSchema,
    MissionEntityTypeSchema
} from '../Mission/MissionSchema.js';
import {
    AgentIdSchema
} from '../Agent/AgentSchema.js';
import {
    EntityCommandAcknowledgementSchema,
    EntityIdSchema
} from '../Entity/EntitySchema.js';

export const RepositoryWorkflowConfigurationSchema = z.preprocess((input) => {
    try {
        return parsePersistedWorkflowSettings(input);
    } catch {
        return input;
    }
}, WorkflowDefinitionSchema);

export const repositoryEntityName = 'Repository' as const;
export const RepositoryPlatformKindSchema = z.enum(['github']);

const defaultMissionsRoot = 'missions';
const defaultAgentId = 'copilot-cli';

export const RepositoryAgentAdapterModelOptionSchema = z.object({
    value: z.string().trim().min(1),
    label: z.string().trim().min(1)
}).strict();

export const RepositoryAgentAdapterSettingsSchema = z.object({
    id: AgentIdSchema,
    label: z.string().trim().min(1),
    models: z.array(RepositoryAgentAdapterModelOptionSchema),
    reasoningEfforts: z.array(MissionReasoningEffortSchema)
}).strict();

const defaultAgentAdapterSettings = [
    {
        id: 'copilot-cli',
        label: 'Copilot CLI',
        models: [],
        reasoningEfforts: []
    },
    {
        id: 'claude-code',
        label: 'Claude Code',
        models: [
            { value: 'claude-opus-4-7-20260501', label: 'Claude Opus 4.7' },
            { value: 'claude-sonnet-4-6-20260415', label: 'Claude Sonnet 4.6' },
            { value: 'claude-haiku-4-5-20260310', label: 'Claude Haiku 4.5' }
        ],
        reasoningEfforts: ['low', 'medium', 'high']
    },
    {
        id: 'pi',
        label: 'Pi',
        models: [
            { value: 'gpt-5.5', label: 'GPT-5.5' },
            { value: 'gpt-5.4', label: 'GPT-5.4' }
        ],
        reasoningEfforts: []
    },
    {
        id: 'codex',
        label: 'Codex',
        models: [
            { value: 'gpt-5.5', label: 'GPT-5.5' },
            { value: 'gpt-5.4', label: 'GPT-5.4' }
        ],
        reasoningEfforts: ['low', 'medium', 'high', 'xhigh']
    },
    {
        id: 'opencode',
        label: 'OpenCode',
        models: [
            { value: 'openai/gpt-5.5', label: 'OpenAI GPT-5.5' },
            { value: 'openai/gpt-5.4', label: 'OpenAI GPT-5.4' }
        ],
        reasoningEfforts: []
    }
] as const satisfies readonly RepositoryAgentAdapterSettingsType[];

export const RepositoryPlatformRepositorySchema = z.object({
    platform: RepositoryPlatformKindSchema,
    repositoryRef: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().nullable().optional(),
    topics: z.array(z.string().trim().min(1)),
    homepageUrl: z.string().trim().url().nullable().optional(),
    license: z.object({
        key: z.string().trim().min(1).optional(),
        name: z.string().trim().min(1).optional(),
        spdxId: z.string().trim().min(1).optional(),
        url: z.string().trim().url().nullable().optional()
    }).strict().nullable().optional(),
    ownerLogin: z.string().trim().min(1).optional(),
    ownerType: z.string().trim().min(1).optional(),
    ownerUrl: z.string().trim().url().optional(),
    htmlUrl: z.string().trim().url().optional(),
    visibility: z.enum(['private', 'public', 'internal']),
    defaultBranch: z.string().trim().min(1).optional(),
    archived: z.boolean(),
    starsCount: z.number().int().nonnegative().optional(),
    forksCount: z.number().int().nonnegative().optional(),
    watchersCount: z.number().int().nonnegative().optional(),
    subscribersCount: z.number().int().nonnegative().optional(),
    openIssuesCount: z.number().int().nonnegative().optional(),
    openPullRequestsCount: z.number().int().nonnegative().optional(),
    closedIssuesCount: z.number().int().nonnegative().optional(),
    commitsCount: z.number().int().nonnegative().optional(),
    releasesCount: z.number().int().nonnegative().optional(),
    workflowRunsCount: z.number().int().nonnegative().optional(),
    createdAt: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    pushedAt: z.string().trim().min(1).optional()
}).strict();

export const RepositorySettingsSchema = z.object({
    missionsRoot: z.string().trim().min(1),
    trackingProvider: z.literal('github'),
    instructionsPath: z.string().trim().min(1),
    skillsPath: z.string().trim().min(1),
    agentAdapter: AgentIdSchema,
    agentAdapters: z.array(RepositoryAgentAdapterSettingsSchema).default(() => createDefaultRepositoryAgentAdapterSettings()),
    defaultAgentMode: MissionDefaultAgentModeSchema.optional(),
    defaultModel: z.string().trim().min(1).optional(),
    defaultReasoningEffort: MissionReasoningEffortSchema.optional()
}).strict();

export const RepositoryOperationalModeSchema = z.enum(['setup', 'repository', 'invalid']);

export const RepositoryInvalidStateSchema = z.object({
    code: z.enum(['invalid-settings-document']),
    path: z.string().trim().min(1),
    message: z.string().trim().min(1)
}).strict();

const defaultRepositorySettings: RepositorySettingsType = {
    missionsRoot: defaultMissionsRoot,
    trackingProvider: 'github',
    instructionsPath: '.agents',
    skillsPath: '.agents/skills',
    agentAdapter: defaultAgentId,
    agentAdapters: createDefaultRepositoryAgentAdapterSettings()
};

export function createDefaultRepositoryAgentAdapterSettings(): RepositoryAgentAdapterSettingsType[] {
    return defaultAgentAdapterSettings.map((entry) => ({
        ...entry,
        models: entry.models.map((model) => ({ ...model })),
        reasoningEfforts: [...entry.reasoningEfforts]
    }));
}

export function createDefaultRepositorySettings(): RepositorySettingsType {
    return structuredClone(defaultRepositorySettings);
}

export function readRepositoryAgentAdapterSettings(
    settings: Pick<RepositorySettingsType, 'agentAdapters'>,
    agentId: string | undefined
): RepositoryAgentAdapterSettingsType | undefined {
    return settings.agentAdapters.find((entry) => entry.id === agentId);
}

export const RepositoryInputSchema = z.object({
    repositoryRootPath: z.string().trim().min(1),
    platformRepositoryRef: z.string().trim().min(1).optional(),
    settings: RepositorySettingsSchema.optional(),
    workflowConfiguration: RepositoryWorkflowConfigurationSchema.optional(),
    isInitialized: z.boolean().optional()
}).strict();

export const RepositoryStorageSchema = RepositoryInputSchema.extend({
    id: EntityIdSchema,
    ownerId: z.string().trim().min(1),
    repoName: z.string().trim().min(1),
    settings: RepositorySettingsSchema,
    workflowConfiguration: RepositoryWorkflowConfigurationSchema,
    isInitialized: z.boolean()
}).strict();


export const RepositoryLocatorSchema = z.object({
    id: EntityIdSchema,
    repositoryRootPath: z.string().trim().min(1).optional()
}).strict();

export const RepositoryFindSchema = z.object({}).strict();

export const RepositoryFindAvailableSchema = z.object({
    platform: RepositoryPlatformKindSchema.optional()
}).strict();

export const RepositoryClassCommandsSchema = z.object({
    commandInput: z.unknown().optional()
}).strict();

export const RepositoryLocalAddInputSchema = z.object({
    repositoryPath: z.string().trim().min(1)
}).strict();

export const RepositoryPlatformCheckoutInputSchema = z.object({
    platform: z.literal('github'),
    repositoryRef: z.string().trim().min(1),
    destinationPath: z.string().trim().min(1)
}).strict();

export const RepositoryAddSchema = z.union([
    RepositoryLocalAddInputSchema,
    RepositoryPlatformCheckoutInputSchema
]);

export const RepositoryGetIssueSchema = RepositoryLocatorSchema.extend({
    issueNumber: z.coerce.number().int().positive()
}).strict();

export const RepositorySyncStatusSchema = z.object({
    id: EntityIdSchema,
    repositoryRootPath: z.string().trim().min(1),
    checkedAt: z.string().trim().min(1),
    platform: RepositoryPlatformKindSchema.optional(),
    platformRepositoryRef: z.string().trim().min(1).optional(),
    remoteName: z.string().trim().min(1).optional(),
    branchRef: z.string().trim().min(1).optional(),
    defaultBranch: z.string().trim().min(1).optional(),
    worktree: z.object({
        clean: z.boolean(),
        stagedCount: z.number().int().nonnegative(),
        unstagedCount: z.number().int().nonnegative(),
        untrackedCount: z.number().int().nonnegative()
    }).strict(),
    external: z.object({
        trackingRef: z.string().trim().min(1).optional(),
        status: z.enum(['up-to-date', 'behind', 'ahead', 'diverged', 'untracked', 'unavailable']),
        aheadCount: z.number().int().nonnegative(),
        behindCount: z.number().int().nonnegative(),
        localHead: z.string().trim().min(1).optional(),
        remoteHead: z.string().trim().min(1).optional(),
        unavailableReason: z.string().trim().min(1).optional()
    }).strict()
}).strict();

export const RepositorySyncCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(repositoryEntityName),
    method: z.enum(['fetchExternalState', 'fastForwardFromExternal']),
    id: z.string().trim().min(1),
    syncStatus: RepositorySyncStatusSchema
}).strict();

export const MissionFromIssueInputSchema = z.object({
    issueNumber: z.coerce.number().int().positive()
}).strict();

export const MissionFromBriefInputSchema = z.object({
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
    type: MissionEntityTypeSchema
}).strict();

export const RepositoryStartMissionFromIssueSchema = RepositoryLocatorSchema.extend({
    ...MissionFromIssueInputSchema.shape
}).strict();

export const RepositoryStartMissionFromBriefSchema = RepositoryLocatorSchema.extend({
    ...MissionFromBriefInputSchema.shape
}).strict();

export const RepositorySetupSchema = RepositoryLocatorSchema.extend({
    settings: RepositorySettingsSchema
}).strict();

export const TrackedIssueSummarySchema = z.object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1),
    url: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1).optional(),
    labels: z.array(z.string()),
    assignees: z.array(z.string())
}).strict();

export const RepositoryIssueDetailSchema = z.object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1),
    body: z.string(),
    url: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    labels: z.array(z.string()),
    assignees: z.array(z.string())
}).strict();

export const RepositoryDataSchema = RepositoryStorageSchema.extend({
    operationalMode: RepositoryOperationalModeSchema.optional(),
    invalidState: RepositoryInvalidStateSchema.optional(),
    currentBranch: z.string().trim().min(1).optional()
}).strict();

export const RepositoryMissionStartMethodSchema = z.enum([
    'startMissionFromIssue',
    'startMissionFromBrief'
]);

export const RepositoryMissionStartAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(repositoryEntityName),
    method: RepositoryMissionStartMethodSchema,
    id: z.string().trim().min(1)
}).strict();

export const RepositoryRemoveAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(repositoryEntityName),
    method: z.literal('remove'),
    id: z.string().trim().min(1)
}).strict();

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
}).strict();

export type RepositoryInputType = z.infer<typeof RepositoryInputSchema>;
export type RepositoryStorageType = z.infer<typeof RepositoryStorageSchema>;
export type RepositoryPlatformKindType = z.infer<typeof RepositoryPlatformKindSchema>;
export type RepositoryAgentAdapterModelOptionType = z.infer<typeof RepositoryAgentAdapterModelOptionSchema>;
export type RepositoryAgentAdapterSettingsType = z.infer<typeof RepositoryAgentAdapterSettingsSchema>;
export type RepositoryPlatformRepositoryType = z.infer<typeof RepositoryPlatformRepositorySchema>;
export type RepositoryFindType = z.infer<typeof RepositoryFindSchema>;
export type RepositoryFindAvailableType = z.infer<typeof RepositoryFindAvailableSchema>;
export type RepositoryClassCommandsType = z.infer<typeof RepositoryClassCommandsSchema>;
export type RepositoryAddType = z.infer<typeof RepositoryAddSchema>;
export type RepositoryLocatorType = z.infer<typeof RepositoryLocatorSchema>;
export type RepositoryGetIssueType = z.infer<typeof RepositoryGetIssueSchema>;
export type RepositorySyncStatusType = z.infer<typeof RepositorySyncStatusSchema>;
export type RepositorySyncCommandAcknowledgementType = z.infer<typeof RepositorySyncCommandAcknowledgementSchema>;
export type RepositoryStartMissionFromIssueType = z.infer<typeof RepositoryStartMissionFromIssueSchema>;
export type RepositoryStartMissionFromBriefType = z.infer<typeof RepositoryStartMissionFromBriefSchema>;
export type RepositorySetupType = z.infer<typeof RepositorySetupSchema>;
export type RepositoryOperationalModeType = z.infer<typeof RepositoryOperationalModeSchema>;
export type RepositoryInvalidStateType = z.infer<typeof RepositoryInvalidStateSchema>;
export type RepositoryDataType = z.infer<typeof RepositoryDataSchema>;
export type RepositoryIssueDetailType = z.infer<typeof RepositoryIssueDetailSchema>;
export type TrackedIssueSummaryType = z.infer<typeof TrackedIssueSummarySchema>;
export type RepositoryMissionStartAcknowledgementType = z.infer<typeof RepositoryMissionStartAcknowledgementSchema>;
export type RepositoryRemoveAcknowledgementType = z.infer<typeof RepositoryRemoveAcknowledgementSchema>;
export type RepositorySetupResultType = z.infer<typeof RepositorySetupResultSchema>;
export type RepositorySettingsType = z.infer<typeof RepositorySettingsSchema>;

export function createDefaultRepositoryConfiguration(): Pick<RepositoryStorageType, 'settings' | 'workflowConfiguration' | 'isInitialized'> {
    const settings = createDefaultRepositorySettings();
    return {
        settings,
        workflowConfiguration: createDefaultWorkflowSettings(),
        isInitialized: false
    };
}
