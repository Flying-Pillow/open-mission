import { z } from 'zod/v4';
import { WorkflowGlobalSettingsSchema } from '../../workflow/WorkflowSchema.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';
import {
    missionEntityTypeSchema,
    missionSnapshotSchema
} from '../Mission/MissionSchema.js';
import {
    EntityCommandAcknowledgementSchema,
    EntityIdSchema
} from '../Entity/EntitySchema.js';

export const RepositoryWorkflowConfigurationSchema = WorkflowGlobalSettingsSchema;

export const repositoryEntityName = 'Repository' as const;
export const RepositoryPlatformKindSchema = z.enum(['github']);

const defaultMissionsRoot = 'missions';

const airportPaneIdSchema = z.enum(['tower', 'briefingRoom', 'runway']);
const paneTargetKindSchema = z.enum([
    'empty',
    'repository',
    'mission',
    'task',
    'artifact',
    'agentSession'
]);
const paneModeSchema = z.enum(['view', 'control']);

const paneBindingSchema = z.object({
    targetKind: paneTargetKindSchema,
    targetId: z.string().trim().min(1).optional(),
    mode: paneModeSchema.optional()
}).strict();

const repositoryAirportIntentSchema = z.object({
    panes: z.object({
        briefingRoom: paneBindingSchema.optional(),
        runway: paneBindingSchema.optional()
    }).strict().optional(),
    focus: z.object({
        intentPaneId: airportPaneIdSchema.optional()
    }).strict().optional()
}).strict();

export const RepositorySettingsSchema = z.object({
    missionsRoot: z.string().trim().min(1),
    trackingProvider: z.literal('github'),
    instructionsPath: z.string().trim().min(1),
    skillsPath: z.string().trim().min(1),
    agentRunner: z.enum(['copilot-cli', 'pi']),
    defaultAgentMode: z.enum(['interactive', 'autonomous']).optional(),
    defaultModel: z.string().trim().min(1).optional(),
    airport: repositoryAirportIntentSchema.optional()
}).strict();

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

export type RepositorySettingsType = z.infer<typeof RepositorySettingsSchema>;
export type MissionAgentRunner = 'copilot-cli' | 'pi';
export type MissionDefaultAgentMode = 'interactive' | 'autonomous';

const defaultRepositorySettings: RepositorySettingsType = {
    missionsRoot: defaultMissionsRoot,
    trackingProvider: 'github',
    instructionsPath: '.agents',
    skillsPath: '.agents/skills',
    agentRunner: 'copilot-cli'
};

export function createDefaultRepositorySettings(): RepositorySettingsType {
    return structuredClone(defaultRepositorySettings);
}

export const RepositoryInputSchema = z.object({
    repositoryRootPath: z.string().trim().min(1),
    platformRepositoryRef: z.string().trim().min(1).optional(),
    settings: RepositorySettingsSchema.optional(),
    workflowConfiguration: RepositoryWorkflowConfigurationSchema.optional(),
    isInitialized: z.boolean().optional()
}).strict();

export const RepositoryStorageSchema = z.object({
    id: EntityIdSchema,
    repositoryRootPath: z.string().trim().min(1),
    ownerId: z.string().trim().min(1),
    repoName: z.string().trim().min(1),
    platformRepositoryRef: z.string().trim().min(1).optional(),
    settings: RepositorySettingsSchema,
    workflowConfiguration: RepositoryWorkflowConfigurationSchema,
    isInitialized: z.boolean()
}).strict();

export const RepositoryDataSchema = RepositoryStorageSchema;
export const RepositorySchema = RepositoryDataSchema;

export const MissionReferenceSchema = z.object({
    missionId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    branchRef: z.string().trim().min(1),
    createdAt: z.string().trim().min(1),
    issueId: z.number().int().positive().optional()
}).strict();

export const RepositoryIdentityPayloadSchema = z.object({
    id: EntityIdSchema,
    repositoryRootPath: z.string().trim().min(1).optional()
}).strict();

export const RepositoryFindPayloadSchema = z.object({}).strict();

export const RepositoryFindAvailablePayloadSchema = z.object({
    platform: RepositoryPlatformKindSchema.optional()
}).strict();

export const RepositoryLocalAddInputSchema = z.object({
    repositoryPath: z.string().trim().min(1)
}).strict();

export const RepositoryGitHubCheckoutInputSchema = z.object({
    platform: z.literal('github'),
    repositoryRef: z.string().trim().min(1),
    destinationPath: z.string().trim().min(1)
}).strict();

export const RepositoryAddPayloadSchema = z.union([
    RepositoryLocalAddInputSchema,
    RepositoryGitHubCheckoutInputSchema
]);

export const RepositoryRemovePayloadSchema = RepositoryIdentityPayloadSchema;

export const RepositoryReadPayloadSchema = RepositoryIdentityPayloadSchema;

export const RepositoryPreparePayloadSchema = RepositoryIdentityPayloadSchema;

export const RepositoryListIssuesPayloadSchema = RepositoryIdentityPayloadSchema;

export const RepositoryGetIssuePayloadSchema = RepositoryIdentityPayloadSchema.extend({
    issueNumber: z.coerce.number().int().positive()
}).strict();

export const MissionFromIssueInputSchema = z.object({
    issueNumber: z.coerce.number().int().positive()
}).strict();

export const MissionFromBriefInputSchema = z.object({
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
    type: missionEntityTypeSchema
}).strict();

export const RepositoryStartMissionFromIssuePayloadSchema = RepositoryIdentityPayloadSchema.extend(
    MissionFromIssueInputSchema.shape
).strict();

export const RepositoryStartMissionFromBriefPayloadSchema = RepositoryIdentityPayloadSchema.extend(
    MissionFromBriefInputSchema.shape
).strict();

