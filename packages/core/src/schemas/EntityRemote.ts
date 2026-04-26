import { z } from 'zod/v4';

export const entityNameSchema = z.string().trim().min(1);
export const entityMethodSchema = z.string().trim().min(1);

export const entityQueryInvocationSchema = z.object({
    entity: entityNameSchema,
    method: entityMethodSchema,
    payload: z.unknown().optional()
}).strict();

export const entityCommandInvocationSchema = z.object({
    entity: entityNameSchema,
    method: entityMethodSchema,
    payload: z.unknown().optional()
}).strict();

export const entityFormInvocationSchema = entityCommandInvocationSchema;

export const entityCommandInputOptionSchema = z.object({
    optionId: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    disabled: z.boolean().optional(),
    disabledReason: z.string().trim().min(1).optional()
}).strict();

export const entityCommandInputDescriptorSchema = z.discriminatedUnion('kind', [
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
        options: z.array(entityCommandInputOptionSchema).min(1)
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

export const entityCommandConfirmationSchema = z.object({
    required: z.boolean(),
    prompt: z.string().trim().min(1).optional()
}).strict();

export const entityCommandDescriptorSchema = z.object({
    commandId: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    disabled: z.boolean(),
    disabledReason: z.string().trim().min(1).optional(),
    variant: z.enum(['default', 'destructive']).optional(),
    iconHint: z.string().trim().min(1).optional(),
    confirmation: entityCommandConfirmationSchema.optional(),
    input: entityCommandInputDescriptorSchema.optional(),
    presentationOrder: z.number().int().optional()
}).strict();

export const entityCommandListSnapshotSchema = z.object({
    entity: entityNameSchema,
    entityId: z.string().trim().min(1),
    commands: z.array(entityCommandDescriptorSchema)
}).strict();

export const entityCommandAcknowledgementSchema = z.object({
    ok: z.literal(true),
    entity: entityNameSchema,
    method: entityMethodSchema,
    id: z.string().trim().min(1).optional()
}).strict();

export type EntityQueryInvocation = z.infer<typeof entityQueryInvocationSchema>;
export type EntityCommandInvocation = z.infer<typeof entityCommandInvocationSchema>;
export type EntityFormInvocation = z.infer<typeof entityFormInvocationSchema>;
export type EntityCommandInputOption = z.infer<typeof entityCommandInputOptionSchema>;
export type EntityCommandInputDescriptor = z.infer<typeof entityCommandInputDescriptorSchema>;
export type EntityCommandConfirmation = z.infer<typeof entityCommandConfirmationSchema>;
export type EntityCommandDescriptor = z.infer<typeof entityCommandDescriptorSchema>;
export type EntityCommandListSnapshot = z.infer<typeof entityCommandListSnapshotSchema>;
export type EntityCommandAcknowledgement = z.infer<typeof entityCommandAcknowledgementSchema>;
export type EntityRemoteResult = unknown;
