import { z } from 'zod/v4';
import { EntityIdSchema } from '../Entity/EntitySchema.js';
import { MissionReasoningEffortSchema } from '../Mission/MissionSchema.js';

export const agentEntityName = 'Agent' as const;

export const AgentIdSchema = z.string().trim().min(1);

export const AgentPrimaryDataSchema = z.object({
    id: EntityIdSchema,
    agentId: AgentIdSchema,
    displayName: z.string().trim().min(1)
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

export const AgentModelOptionSchema = z.object({
    value: z.string().trim().min(1),
    label: z.string().trim().min(1)
}).strict();

export const AgentOptionCatalogSchema = z.object({
    models: z.array(AgentModelOptionSchema),
    reasoningEfforts: z.array(MissionReasoningEffortSchema)
}).strict();

export const AgentLocatorSchema = z.object({
    agentId: AgentIdSchema,
    repositoryRootPath: z.string().trim().min(1).optional()
}).strict();

export const AgentFindSchema = z.object({
    repositoryRootPath: z.string().trim().min(1).optional()
}).strict();

export const AgentStorageSchema = z.object({
    ...AgentPrimaryDataSchema.shape,
    capabilities: AgentCapabilitySchema,
    availability: AgentAvailabilitySchema,
    optionCatalog: AgentOptionCatalogSchema
}).strict();

export const AgentDataSchema = z.object({
    ...AgentStorageSchema.shape
}).strict();

export const AgentFindResultSchema = z.array(AgentDataSchema);

export type AgentPrimaryDataType = z.infer<typeof AgentPrimaryDataSchema>;
export type AgentInput<TAgentAdapterInput = unknown> = AgentPrimaryDataType & {
    adapter: TAgentAdapterInput;
    optionCatalog?: AgentOptionCatalogType;
    default?: boolean;
    supportsDefaultReasoningEffort?: boolean;
};
export type AgentIdType = z.infer<typeof AgentIdSchema>;
export type AgentCapabilityType = z.infer<typeof AgentCapabilitySchema>;
export type AgentAvailabilityType = z.infer<typeof AgentAvailabilitySchema>;
export type AgentModelOptionType = z.infer<typeof AgentModelOptionSchema>;
export type AgentOptionCatalogType = z.infer<typeof AgentOptionCatalogSchema>;
export type AgentLocatorType = z.infer<typeof AgentLocatorSchema>;
export type AgentFindType = z.infer<typeof AgentFindSchema>;
export type AgentStorageType = z.infer<typeof AgentStorageSchema>;
export type AgentDataType = z.infer<typeof AgentDataSchema>;
export type AgentFindResultType = z.infer<typeof AgentFindResultSchema>;
