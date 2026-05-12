import { z } from 'zod/v4';
import { TerminalHandleSchema } from './TerminalSchema.js';

export const MissionTerminalLocatorSchema = z.object({
    missionId: z.string().trim().min(1),
    repositoryRootPath: z.string().trim().min(1).optional()
}).strict();

export const MissionTerminalInputSchema = z.object({
    data: z.string().optional(),
    literal: z.boolean().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional()
}).strict().refine((value) => {
    const hasData = typeof value.data === 'string';
    const hasResize = value.cols !== undefined && value.rows !== undefined;
    return hasData || hasResize;
}, {
    message: 'Mission terminal input requires data or a complete cols/rows resize payload.'
});

export const MissionSendTerminalInputSchema = MissionTerminalLocatorSchema.extend({
    ...MissionTerminalInputSchema.shape
}).strict();

export const MissionTerminalSnapshotSchema = z.object({
    missionId: z.string().trim().min(1),
    connected: z.boolean(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    screen: z.string(),
    chunk: z.string().optional(),
    truncated: z.boolean().optional(),
    terminalHandle: TerminalHandleSchema.optional()
}).strict();

export const MissionTerminalSocketClientMessageSchema = z.discriminatedUnion('type', [
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

export const MissionTerminalOutputSchema = z.object({
    missionId: z.string().trim().min(1),
    chunk: z.string(),
    dead: z.boolean(),
    exitCode: z.number().int().nullable(),
    truncated: z.boolean().optional(),
    terminalHandle: TerminalHandleSchema.optional()
}).strict();

export const MissionTerminalSocketServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        snapshot: MissionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('output'),
        output: MissionTerminalOutputSchema
    }).strict(),
    z.object({
        type: z.literal('disconnected'),
        snapshot: MissionTerminalSnapshotSchema
    }).strict(),
    z.object({
        type: z.literal('error'),
        message: z.string().trim().min(1)
    }).strict()
]);

export type MissionTerminalInputType = z.infer<typeof MissionTerminalInputSchema>;
export type MissionSendTerminalInputType = z.infer<typeof MissionSendTerminalInputSchema>;
export type MissionTerminalSnapshotType = z.infer<typeof MissionTerminalSnapshotSchema>;
export type MissionTerminalSocketClientMessageType = z.infer<typeof MissionTerminalSocketClientMessageSchema>;
export type MissionTerminalOutputType = z.infer<typeof MissionTerminalOutputSchema>;
export type MissionTerminalSocketServerMessageType = z.infer<typeof MissionTerminalSocketServerMessageSchema>;