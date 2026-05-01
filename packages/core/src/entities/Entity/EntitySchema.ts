import { z } from 'zod/v4';

const nonEmptyStringSchema = z.string().trim().min(1);

export const EntityTableSchema = z.string().trim().min(1).regex(/^[a-z][a-z0-9_]*$/);
export const EntityNameSchema = nonEmptyStringSchema;
export const EntityMethodNameSchema = nonEmptyStringSchema;
export const EntityObjectSchema = z.record(z.string(), z.unknown());

export const EntityIdSchema = nonEmptyStringSchema.refine((value) => {
    const separatorIndex = value.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
        return false;
    }
    return EntityTableSchema.safeParse(value.slice(0, separatorIndex)).success;
}, {
    message: 'Entity ids must use the table:uniqueId shape.'
});

export const EntityChannelSchema = nonEmptyStringSchema.refine((value) => {
    const tableSeparatorIndex = value.indexOf(':');
    const eventSeparatorIndex = value.lastIndexOf('.');
    if (tableSeparatorIndex <= 0 || tableSeparatorIndex === value.length - 1) {
        return false;
    }
    if (eventSeparatorIndex <= tableSeparatorIndex + 1 || eventSeparatorIndex === value.length - 1) {
        return false;
    }
    return EntityTableSchema.safeParse(value.slice(0, tableSeparatorIndex)).success;
}, {
    message: 'Entity channels must use the table:uniqueId.event shape.'
});

export const EntityEventAddressSchema = z.object({
    entityId: EntityIdSchema,
    channel: EntityChannelSchema,
    eventName: nonEmptyStringSchema
}).strict();

const zodSchema = z.custom<z.ZodType>();

const entityClassSchema = z.custom<Function>((value) =>
    typeof value === 'function'
    && typeof (value as { prototype?: unknown }).prototype === 'object'
);

export const EntityCommandInputOptionSchema = z.object({
    optionId: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    disabled: z.boolean().optional(),
    disabledReason: z.string().trim().min(1).optional()
}).strict();

export const EntityCommandInputDescriptorSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('text'),
        label: z.string().trim().min(1).optional(),
        placeholder: z.string().optional(),
        required: z.boolean().optional(),
        multiline: z.boolean().optional()
    }).strict(),
    z.object({
        kind: z.literal('selection'),
        label: z.string().trim().min(1).optional(),
        required: z.boolean().optional(),
        multiple: z.boolean().optional(),
        options: z.array(EntityCommandInputOptionSchema).min(1)
    }).strict(),
    z.object({
        kind: z.literal('boolean'),
        label: z.string().trim().min(1).optional(),
        defaultValue: z.boolean().optional()
    }).strict(),
    z.object({
        kind: z.literal('number'),
        label: z.string().trim().min(1).optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().positive().optional(),
        defaultValue: z.number().optional()
    }).strict()
]);

export const EntityCommandConfirmationSchema = z.object({
    required: z.boolean(),
    prompt: z.string().trim().min(1).optional()
}).strict();

export const EntityCommandDescriptorSchema = z.object({
    commandId: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    disabled: z.boolean(),
    disabledReason: z.string().trim().min(1).optional(),
    variant: z.enum(['default', 'destructive']).optional(),
    iconHint: z.string().trim().min(1).optional(),
    confirmation: EntityCommandConfirmationSchema.optional(),
    input: EntityCommandInputDescriptorSchema.optional(),
    presentationOrder: z.number().int().optional()
}).strict();

export const EntityMethodUiSchema = z.object({
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    variant: z.enum(['default', 'destructive']).optional(),
    iconHint: z.string().trim().min(1).optional(),
    confirmation: EntityCommandConfirmationSchema.optional(),
    input: EntityCommandInputDescriptorSchema.optional(),
    presentationOrder: z.number().int().optional()
}).strict();

export const EntityMethodExecutionSchema = z.enum(['class', 'entity']);
export const EntityMethodKindSchema = z.enum(['query', 'mutation']);

export const EntityPropertySchema = z.object({
    schema: zodSchema,
    readonly: z.boolean().optional()
}).strict();

export const EntityEventSchema = z.object({
    payload: zodSchema
}).strict();

export const EntityMethodSchema = z.object({
    kind: EntityMethodKindSchema,
    payload: zodSchema,
    result: zodSchema,
    execution: EntityMethodExecutionSchema,
    ui: EntityMethodUiSchema.optional()
}).strict();

export const EntityContractSchema = z.object({
    entity: EntityNameSchema,
    entityClass: entityClassSchema,
    inputSchema: zodSchema.optional(),
    storageSchema: zodSchema.optional(),
    dataSchema: zodSchema.optional(),
    properties: z.record(z.string(), EntityPropertySchema).optional(),
    methods: z.record(z.string(), EntityMethodSchema),
    events: z.record(z.string(), EntityEventSchema).optional()
}).strict();

export const EntityCommandAcknowledgementSchema = z.object({
    ok: z.literal(true),
    entity: EntityNameSchema,
    method: EntityMethodNameSchema,
    id: z.string().trim().min(1).optional()
}).strict();

export const EntityEventEnvelopeSchema = z.object({
    eventId: nonEmptyStringSchema,
    entityId: EntityIdSchema,
    channel: EntityChannelSchema,
    eventName: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
    occurredAt: nonEmptyStringSchema,
    missionId: nonEmptyStringSchema.optional(),
    payload: z.unknown()
}).strict();

export type EntityIdType = z.infer<typeof EntityIdSchema>;
export type EntityChannelType = z.infer<typeof EntityChannelSchema>;
export type EntityEventAddressType = z.infer<typeof EntityEventAddressSchema>;
export type EntityCommandInputOptionType = z.infer<typeof EntityCommandInputOptionSchema>;
export type EntityCommandInputDescriptorType = z.infer<typeof EntityCommandInputDescriptorSchema>;
export type EntityCommandConfirmationType = z.infer<typeof EntityCommandConfirmationSchema>;
export type EntityCommandDescriptorType = z.infer<typeof EntityCommandDescriptorSchema>;
export type EntityMethodUiType = z.infer<typeof EntityMethodUiSchema>;
export type EntityMethodExecutionType = z.infer<typeof EntityMethodExecutionSchema>;
export type EntityMethodKindType = z.infer<typeof EntityMethodKindSchema>;
export type EntityPropertyType = z.infer<typeof EntityPropertySchema>;
export type EntityEventType = z.infer<typeof EntityEventSchema>;
export type EntityMethodType = z.infer<typeof EntityMethodSchema>;
export type EntityContractType = z.infer<typeof EntityContractSchema>;
export type EntityCommandAcknowledgementType = z.infer<typeof EntityCommandAcknowledgementSchema>;
export type EntityEventEnvelopeType = z.infer<typeof EntityEventEnvelopeSchema>;
