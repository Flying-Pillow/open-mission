import { dev } from '$app/environment';
import { DaemonApi } from '@flying-pillow/mission-core/daemon/client/DaemonApi';
import type { EntityCommandInvocation, EntityFormInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/mission-core/entities/Entity/EntityRemote';
import {
    connectSharedAuthenticatedDaemonClient,
    isRecoverableDaemonConnectionError,
    resetSharedAuthenticatedDaemonClient
} from './connections.server';

const ENTITY_REQUEST_TIMEOUT_MS = 8_000;
const LONG_ENTITY_COMMAND_TIMEOUT_MS = 120_000;
const LONG_ENTITY_QUERY_TIMEOUT_MS = 120_000;
const DAEMON_CONNECT_TIMEOUT_MS = 12_000;
const SLOW_ENTITY_REMOTE_REQUEST_MS = 1_000;
const LONG_REPOSITORY_COMMAND_METHODS = new Set([
    'add',
    'ensureRepositoryAgentExecution',
    'ensureSystemAgentExecution',
    'indexCode',
    'setup',
    'startMissionFromIssue',
    'startMissionFromBrief'
]);

const LONG_REPOSITORY_QUERY_METHODS = new Set([
    'readCodeIntelligenceIndex'
]);

export class EntityProxy {
    public constructor(private readonly locals?: App.Locals) { }

    public async executeEntityQuery(input: EntityQueryInvocation): Promise<EntityRemoteResult> {
        const surfacePath = resolveInvocationSurfacePath(input);
        return this.executeWithReconnect(input, async () => {
            const daemon = await this.connectSharedDaemonClient(surfacePath);
            try {
                const api = new DaemonApi(daemon.client);
                return await withTimeout(
                    api.entity.query(input),
                    resolveEntityQueryTimeoutMs(input),
                    `Entity query '${input.method}' timed out.`
                );
            } finally {
                daemon.dispose();
            }
        }, surfacePath);
    }

    public async executeEntityCommand(input: EntityCommandInvocation | EntityFormInvocation): Promise<EntityRemoteResult> {
        const surfacePath = resolveInvocationSurfacePath(input);
        return this.executeWithReconnect(input, async () => {
            const daemon = await this.connectSharedDaemonClient(surfacePath);
            try {
                const api = new DaemonApi(daemon.client);
                return await withTimeout(
                    api.entity.command(input),
                    resolveEntityCommandTimeoutMs(input),
                    `Entity command '${input.method}' timed out.`
                );
            } finally {
                daemon.dispose();
            }
        }, surfacePath);
    }

    private async executeWithReconnect(
        input: EntityQueryInvocation | EntityCommandInvocation | EntityFormInvocation,
        operation: () => Promise<EntityRemoteResult>,
        surfacePath?: string
    ): Promise<EntityRemoteResult> {
        const startedAt = performance.now();
        let retried = false;
        try {
            return await operation();
        } catch (error) {
            if (!isRecoverableDaemonConnectionError(error)) {
                throw error;
            }
            retried = true;
            resetSharedAuthenticatedDaemonClient({
                locals: this.locals,
                ...(surfacePath ? { surfacePath } : {})
            });
            return operation();
        } finally {
            const durationMs = performance.now() - startedAt;
            if (dev && durationMs >= SLOW_ENTITY_REMOTE_REQUEST_MS) {
                console.warn('[airport-web] slow entity remote request', {
                    entity: input.entity,
                    method: input.method,
                    durationMs: Math.round(durationMs),
                    retried
                });
            }
        }
    }

    private async connectSharedDaemonClient(surfacePath?: string) {
        return withTimeout(
            connectSharedAuthenticatedDaemonClient({
                locals: this.locals,
                ...(surfacePath ? { surfacePath } : {})
            }),
            DAEMON_CONNECT_TIMEOUT_MS,
            'Mission daemon connection timed out.'
        );
    }
}

function resolveInvocationSurfacePath(input: EntityQueryInvocation | EntityCommandInvocation | EntityFormInvocation): string | undefined {
    const payload = isRecord(input.payload) ? input.payload : {};
    const repositoryRootPath = typeof payload['repositoryRootPath'] === 'string' && payload['repositoryRootPath'].trim()
        ? payload['repositoryRootPath'].trim()
        : undefined;
    if (repositoryRootPath) {
        return repositoryRootPath;
    }

    const ownerId = typeof payload['ownerId'] === 'string' && payload['ownerId'].trim()
        ? payload['ownerId'].trim()
        : undefined;
    if (input.entity === 'AgentExecution' && ownerId?.startsWith('/')) {
        return ownerId;
    }

    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveEntityCommandTimeoutMs(input: EntityCommandInvocation | EntityFormInvocation): number {
    if (input.entity === 'Repository' && LONG_REPOSITORY_COMMAND_METHODS.has(input.method)) {
        return LONG_ENTITY_COMMAND_TIMEOUT_MS;
    }

    return ENTITY_REQUEST_TIMEOUT_MS;
}

function resolveEntityQueryTimeoutMs(input: EntityQueryInvocation): number {
    if (input.entity === 'Repository' && LONG_REPOSITORY_QUERY_METHODS.has(input.method)) {
        return LONG_ENTITY_QUERY_TIMEOUT_MS;
    }

    return ENTITY_REQUEST_TIMEOUT_MS;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error(message));
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}