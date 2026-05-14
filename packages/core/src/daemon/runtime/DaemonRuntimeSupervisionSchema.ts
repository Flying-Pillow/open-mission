import { z } from 'zod/v4';

export const DaemonRuntimeOwnerReferenceSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('system'),
        label: z.string().trim().min(1),
    }).strict(),
    z.object({
        kind: z.literal('repository'),
        repositoryRootPath: z.string().trim().min(1),
    }).strict(),
    z.object({
        kind: z.literal('mission'),
        missionId: z.string().trim().min(1),
    }).strict(),
    z.object({
        kind: z.literal('task'),
        missionId: z.string().trim().min(1),
        taskId: z.string().trim().min(1),
        stageId: z.string().trim().min(1).optional(),
    }).strict(),
    z.object({
        kind: z.literal('agent-execution'),
        ownerId: z.string().trim().min(1),
        agentExecutionId: z.string().trim().min(1),
    }).strict(),
]).describe('Daemon-owned runtime owner identity used for cleanup, reconciliation, and ownership traversal.');

export const RuntimeLeaseKindSchema = z.enum([
    'terminal',
    'process',
    'socket',
    'provider-session',
]);

export const RuntimeLeaseStateSchema = z.enum([
    'active',
    'releasing',
    'released',
    'orphaned',
]);

export const DaemonRuntimeLeaseSchema = z.object({
    leaseId: z.string().trim().min(1),
    kind: RuntimeLeaseKindSchema,
    owner: DaemonRuntimeOwnerReferenceSchema,
    acquiredAt: z.string().trim().min(1),
    state: RuntimeLeaseStateSchema,
    processId: z.number().int().positive().optional(),
    processGroupId: z.number().int().positive().optional(),
    terminalName: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const DaemonRuntimeLeaseReferenceSchema = z.object({
    kind: z.literal('runtime-lease'),
    leaseId: z.string().trim().min(1),
}).strict();

export const DaemonRuntimeGraphNodeReferenceSchema = z.discriminatedUnion('kind', [
    DaemonRuntimeOwnerReferenceSchema,
    DaemonRuntimeLeaseReferenceSchema,
]);

export const DaemonRuntimeRelationshipSchema = z.object({
    parent: DaemonRuntimeOwnerReferenceSchema,
    child: DaemonRuntimeGraphNodeReferenceSchema,
    relationship: z.enum([
        'owns-agent-execution',
        'owns-runtime-lease',
        'owns-terminal-session',
        'owns-child-process',
    ]),
}).strict();

export const DaemonRuntimeSupervisionSnapshotSchema = z.object({
    daemonProcessId: z.number().int().positive(),
    startedAt: z.string().trim().min(1),
    owners: z.array(DaemonRuntimeOwnerReferenceSchema),
    relationships: z.array(DaemonRuntimeRelationshipSchema),
    leases: z.array(DaemonRuntimeLeaseSchema),
}).strict();

export type DaemonRuntimeOwnerReference = z.infer<typeof DaemonRuntimeOwnerReferenceSchema>;
export type DaemonRuntimeLeaseReference = z.infer<typeof DaemonRuntimeLeaseReferenceSchema>;
export type DaemonRuntimeGraphNodeReference = z.infer<typeof DaemonRuntimeGraphNodeReferenceSchema>;
export type RuntimeLeaseKind = z.infer<typeof RuntimeLeaseKindSchema>;
export type RuntimeLeaseState = z.infer<typeof RuntimeLeaseStateSchema>;
export type DaemonRuntimeLease = z.infer<typeof DaemonRuntimeLeaseSchema>;
export type DaemonRuntimeRelationship = z.infer<typeof DaemonRuntimeRelationshipSchema>;
export type DaemonRuntimeSupervisionSnapshot = z.infer<typeof DaemonRuntimeSupervisionSnapshotSchema>;