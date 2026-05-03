import { z } from 'zod/v4';
import { systemStateSchema } from '../system/SystemContract.js';

export const airportPaneIdSchema = z.enum(['tower', 'briefingRoom', 'runway']);

export const airportPaneBindingSchema = z.object({
    targetKind: z.enum(['empty', 'entity']),
    targetEntityId: z.string().trim().min(1).optional(),
    mode: z.enum(['view', 'control']).optional()
}).strict();

export const airportDaemonStatusSchema = z.object({
    available: z.boolean(),
    connected: z.boolean(),
    detail: z.string().trim().min(1).optional()
}).strict();

export const airportClientConnectionSchema = z.object({
    clientId: z.string().trim().min(1),
    label: z.string().trim().min(1).optional(),
    connected: z.boolean(),
    paneId: airportPaneIdSchema.optional()
}).strict();

export const airportApplicationSnapshotSchema = z.object({
    daemon: airportDaemonStatusSchema,
    system: systemStateSchema.optional(),
    clients: z.array(airportClientConnectionSchema),
    panes: z.object({
        tower: airportPaneBindingSchema.optional(),
        briefingRoom: airportPaneBindingSchema.optional(),
        runway: airportPaneBindingSchema.optional()
    }).strict().optional()
}).strict();

export type AirportApplicationPaneId = z.infer<typeof airportPaneIdSchema>;
export type AirportPaneBinding = z.infer<typeof airportPaneBindingSchema>;
export type AirportDaemonStatus = z.infer<typeof airportDaemonStatusSchema>;
export type AirportClientConnection = z.infer<typeof airportClientConnectionSchema>;
export type AirportApplicationSnapshot = z.infer<typeof airportApplicationSnapshotSchema>;
