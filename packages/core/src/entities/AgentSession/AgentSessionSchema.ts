import { z } from 'zod/v4';
import {
    EntityCommandAcknowledgementSchema,
    EntityCommandDescriptorSchema
} from '../Entity/EntitySchema.js';

export const agentSessionEntityName = 'AgentSession' as const;

export const AgentSessionCommandIds = {
    complete: 'agentSession.complete',
    cancel: 'agentSession.cancel',
    terminate: 'agentSession.terminate'
} as const;

export const AgentSessionCommandIdSchema = z.enum([
    AgentSessionCommandIds.complete,
    AgentSessionCommandIds.cancel,
    AgentSessionCommandIds.terminate
]);

const agentSessionMetadataValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null()
]);

const agentSessionMetadataSchema = z.record(z.string(), agentSessionMetadataValueSchema);

export const AgentSessionPromptSchema = z.object({
    source: z.enum(['engine', 'operator', 'system']),
    text: z.string(),
    title: z.string().trim().min(1).optional(),
    metadata: agentSessionMetadataSchema.optional()
}).strict();

export const AgentSessionCommandSchema = z.discriminatedUnion('type', [
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

export const AgentSessionLocatorSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1)
}).strict();

export const AgentSessionEventSubjectSchema = AgentSessionLocatorSchema.extend({
    entity: z.literal(agentSessionEntityName)
}).strict();

export const AgentSessionExecuteCommandInputSchema = AgentSessionLocatorSchema.extend({
    commandId: AgentSessionCommandIdSchema,
    input: z.unknown().optional()
}).strict();

export const AgentSessionSendPromptInputSchema = AgentSessionLocatorSchema.extend({
    prompt: AgentSessionPromptSchema
}).strict();

export const AgentSessionSendCommandInputSchema = AgentSessionLocatorSchema.extend({
    command: AgentSessionCommandSchema
}).strict();

export const AgentSessionSendTerminalInputSchema = AgentSessionLocatorSchema.extend({
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

export const AgentSessionTerminalHandleSchema = z.object({
    sessionName: z.string().trim().min(1),
    paneId: z.string().trim().min(1),
    sharedSessionName: z.string().trim().min(1).optional()
}).strict();

export const AgentSessionTerminalRouteParamsSchema = z.object({
    sessionId: z.string().trim().min(1)
}).strict();

export const AgentSessionTerminalQuerySchema = z.object({
    missionId: z.string().trim().min(1)
}).strict();

export const AgentSessionTerminalInputSchema = z.object({
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

export const AgentSessionTerminalSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    terminalHandle: AgentSessionTerminalHandleSchema.optional()
}).strict();

export const AgentSessionTerminalSocketClientMessageSchema = z.discriminatedUnion('type', [
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

export const AgentSessionTerminalOutputSchema = z.object({
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: AgentSessionTerminalHandleSchema.optional()
}).strict();

export const AgentSessionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        snapshot: AgentSessionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('output'),
        output: AgentSessionTerminalOutputSchema
    }).strict(),
    z.object({
        type: z.literal('disconnected'),
        snapshot: AgentSessionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('error'),
        message: z.string().trim().min(1)
    }).strict()
]);

export type AgentSessionTerminalRouteParamsType = z.infer<typeof AgentSessionTerminalRouteParamsSchema>;
export type AgentSessionTerminalQueryType = z.infer<typeof AgentSessionTerminalQuerySchema>;
export type AgentSessionTerminalInputType = z.infer<typeof AgentSessionTerminalInputSchema>;
export type AgentSessionTerminalSnapshotType = z.infer<typeof AgentSessionTerminalSnapshotSchema>;
export type AgentSessionTerminalSocketClientMessageType = z.infer<typeof AgentSessionTerminalSocketClientMessageSchema>;
export type AgentSessionTerminalOutputType = z.infer<typeof AgentSessionTerminalOutputSchema>;
export type AgentSessionTerminalSocketServerMessageType = z.infer<typeof AgentSessionTerminalSocketServerMessageSchema>;

export const AgentSessionStorageSchema = z.object({
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
    terminalHandle: AgentSessionTerminalHandleSchema.optional(),
    assignmentLabel: z.string().trim().min(1).optional(),
    workingDirectory: z.string().trim().min(1).optional(),
    currentTurnTitle: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    scope: z.unknown().optional(),
    telemetry: z.unknown().optional(),
    failureMessage: z.string().trim().min(1).optional(),
    createdAt: z.string().trim().min(1).optional(),
    lastUpdatedAt: z.string().trim().min(1).optional()
}).strict();

export const AgentSessionDataSchema = z.object({
    ...AgentSessionStorageSchema.shape,
    commands: z.array(EntityCommandDescriptorSchema).optional()
}).strict();

export const AgentSessionCommandAcknowledgementSchema = EntityCommandAcknowledgementSchema.extend({
    entity: z.literal(agentSessionEntityName),
    method: z.enum(['executeCommand', 'sendPrompt', 'sendCommand']),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    commandId: AgentSessionCommandIdSchema.optional()
}).strict();

export const agentSessionRemoteQueryInputSchemas = {
    read: AgentSessionLocatorSchema,
    readTerminal: AgentSessionLocatorSchema
} as const;

export const agentSessionRemoteCommandInputSchemas = {
    executeCommand: AgentSessionExecuteCommandInputSchema,
    sendPrompt: AgentSessionSendPromptInputSchema,
    sendCommand: AgentSessionSendCommandInputSchema,
    sendTerminalInput: AgentSessionSendTerminalInputSchema
} as const;

export const agentSessionRemoteQueryResultSchemas = {
    read: AgentSessionDataSchema,
    readTerminal: AgentSessionTerminalSnapshotSchema
} as const;

export const agentSessionRemoteCommandResultSchemas = {
    executeCommand: AgentSessionCommandAcknowledgementSchema,
    sendPrompt: AgentSessionCommandAcknowledgementSchema,
    sendCommand: AgentSessionCommandAcknowledgementSchema,
    sendTerminalInput: AgentSessionTerminalSnapshotSchema
} as const;

export type AgentSessionLocatorType = z.infer<typeof AgentSessionLocatorSchema>;
export type AgentSessionEventSubjectType = z.infer<typeof AgentSessionEventSubjectSchema>;
export type AgentSessionCommandIdType = z.infer<typeof AgentSessionCommandIdSchema>;
export type AgentSessionExecuteCommandInputType = z.infer<typeof AgentSessionExecuteCommandInputSchema>;
export type AgentSessionSendPromptInputType = z.infer<typeof AgentSessionSendPromptInputSchema>;
export type AgentSessionSendCommandInputType = z.infer<typeof AgentSessionSendCommandInputSchema>;
export type AgentSessionSendTerminalInputType = z.infer<typeof AgentSessionSendTerminalInputSchema>;
export type AgentSessionPromptType = z.infer<typeof AgentSessionPromptSchema>;
export type AgentSessionCommandType = z.infer<typeof AgentSessionCommandSchema>;
export type AgentSessionTerminalHandleType = z.infer<typeof AgentSessionTerminalHandleSchema>;
export type AgentSessionStorageType = z.infer<typeof AgentSessionStorageSchema>;
export type AgentSessionDataType = z.infer<typeof AgentSessionDataSchema>;
export type AgentSessionCommandAcknowledgementType = z.infer<typeof AgentSessionCommandAcknowledgementSchema>;

