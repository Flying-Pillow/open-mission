import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntityCommandDescriptorSchema
} from '../Entity/EntitySchema.js';

export const agentSessionEntityName = 'AgentSession' as const;

const agentSessionMetadataValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null()
]);

const agentSessionMetadataSchema = z.record(z.string(), agentSessionMetadataValueSchema);

export const agentSessionPromptSchema = z.object({
    source: z.enum(['engine', 'operator', 'system']),
    text: z.string(),
    title: z.string().trim().min(1).optional(),
    metadata: agentSessionMetadataSchema.optional()
}).strict();

export const agentSessionCommandSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('interrupt'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentSessionMetadataSchema.optional()
    }).strict(),
    z.object({
        type: z.literal('checkpoint'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentSessionMetadataSchema.optional()
    }).strict(),
    z.object({
        type: z.literal('nudge'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentSessionMetadataSchema.optional()
    }).strict(),
    z.object({
        type: z.literal('resume'),
        reason: z.string().trim().min(1).optional(),
        metadata: agentSessionMetadataSchema.optional()
    }).strict()
]);

export const agentSessionIdentityPayloadSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1)
}).strict();

export const agentSessionEntityReferenceSchema = agentSessionIdentityPayloadSchema.extend({
    entity: z.literal(agentSessionEntityName)
}).strict();

export const agentSessionExecuteCommandPayloadSchema = agentSessionIdentityPayloadSchema.extend({
    commandId: z.string().trim().min(1),
    input: z.unknown().optional()
}).strict();

export const agentSessionSendPromptPayloadSchema = agentSessionIdentityPayloadSchema.extend({
    prompt: agentSessionPromptSchema
}).strict();

export const agentSessionSendCommandPayloadSchema = agentSessionIdentityPayloadSchema.extend({
    command: agentSessionCommandSchema
}).strict();

export const agentSessionReadTerminalPayloadSchema = agentSessionIdentityPayloadSchema;

export const agentSessionSendTerminalInputPayloadSchema = agentSessionIdentityPayloadSchema.extend({
    data: z.string().optional(),
    literal: z.boolean().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional()
}).strict().refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'AgentSession terminal input requires data or a complete cols/rows resize payload.'
});

export const agentSessionTerminalHandleSchema = z.object({
    sessionName: z.string().trim().min(1),
    paneId: z.string().trim().min(1),
    sharedSessionName: z.string().trim().min(1).optional()
}).strict();

export const agentSessionTerminalRouteParamsSchema = z.object({
    sessionId: z.string().trim().min(1)
}).strict();

export const agentSessionTerminalQuerySchema = z.object({
    missionId: z.string().trim().min(1)
}).strict();

export const agentSessionTerminalInputSchema = z.object({
    missionId: z.string().trim().min(1),
    data: z.string().optional(),
    literal: z.boolean().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional()
}).strict().refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'Agent session terminal input requires data or a complete cols/rows resize payload.'
});

export const agentSessionTerminalSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    terminalHandle: agentSessionTerminalHandleSchema.optional()
}).strict();

export const agentSessionTerminalSocketClientMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('input'),
        data: z.string(),
        literal: z.boolean().optional()
    }).strict(),
    z.object({
        type: z.literal('resize'),
        cols: z.number().int().positive(),
        rows: z.number().int().positive()
    }).strict()
]);

export const agentSessionTerminalOutputSchema = z.object({
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: agentSessionTerminalHandleSchema.optional()
}).strict();

export const agentSessionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        snapshot: agentSessionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('output'),
        output: agentSessionTerminalOutputSchema
    }).strict(),
    z.object({
        type: z.literal('disconnected'),
        snapshot: agentSessionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('error'),
        message: z.string().trim().min(1)
    }).strict()
]);

export type AgentSessionTerminalRouteParams = z.infer<typeof agentSessionTerminalRouteParamsSchema>;
export type AgentSessionTerminalQuery = z.infer<typeof agentSessionTerminalQuerySchema>;
export type AgentSessionTerminalInput = z.infer<typeof agentSessionTerminalInputSchema>;
export type AgentSessionTerminalSnapshot = z.infer<typeof agentSessionTerminalSnapshotSchema>;
export type AgentSessionTerminalSocketClientMessage = z.infer<typeof agentSessionTerminalSocketClientMessageSchema>;
export type AgentSessionTerminalOutput = z.infer<typeof agentSessionTerminalOutputSchema>;
export type AgentSessionTerminalSocketServerMessage = z.infer<typeof agentSessionTerminalSocketServerMessageSchema>;

