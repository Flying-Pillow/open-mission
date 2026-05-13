import { z } from 'zod/v4';
import { EntitySchema, EntityStorageSchema } from '../Entity/EntitySchema.js';
import {
    AgentExecutionLaunchModeSchema,
    AgentExecutionReasoningEffortSchema
} from '../AgentExecution/AgentExecutionProtocolSchema.js';

export const agentEntityName = 'Agent' as const;

export const AgentIdSchema = z.string().trim().min(1);

export const AgentPrimaryDataSchema = EntityStorageSchema.extend({
    agentId: AgentIdSchema,
    displayName: z.string().trim().min(1),
    icon: z.string().trim().min(1)
}).strict();

export const AgentCapabilitySchema = z.object({
    acceptsPromptSubmission: z.boolean(),
    acceptsCommands: z.boolean(),
    supportsInterrupt: z.boolean(),
    supportsResumeByReference: z.boolean(),
    supportsCheckpoint: z.boolean(),
    exportFormats: z.array(z.string().trim().min(1)).optional(),
    shareModes: z.array(z.string().trim().min(1)).optional()
}).strict();

export const AgentAvailabilitySchema = z.object({
    available: z.boolean(),
    reason: z.string().trim().min(1).optional()
}).strict();

export const AgentAdapterTransportCapabilitiesSchema = z.object({
    supported: z.array(z.string().trim().min(1)),
    preferred: z.object({
        interactive: z.string().trim().min(1).optional(),
        print: z.string().trim().min(1).optional()
    }).strict(),
    provisioning: z.object({
        requiresRuntimeConfig: z.boolean(),
        supportsStdioBridge: z.boolean(),
        supportsAgentExecutionScopedTools: z.boolean()
    }).strict()
}).strict();

export const AgentAdapterDiagnosticsSchema = z.object({
    command: z.string().trim().min(1),
    supportsUsageParsing: z.boolean(),
    runtimeMessageCount: z.number().int().nonnegative(),
    transportCapabilities: AgentAdapterTransportCapabilitiesSchema
}).strict();

export const AgentOwnerSettingsSchema = z.object({
    defaultAgentAdapter: AgentIdSchema,
    enabledAgentAdapters: z.array(AgentIdSchema).default([]),
    defaultAgentMode: AgentExecutionLaunchModeSchema.optional(),
    defaultModel: z.string().trim().min(1).optional(),
    defaultReasoningEffort: AgentExecutionReasoningEffortSchema.optional()
}).strict();

export const AgentLocatorSchema = z.object({
    agentId: AgentIdSchema,
    repositoryRootPath: z.string().trim().min(1).optional()
}).strict();

export const AgentFindSchema = z.object({
    repositoryRootPath: z.string().trim().min(1).optional()
}).strict();

export const AgentLaunchModeSchema = z.enum(['interactive', 'print']);

export const AgentTestConnectionInputSchema = z.object({
    agentId: AgentIdSchema,
    repositoryRootPath: z.string().trim().min(1).optional(),
    workingDirectory: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
    reasoningEffort: AgentExecutionReasoningEffortSchema.optional(),
    launchMode: AgentLaunchModeSchema.optional(),
    initialPrompt: z.string().trim().min(1).optional()
}).strict();

export const AgentConnectionTestKindSchema = z.enum([
    'success',
    'auth-failed',
    'spawn-failed',
    'timeout',
    'invalid-model',
    'unknown'
]);

export const AgentConnectionTestResultSchema = z.object({
    ok: z.boolean(),
    kind: AgentConnectionTestKindSchema,
    agentId: AgentIdSchema,
    agentName: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    detail: z.string().trim().min(1).optional(),
    sampleOutput: z.string().trim().min(1).optional(),
    diagnosticCode: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
}).strict();

export const AgentStorageSchema = AgentPrimaryDataSchema.extend({
    capabilities: AgentCapabilitySchema,
    availability: AgentAvailabilitySchema,
    diagnostics: AgentAdapterDiagnosticsSchema.optional()
}).strict();

const AgentStoragePayloadSchema = AgentStorageSchema.omit({ id: true });

export const AgentSchema = EntitySchema.extend({
    ...AgentStoragePayloadSchema.shape
}).strict();

export const AgentFindResultSchema = z.array(AgentSchema);

export type AgentPrimaryDataType = z.infer<typeof AgentPrimaryDataSchema>;
export type AgentInput<TAgentAdapterInput = unknown> = AgentPrimaryDataType & {
    adapter: TAgentAdapterInput;
    default?: boolean;
};
export type AgentIdType = z.infer<typeof AgentIdSchema>;
export type AgentCapabilityType = z.infer<typeof AgentCapabilitySchema>;
export type AgentAvailabilityType = z.infer<typeof AgentAvailabilitySchema>;
export type AgentAdapterDiagnosticsType = z.infer<typeof AgentAdapterDiagnosticsSchema>;
export type AgentOwnerSettingsType = z.infer<typeof AgentOwnerSettingsSchema>;
export type AgentLocatorType = z.infer<typeof AgentLocatorSchema>;
export type AgentFindType = z.infer<typeof AgentFindSchema>;
export type AgentLaunchModeType = z.infer<typeof AgentLaunchModeSchema>;
export type AgentTestConnectionInputType = z.infer<typeof AgentTestConnectionInputSchema>;
export type AgentConnectionTestKindType = z.infer<typeof AgentConnectionTestKindSchema>;
export type AgentStorageType = z.infer<typeof AgentStorageSchema>;
export type AgentType = z.infer<typeof AgentSchema>;
export type AgentFindResultType = z.infer<typeof AgentFindResultSchema>;
export type AgentConnectionTestResultType = z.infer<typeof AgentConnectionTestResultSchema>;
