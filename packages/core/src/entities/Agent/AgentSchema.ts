import { z } from 'zod/v4';
import { field, table } from '@flying-pillow/zod-surreal';
import { IdSchema, EntitySchema, EntityStorageSchema } from '../Entity/EntitySchema.js';
import {
    AgentExecutionLaunchModeSchema,
    AgentExecutionReasoningEffortSchema
} from '../AgentExecution/AgentExecutionSchema.js';

export const agentEntityName = 'Agent' as const;
export const agentTableName = 'agent' as const;

const agentEntityIdDescription = 'Canonical Entity id for the Agent catalogue record.';
const agentIdDescription = 'Stable configured AgentAdapter id used for settings, registry lookup, and launch selection.';
const repositoryIdDescription = 'Canonical Repository Entity id that scopes Agent catalogue lookup.';
const displayNameDescription = 'Operator-facing Agent name shown in catalogue and command surfaces.';
const iconDescription = 'Icon identifier shown for the Agent in operator-facing surfaces.';
const availabilityReasonDescription = 'Human-readable reason the Agent is unavailable in the current environment.';

const agentTextSchema = z.string().trim().min(1);
const agentOptionalTextSchema = agentTextSchema.optional();

function describedText(description: string) {
    return agentTextSchema.meta({ description });
}

function describedOptionalText(description: string) {
    return agentOptionalTextSchema.meta({ description });
}

function storedText(description: string) {
    return describedText(description).register(field, { description });
}

export const AgentIdSchema = describedText(agentIdDescription)
    .meta({ description: agentIdDescription });

export const AgentCapabilitySchema = z.object({
    acceptsPromptSubmission: z.boolean().meta({
        description: 'Whether the Agent accepts prompt-style message delivery.'
    }),
    acceptsCommands: z.boolean().meta({
        description: 'Whether the Agent accepts structured command delivery.'
    }),
    supportsInterrupt: z.boolean().meta({
        description: 'Whether the Agent can receive an interrupt request while running.'
    }),
    supportsResumeByReference: z.boolean().meta({
        description: 'Whether the Agent can resume a previous provider-side execution by reference.'
    }),
    supportsCheckpoint: z.boolean().meta({
        description: 'Whether the Agent can produce or accept checkpoint semantics.'
    }),
    exportFormats: z.array(describedText('Named export format supported by the Agent.')).optional().meta({
        description: 'Optional provider-neutral export formats advertised by the Agent.'
    }),
    shareModes: z.array(describedText('Named sharing mode supported by the Agent.')).optional().meta({
        description: 'Optional provider-neutral sharing modes advertised by the Agent.'
    })
}).strict().meta({
    description: 'Provider-neutral capability summary exposed by an Agent.'
});

export const AgentAvailabilitySchema = z.object({
    available: z.boolean().meta({
        description: 'Whether the Agent can currently be selected for work.'
    }),
    reason: describedOptionalText(availabilityReasonDescription)
}).strict().meta({
    description: 'Current availability report for one Agent.'
});

export const AgentAdapterTransportCapabilitiesSchema = z.object({
    supported: z.array(describedText('Transport lane supported by this AgentAdapter.')).meta({
        description: 'Transport lanes the AgentAdapter can use for AgentExecution communication.'
    }),
    preferred: z.object({
        interactive: describedOptionalText('Preferred transport lane for interactive Agent launches.'),
        print: describedOptionalText('Preferred transport lane for print-style Agent launches.')
    }).strict().meta({
        description: 'Preferred transport lane by launch mode.'
    }),
    provisioning: z.object({
        requiresRuntimeConfig: z.boolean().meta({
            description: 'Whether the adapter requires runtime configuration before launch.'
        }),
        supportsStdioBridge: z.boolean().meta({
            description: 'Whether the adapter can communicate over a stdio bridge.'
        }),
        supportsAgentExecutionScopedTools: z.boolean().meta({
            description: 'Whether the adapter can expose tools scoped to one AgentExecution.'
        })
    }).strict().meta({
        description: 'Provisioning capabilities advertised by the AgentAdapter.'
    })
}).strict().meta({
    description: 'Transport capabilities reported by the AgentAdapter for Agent diagnostics.'
});

export const AgentAdapterDiagnosticsSchema = z.object({
    command: storedText('Executable command used by the AgentAdapter.'),
    supportsUsageParsing: z.boolean().meta({
        description: 'Whether the AgentAdapter can parse provider usage metadata.'
    }).register(field, {
        description: 'Whether the AgentAdapter can parse provider usage metadata.'
    }),
    supportedMessageCount: z.number().int().nonnegative().meta({
        description: 'Number of structured AgentExecution message descriptors advertised by the adapter.'
    }).register(field, {
        description: 'Number of structured AgentExecution message descriptors advertised by the adapter.'
    }),
    transportCapabilities: AgentAdapterTransportCapabilitiesSchema.meta({
        description: 'Transport and provisioning capabilities reported by the AgentAdapter.'
    }).register(field, {
        description: 'Transport and provisioning capabilities reported by the AgentAdapter.'
    })
}).strict().meta({
    description: 'Adapter diagnostic summary exposed through the Agent Entity.'
});

