import { z } from 'zod/v4';
import {
    entityCommandAcknowledgementSchema,
    entityCommandListSnapshotSchema
} from './EntityRemote.js';

export const missionAgentSessionEntityName = 'AgentSession' as const;
export const agentSessionEntityName = missionAgentSessionEntityName;

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

export const missionAgentPromptSchema = agentSessionPromptSchema;

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

export const missionAgentCommandSchema = agentSessionCommandSchema;

export const agentSessionIdentityPayloadSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1)
}).strict();

export const agentSessionEntityReferenceSchema = agentSessionIdentityPayloadSchema.extend({
    entity: z.literal(missionAgentSessionEntityName)
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

export const missionAgentSessionTerminalHandleSchema = z.object({
    sessionName: z.string().trim().min(1),
    paneId: z.string().trim().min(1),
    sharedSessionName: z.string().trim().min(1).optional()
}).strict();

export const agentSessionTerminalHandleSchema = missionAgentSessionTerminalHandleSchema;

export const missionAgentSessionSnapshotSchema = z.object({
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
    terminalHandle: missionAgentSessionTerminalHandleSchema.optional(),
    assignmentLabel: z.string().trim().min(1).optional(),
    workingDirectory: z.string().trim().min(1).optional(),
    currentTurnTitle: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    createdAt: z.string().trim().min(1).optional(),
    lastUpdatedAt: z.string().trim().min(1).optional()
}).strict();

export const agentSessionSnapshotSchema = missionAgentSessionSnapshotSchema;

export const agentSessionCommandListSnapshotSchema = entityCommandListSnapshotSchema.extend({
    entity: z.literal(missionAgentSessionEntityName),
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1)
}).strict();

export const agentSessionCommandAcknowledgementSchema = entityCommandAcknowledgementSchema.extend({
    entity: z.literal(missionAgentSessionEntityName),
    method: z.enum(['executeCommand', 'sendPrompt', 'sendCommand']),
    id: z.string().trim().min(1),
    missionId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    commandId: z.string().trim().min(1).optional()
}).strict();

export const agentSessionRemoteQueryPayloadSchemas = {
    read: agentSessionIdentityPayloadSchema,
    listCommands: agentSessionIdentityPayloadSchema
} as const;

export const agentSessionRemoteCommandPayloadSchemas = {
    executeCommand: agentSessionExecuteCommandPayloadSchema,
    sendPrompt: agentSessionSendPromptPayloadSchema,
    sendCommand: agentSessionSendCommandPayloadSchema
} as const;

export const agentSessionRemoteQueryResultSchemas = {
    read: missionAgentSessionSnapshotSchema,
    listCommands: agentSessionCommandListSnapshotSchema
} as const;

export const agentSessionRemoteCommandResultSchemas = {
    executeCommand: agentSessionCommandAcknowledgementSchema,
    sendPrompt: agentSessionCommandAcknowledgementSchema,
    sendCommand: agentSessionCommandAcknowledgementSchema
} as const;

export type AgentSessionIdentityPayload = z.infer<typeof agentSessionIdentityPayloadSchema>;
export type AgentSessionEntityReference = z.infer<typeof agentSessionEntityReferenceSchema>;
export type AgentSessionExecuteCommandPayload = z.infer<typeof agentSessionExecuteCommandPayloadSchema>;
export type AgentSessionSendPromptPayload = z.infer<typeof agentSessionSendPromptPayloadSchema>;
export type AgentSessionSendCommandPayload = z.infer<typeof agentSessionSendCommandPayloadSchema>;
export type AgentSessionPrompt = z.infer<typeof agentSessionPromptSchema>;
export type MissionAgentPrompt = AgentSessionPrompt;
export type AgentSessionCommand = z.infer<typeof agentSessionCommandSchema>;
export type MissionAgentCommand = AgentSessionCommand;
export type MissionAgentSessionTerminalHandle = z.infer<typeof missionAgentSessionTerminalHandleSchema>;
export type AgentSessionTerminalHandle = z.infer<typeof agentSessionTerminalHandleSchema>;
export type MissionAgentSessionSnapshot = z.infer<typeof missionAgentSessionSnapshotSchema>;
export type AgentSessionSnapshot = z.infer<typeof agentSessionSnapshotSchema>;
export type AgentSessionCommandListSnapshot = z.infer<typeof agentSessionCommandListSnapshotSchema>;
export type AgentSessionCommandAcknowledgement = z.infer<typeof agentSessionCommandAcknowledgementSchema>;
