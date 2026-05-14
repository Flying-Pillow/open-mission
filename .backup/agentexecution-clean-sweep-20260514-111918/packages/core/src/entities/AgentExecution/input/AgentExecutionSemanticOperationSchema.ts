import { z } from 'zod/v4';

export const READ_ARTIFACT_OPERATION_NAME = 'read_artifact' as const;

export const AgentExecutionSemanticOperationNameSchema = z.enum([
    READ_ARTIFACT_OPERATION_NAME
]);

export const AgentExecutionReadArtifactOperationInputSchema = z.object({
    path: z.string().trim().min(1),
    eventId: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionSemanticOperationPayloadSchema = z.discriminatedUnion('name', [
    z.object({
        name: z.literal(READ_ARTIFACT_OPERATION_NAME),
        input: AgentExecutionReadArtifactOperationInputSchema
    }).strict()
]);

export const AgentExecutionSemanticOperationInvocationSchema = z.discriminatedUnion('name', [
    z.object({
        agentExecutionId: z.string().trim().min(1),
        name: z.literal(READ_ARTIFACT_OPERATION_NAME),
        input: AgentExecutionReadArtifactOperationInputSchema
    }).strict()
]);

export const AgentExecutionReadArtifactOperationResultSchema = z.object({
    operationName: z.literal(READ_ARTIFACT_OPERATION_NAME),
    agentExecutionId: z.string().trim().min(1),
    eventId: z.string().trim().min(1),
    path: z.string().trim().min(1),
    content: z.string(),
    factType: z.literal('artifact-read')
}).strict();

export const AgentExecutionSemanticOperationResultSchema = z.discriminatedUnion('operationName', [
    AgentExecutionReadArtifactOperationResultSchema
]);

export type AgentExecutionSemanticOperationNameType = z.infer<typeof AgentExecutionSemanticOperationNameSchema>;
export type AgentExecutionReadArtifactOperationInputType = z.infer<typeof AgentExecutionReadArtifactOperationInputSchema>;
export type AgentExecutionSemanticOperationPayloadType = z.infer<typeof AgentExecutionSemanticOperationPayloadSchema>;
export type AgentExecutionSemanticOperationInvocationType = z.infer<typeof AgentExecutionSemanticOperationInvocationSchema>;
export type AgentExecutionReadArtifactOperationResultType = z.infer<typeof AgentExecutionReadArtifactOperationResultSchema>;
export type AgentExecutionSemanticOperationResultType = z.infer<typeof AgentExecutionSemanticOperationResultSchema>;