export const AgentOwnerSettingsSchema = z.object({
    defaultAgentAdapter: AgentIdSchema.clone().meta({
        description: 'Default AgentAdapter id selected when no command requests a specific Agent.'
    }),
    enabledAgentAdapters: z.array(AgentIdSchema.clone().meta({
        description: 'Enabled AgentAdapter id in the owner settings document.'
    })).default([]).meta({
        description: 'AgentAdapter ids enabled for this owner scope.'
    }),
    defaultAgentMode: AgentExecutionLaunchModeSchema.optional().meta({
        description: 'Default AgentExecution launch mode for this owner scope.'
    }),
    defaultModel: describedOptionalText('Default model name supplied to AgentAdapter launches.'),
    defaultReasoningEffort: AgentExecutionReasoningEffortSchema.optional().meta({
        description: 'Default reasoning effort supplied to AgentAdapter launches.'
    })
}).strict().meta({
    description: 'Repository or System settings that select available Agent adapters and defaults.'
});

export const AgentLocatorSchema = z.object({
    agentId: AgentIdSchema.clone().meta({
        description: 'Configured AgentAdapter id to resolve from the repository-scoped Agent catalogue.'
    }),
    repositoryId: IdSchema.clone().meta({
        description: repositoryIdDescription
    })
}).strict().meta({
    description: 'Class-scoped selector for resolving one configured Agent by repository context and Agent id.'
});

export const AgentFindSchema = z.object({
    repositoryId: IdSchema.clone().meta({
        description: repositoryIdDescription
    })
}).strict().meta({
    description: 'Class-scoped selector for listing configured Agents in one repository context.'
});

export const AgentLaunchModeSchema = z.enum(['interactive', 'print']).meta({
    description: 'Launch mode used for a one-shot Agent connection test.'
});

export const AgentTestConnectionInputSchema = z.object({
    agentId: AgentIdSchema.clone().meta({
        description: 'Configured AgentAdapter id to test.'
    }),
    repositoryId: IdSchema.clone().meta({
        description: 'Canonical Repository Entity id that scopes Agent settings for the connection test.'
    }),
    workingDirectory: describedOptionalText('Working directory used by the bounded Agent connection probe.'),
    model: describedOptionalText('Optional model name supplied only to the connection probe.'),
    reasoningEffort: AgentExecutionReasoningEffortSchema.optional().meta({
        description: 'Optional reasoning effort supplied only to the connection probe.'
    }),
    launchMode: AgentLaunchModeSchema.optional().meta({
        description: 'Optional launch mode override for the connection probe.'
    }),
    initialPrompt: describedOptionalText('Optional smoke-test prompt sent during the connection probe.')
}).strict().meta({
    description: 'Input for the Agent class-level connection test command.'
});

export const AgentConnectionTestKindSchema = z.enum([
    'success',
    'auth-failed',
    'spawn-failed',
    'timeout',
    'invalid-model',
    'unknown'
]).meta({
    description: 'Bounded classifier for an Agent connection test result.'
});

export const AgentConnectionTestResultSchema = z.object({
    ok: z.boolean().meta({
        description: 'Whether the Agent connection probe succeeded.'
    }),
    kind: AgentConnectionTestKindSchema.meta({
        description: 'Classified outcome for the Agent connection probe.'
    }),
    agentId: AgentIdSchema.clone().meta({
        description: 'Configured AgentAdapter id that was tested.'
    }),
    agentName: describedText('Operator-facing name of the Agent that was tested.'),
    summary: describedText('Short operator-facing connection test summary.'),
    detail: describedOptionalText('Optional detailed connection test explanation.'),
    sampleOutput: describedOptionalText('Optional bounded provider output sample captured during the test.'),
    diagnosticCode: describedOptionalText('Optional machine-readable diagnostic code for the connection test.'),
    metadata: z.record(z.string().meta({
        description: 'Connection test metadata key.'
    }), z.union([z.string(), z.number(), z.boolean(), z.null()]).meta({
        description: 'Connection test metadata value.'
    })).optional().meta({
        description: 'Optional bounded diagnostic metadata for the connection test.'
    })
}).strict().meta({
    description: 'Typed result returned by the Agent connection test command.'
});

export const AgentStorageSchema = EntityStorageSchema.extend({
    id: IdSchema.clone().meta({ description: agentEntityIdDescription }).register(field, {
        description: agentEntityIdDescription
    }),
    agentId: AgentIdSchema.clone().meta({ description: agentIdDescription }).register(field, {
        description: agentIdDescription
    }),
    displayName: storedText(displayNameDescription),
    icon: storedText(iconDescription),
    capabilities: AgentCapabilitySchema.register(field, {
        description: 'Provider-neutral capability summary for this Agent.'
    }),
    availability: AgentAvailabilitySchema.register(field, {
        description: 'Current availability report for this Agent.'
    }),
    diagnostics: AgentAdapterDiagnosticsSchema.optional().register(field, {
        optional: true,
        description: 'Optional adapter diagnostic summary for this Agent.'
    })
}).strict().meta({
    description: 'Canonical Agent storage record.'
}).register(table, {
    table: agentTableName,
    schemafull: true,
    description: 'Canonical Agent catalogue records.',
    indexes: [
        {
            name: 'agent_agent_id_idx',
            fields: ['agentId'],
            unique: true
        }
    ]
});

const AgentStoragePayloadSchema = AgentStorageSchema.omit({ id: true });

export const AgentSchema = EntitySchema.extend({
    ...AgentStoragePayloadSchema.shape
}).strict().meta({
    description: 'Complete hydrated Agent Entity returned by the Agent boundary.'
});

export const AgentCollectionSchema = z.array(AgentSchema).meta({
    description: 'Repository-scoped collection of configured Agent Entities.'
});

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
export type AgentCollectionType = z.infer<typeof AgentCollectionSchema>;
export type AgentConnectionTestResultType = z.infer<typeof AgentConnectionTestResultSchema>;