export const agentSessionSnapshotSchema = z.object({
    sessionId: z.string().trim().min(1),
    runnerId: z.string().trim().min(1),
    transportId: z.string().trim().min(1).optional(),
    runnerLabel: z.string().trim().min(1),
    sessionLogPath: z.string().trim().min(1).optional(),
    lifecycleState: z.enum([
        'starting',
        'running',
        'awaiting-input',
        'completed',
        'failed',
        'cancelled',
        'terminated'
    ]),
    terminalSessionName: z.string().trim().min(1).optional(),
    terminalPaneId: z.string().trim().min(1).optional(),
    terminalHandle: agentSessionTerminalHandleSchema.optional(),
    assignmentLabel: z.string().trim().min(1).optional(),
    workingDirectory: z.string().trim().min(1).optional(),
    currentTurnTitle: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    scope: z.unknown().optional(),
    telemetry: z.unknown().optional(),
    failureMessage: z.string().trim().min(1).optional(),
    createdAt: z.string().trim().min(1).optional(),
    lastUpdatedAt: z.string().trim().min(1).optional(),
    commands: z.array(EntityCommandDescriptorSchema).optional()
}).strict();

export const agentSessionCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(agentSessionEntityName),
    method: z.enum(['executeCommand', 'sendPrompt', 'sendCommand']),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    commandId: z.string().trim().min(1).optional()
}).strict();

export const agentSessionRemoteQueryPayloadSchemas = {
    read: agentSessionIdentityPayloadSchema,
    readTerminal: agentSessionReadTerminalPayloadSchema
} as const;

export const agentSessionRemoteCommandPayloadSchemas = {
    executeCommand: agentSessionExecuteCommandPayloadSchema,
    sendPrompt: agentSessionSendPromptPayloadSchema,
    sendCommand: agentSessionSendCommandPayloadSchema,
    sendTerminalInput: agentSessionSendTerminalInputPayloadSchema
} as const;

export const agentSessionRemoteQueryResultSchemas = {
    read: agentSessionSnapshotSchema,
    readTerminal: agentSessionTerminalSnapshotSchema
} as const;

export const agentSessionRemoteCommandResultSchemas = {
    executeCommand: agentSessionCommandAcknowledgementSchema,
    sendPrompt: agentSessionCommandAcknowledgementSchema,
    sendCommand: agentSessionCommandAcknowledgementSchema,
    sendTerminalInput: agentSessionTerminalSnapshotSchema
} as const;

export type AgentSessionIdentityPayload = z.infer<typeof agentSessionIdentityPayloadSchema>;
export type AgentSessionEntityReference = z.infer<typeof agentSessionEntityReferenceSchema>;
export type AgentSessionExecuteCommandPayload = z.infer<typeof agentSessionExecuteCommandPayloadSchema>;
export type AgentSessionSendPromptPayload = z.infer<typeof agentSessionSendPromptPayloadSchema>;
export type AgentSessionSendCommandPayload = z.infer<typeof agentSessionSendCommandPayloadSchema>;
export type AgentSessionReadTerminalPayload = z.infer<typeof agentSessionReadTerminalPayloadSchema>;
export type AgentSessionSendTerminalInputPayload = z.infer<typeof agentSessionSendTerminalInputPayloadSchema>;
export type AgentSessionPrompt = z.infer<typeof agentSessionPromptSchema>;
export type AgentSessionCommand = z.infer<typeof agentSessionCommandSchema>;
export type AgentSessionTerminalHandle = z.infer<typeof agentSessionTerminalHandleSchema>;
export type AgentSessionSnapshot = z.infer<typeof agentSessionSnapshotSchema>;
export type AgentSessionCommandAcknowledgement = z.infer<typeof agentSessionCommandAcknowledgementSchema>;