export const TrackedIssueSummarySchema = z.object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1),
    url: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1).optional(),
    labels: z.array(z.string()),
    assignees: z.array(z.string())
}).strict();

export const GitHubIssueDetailSchema = z.object({
    number: z.number().int().positive(),
    title: z.string().trim().min(1),
    body: z.string(),
    url: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1).optional(),
    labels: z.array(z.string()),
    assignees: z.array(z.string())
}).strict();

export const RepositorySnapshotSchema = z.object({
    repository: RepositoryDataSchema,
    operationalMode: z.string().trim().min(1).optional(),
    controlRoot: z.string().trim().min(1).optional(),
    currentBranch: z.string().trim().min(1).optional(),
    settingsComplete: z.boolean().optional(),
    platformRepositoryRef: z.string().trim().min(1).optional(),
    missions: z.array(MissionReferenceSchema),
    selectedMissionId: z.string().trim().min(1).optional(),
    selectedMission: missionSnapshotSchema.optional(),
    selectedIssue: GitHubIssueDetailSchema.optional()
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

export const RepositoryPrepareResultSchema = z.object({
    kind: z.literal('repository-bootstrap'),
    state: z.literal('pull-request-opened'),
    branchRef: z.string().trim().min(1),
    baseBranch: z.string().trim().min(1),
    pullRequestUrl: z.string().trim().min(1),
    controlDirectoryPath: z.string().trim().min(1),
    settingsPath: z.string().trim().min(1),
    worktreesPath: z.string().trim().min(1),
    missionsPath: z.string().trim().min(1)
}).strict();

export const repositoryRemoteQueryPayloadSchemas = {
    find: RepositoryFindPayloadSchema,
    findAvailable: RepositoryFindAvailablePayloadSchema,
    read: RepositoryReadPayloadSchema,
    listIssues: RepositoryListIssuesPayloadSchema,
    getIssue: RepositoryGetIssuePayloadSchema
} as const;

export const repositoryRemoteCommandPayloadSchemas = {
    add: RepositoryAddPayloadSchema,
    remove: RepositoryRemovePayloadSchema,
    prepare: RepositoryPreparePayloadSchema,
    startMissionFromIssue: RepositoryStartMissionFromIssuePayloadSchema,
    startMissionFromBrief: RepositoryStartMissionFromBriefPayloadSchema
} as const;

export const repositoryRemoteQueryResultSchemas = {
    find: z.array(RepositorySnapshotSchema),
    findAvailable: z.array(RepositoryPlatformRepositorySchema),
    read: RepositorySnapshotSchema,
    listIssues: z.array(TrackedIssueSummarySchema),
    getIssue: GitHubIssueDetailSchema
} as const;

export const repositoryRemoteCommandResultSchemas = {
    add: RepositorySnapshotSchema,
    remove: RepositoryRemoveAcknowledgementSchema,
    prepare: RepositoryPrepareResultSchema,
    startMissionFromIssue: RepositoryMissionStartAcknowledgementSchema,
    startMissionFromBrief: RepositoryMissionStartAcknowledgementSchema
} as const;

export type RepositoryInputType = z.infer<typeof RepositoryInputSchema>;
export type RepositoryStorageType = z.infer<typeof RepositoryStorageSchema>;
export type RepositoryDataType = z.infer<typeof RepositoryDataSchema>;
export type RepositoryPlatformKindType = z.infer<typeof RepositoryPlatformKindSchema>;
export type RepositoryPlatformRepositoryType = z.infer<typeof RepositoryPlatformRepositorySchema>;
export type MissionReferenceType = z.infer<typeof MissionReferenceSchema>;
export type RepositoryFindPayloadType = z.infer<typeof RepositoryFindPayloadSchema>;
export type RepositoryFindAvailablePayloadType = z.infer<typeof RepositoryFindAvailablePayloadSchema>;
export type RepositoryAddPayloadType = z.infer<typeof RepositoryAddPayloadSchema>;
export type RepositoryRemovePayloadType = z.infer<typeof RepositoryRemovePayloadSchema>;
export type RepositoryPreparePayloadType = z.infer<typeof RepositoryPreparePayloadSchema>;
export type RepositoryReadPayloadType = z.infer<typeof RepositoryReadPayloadSchema>;
export type RepositoryListIssuesPayloadType = z.infer<typeof RepositoryListIssuesPayloadSchema>;
export type RepositoryGetIssuePayloadType = z.infer<typeof RepositoryGetIssuePayloadSchema>;
export type RepositoryStartMissionFromIssuePayloadType = z.infer<typeof RepositoryStartMissionFromIssuePayloadSchema>;
export type RepositoryStartMissionFromBriefPayloadType = z.infer<typeof RepositoryStartMissionFromBriefPayloadSchema>;
export type RepositorySnapshotType = z.infer<typeof RepositorySnapshotSchema>;
export type GitHubIssueDetailType = z.infer<typeof GitHubIssueDetailSchema>;
export type TrackedIssueSummaryType = z.infer<typeof TrackedIssueSummarySchema>;
export type RepositoryMissionStartAcknowledgementType = z.infer<typeof RepositoryMissionStartAcknowledgementSchema>;
export type RepositoryRemoveAcknowledgementType = z.infer<typeof RepositoryRemoveAcknowledgementSchema>;
export type RepositoryPrepareResultType = z.infer<typeof RepositoryPrepareResultSchema>;

export function createDefaultRepositoryConfiguration(): Pick<RepositoryDataType, 'settings' | 'workflowConfiguration' | 'isInitialized'> {
    const settings = createDefaultRepositorySettings();
    return {
        settings,
        workflowConfiguration: createDefaultWorkflowSettings(),
        isInitialized: false
    };
}
