import { z } from 'zod/v4';

export const AgentExecutionTerminalRecordingPathSchema = z.string()
    .trim()
    .min(1)
    .refine((value) => /^terminal-recordings\/[^/]+\.terminal\.jsonl$/u.test(value), {
        message: 'AgentExecution terminal recordings must use terminal-recordings/<agentExecutionId>.terminal.jsonl.'
    });

export const AgentExecutionTerminalHandleSchema = z.object({
    terminalName: z.string().trim().min(1),
    terminalPaneId: z.string().trim().min(1),
    sharedTerminalName: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionTerminalTransportSchema = z.object({
    kind: z.literal('terminal'),
    terminalName: z.string().trim().min(1),
    terminalPaneId: z.string().trim().min(1).optional()
}).strict();

export const AgentExecutionReferenceSchema = z.object({
    agentId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
    processId: z.number().int().positive().optional(),
    transport: AgentExecutionTerminalTransportSchema.optional()
}).strict();

export const AgentExecutionTerminalRouteParamsSchema = z.object({
    agentExecutionId: z.string().trim().min(1)
}).strict();

export const AgentExecutionTerminalQuerySchema = z.object({
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1)
}).strict();

export const AgentExecutionTerminalRouteQuerySchema = z.object({
    ownerId: z.string().trim().min(1)
}).strict();

export const AgentExecutionTerminalRouteInputSchema = z.object({
    ownerId: z.string().trim().min(1),
    data: z.string().optional(),
    literal: z.boolean().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional()
}).strict().refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'Agent execution terminal input requires data or a complete cols/rows resize payload.'
});

export const AgentExecutionTerminalSchema = z.object({
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    recording: z.lazy(() => AgentExecutionTerminalRecordingSchema).optional(),
    terminalHandle: AgentExecutionTerminalHandleSchema.optional()
}).strict();

export const AgentExecutionTerminalRecordingHeaderEventSchema = z.object({
    type: z.literal('header'),
    version: z.literal(1),
    kind: z.literal('agent-execution-terminal-recording'),
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
    terminalName: z.string().trim().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    createdAt: z.string().trim().min(1)
}).strict();

export const AgentExecutionTerminalRecordingEventSchema = z.discriminatedUnion('type', [
    AgentExecutionTerminalRecordingHeaderEventSchema,
    z.object({
        type: z.literal('output'),
        at: z.string().trim().min(1),
        data: z.string()
    }).strict(),
    z.object({
        type: z.literal('input'),
        at: z.string().trim().min(1),
        data: z.string(),
        literal: z.boolean().optional()
    }).strict(),
    z.object({
        type: z.literal('resize'),
        at: z.string().trim().min(1),
        cols: z.number().int().positive(),
        rows: z.number().int().positive()
    }).strict(),
    z.object({
        type: z.literal('exit'),
        at: z.string().trim().min(1),
        exitCode: z.number().int().nullable()
    }).strict()
]);

export const AgentExecutionTerminalRecordingSchema = z.object({
    version: z.literal(1),
    events: z.array(AgentExecutionTerminalRecordingEventSchema)
}).strict().refine((value) => value.events[0]?.type === 'header', {
    message: 'Agent execution terminal recording requires a header event.'
});

export const AgentExecutionTerminalSocketClientMessageSchema = z.discriminatedUnion('type', [
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

export const AgentExecutionTerminalOutputSchema = z.object({
    ownerId: z.string().trim().min(1),
    agentExecutionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: AgentExecutionTerminalHandleSchema.optional()
}).strict();

export const AgentExecutionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('terminal'),
        terminal: AgentExecutionTerminalSchema
    }).strict(),
    z.object({
        type: z.literal('output'),
        output: AgentExecutionTerminalOutputSchema
    }).strict(),
    z.object({
        type: z.literal('disconnected'),
        terminal: AgentExecutionTerminalSchema
    }).strict(),
    z.object({
        type: z.literal('error'),
        message: z.string().trim().min(1)
    }).strict()
]);

export type AgentExecutionTerminalRouteParamsType = z.infer<typeof AgentExecutionTerminalRouteParamsSchema>;
export type AgentExecutionTerminalQueryType = z.infer<typeof AgentExecutionTerminalQuerySchema>;
export type AgentExecutionTerminalRouteInputType = z.infer<typeof AgentExecutionTerminalRouteInputSchema>;
export type AgentExecutionTerminalRecordingHeaderEventType = z.infer<typeof AgentExecutionTerminalRecordingHeaderEventSchema>;
export type AgentExecutionTerminalRecordingEventType = z.infer<typeof AgentExecutionTerminalRecordingEventSchema>;
export type AgentExecutionTerminalRecordingType = z.infer<typeof AgentExecutionTerminalRecordingSchema>;
export type AgentExecutionTerminalType = z.infer<typeof AgentExecutionTerminalSchema>;
export type AgentExecutionTerminalSocketClientMessageType = z.infer<typeof AgentExecutionTerminalSocketClientMessageSchema>;
export type AgentExecutionTerminalOutputType = z.infer<typeof AgentExecutionTerminalOutputSchema>;
export type AgentExecutionTerminalSocketServerMessageType = z.infer<typeof AgentExecutionTerminalSocketServerMessageSchema>;
export type AgentExecutionTerminalHandleType = z.infer<typeof AgentExecutionTerminalHandleSchema>;
export type AgentExecutionTerminalTransportType = z.infer<typeof AgentExecutionTerminalTransportSchema>;
export type AgentExecutionReferenceType = z.infer<typeof AgentExecutionReferenceSchema>;