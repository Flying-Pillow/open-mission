import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    DaemonRuntimeLease,
    DaemonRuntimeOwnerReference,
    DaemonRuntimeRelationship,
    DaemonRuntimeSupervisionSnapshot,
    RuntimeLeaseState
} from '../runtime/DaemonRuntimeSupervisionSchema.js';
import {
    ImpeccableLiveResolveParamsSchema,
    type ImpeccableLiveResolveParamsType,
    ImpeccableLiveSessionSchema,
    type ImpeccableLiveSessionType,
    readPersistedImpeccableLiveServerInfo,
    resolveImpeccableLiveSurfacePath
} from './ImpeccableLiveSession.js';

type ManagedImpeccableLiveEntry = {
    leaseId: string;
    owner: DaemonRuntimeOwnerReference;
    surfacePath: string;
    acquiredAt: string;
    processId: number;
    processGroupId?: number;
    origin: string;
    launchMode: 'adopted' | 'daemon-started';
};

type ImpeccableLiveRegistryOptions = {
    daemonProcessId: number;
    startedAt: string;
    startupTimeoutMs?: number;
    pollIntervalMs?: number;
    spawnProcess?: typeof spawn;
    readPersistedServerInfo?: typeof readPersistedImpeccableLiveServerInfo;
    resolveSurfacePath?: typeof resolveImpeccableLiveSurfacePath;
    isProcessRunning?: (processId: number) => boolean;
    waitMs?: (ms: number) => Promise<void>;
    liveServerScriptPath?: string;
};

const DEFAULT_STARTUP_TIMEOUT_MS = 12_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

export type ImpeccableLiveStopResultType = {
    stopped: boolean;
};

export class ImpeccableLiveRegistry {
    private readonly daemonProcessId: number;
    private readonly startedAt: string;
    private readonly startupTimeoutMs: number;
    private readonly pollIntervalMs: number;
    private readonly spawnProcess: typeof spawn;
    private readonly readPersistedServerInfo: typeof readPersistedImpeccableLiveServerInfo;
    private readonly resolveSurfacePath: typeof resolveImpeccableLiveSurfacePath;
    private readonly isProcessRunning: (processId: number) => boolean;
    private readonly waitMs: (ms: number) => Promise<void>;
    private readonly liveServerScriptPath: string;
    private readonly entriesByOwnerKey = new Map<string, ManagedImpeccableLiveEntry>();
    private readonly inFlightEnsures = new Map<string, Promise<ImpeccableLiveSessionType>>();

    public constructor(options: ImpeccableLiveRegistryOptions) {
        this.daemonProcessId = options.daemonProcessId;
        this.startedAt = options.startedAt;
        this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
        this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.spawnProcess = options.spawnProcess ?? spawn;
        this.readPersistedServerInfo = options.readPersistedServerInfo ?? readPersistedImpeccableLiveServerInfo;
        this.resolveSurfacePath = options.resolveSurfacePath ?? resolveImpeccableLiveSurfacePath;
        this.isProcessRunning = options.isProcessRunning ?? defaultIsProcessRunning;
        this.waitMs = options.waitMs ?? defaultWaitMs;
        this.liveServerScriptPath = options.liveServerScriptPath ?? resolveImpeccableLiveServerScriptPath();
    }

    public async ensureSession(input: { params: unknown }): Promise<ImpeccableLiveSessionType> {
        const selector = ImpeccableLiveResolveParamsSchema.parse(input.params);
        const ownerKey = selector.repositoryId
            ? `repository:${selector.repositoryId}`
            : `mission:${selector.missionId}`;
        const inFlight = this.inFlightEnsures.get(ownerKey);
        if (inFlight) {
            return inFlight;
        }

        const ensurePromise = this.ensureSessionInternal(selector)
            .finally(() => {
                this.inFlightEnsures.delete(ownerKey);
            });
        this.inFlightEnsures.set(ownerKey, ensurePromise);
        return ensurePromise;
    }

    public async stopSession(input: { params: unknown }): Promise<ImpeccableLiveStopResultType> {
        const selector = ImpeccableLiveResolveParamsSchema.parse(input.params);
        const ownerKey = selector.repositoryId
            ? `repository:${selector.repositoryId}`
            : `mission:${selector.missionId}`;
        const inFlight = this.inFlightEnsures.get(ownerKey);
        if (inFlight) {
            await inFlight.catch(() => undefined);
        }

        return this.stopSessionInternal(selector);
    }

    public readRuntimeSnapshot(): DaemonRuntimeSupervisionSnapshot {
        const owners = new Map<string, DaemonRuntimeOwnerReference>();
        const relationships: DaemonRuntimeRelationship[] = [];
        const leases: DaemonRuntimeLease[] = [];

        for (const entry of this.entriesByOwnerKey.values()) {
            owners.set(stableRuntimeOwnerKey(entry.owner), cloneOwner(entry.owner));
            const state: RuntimeLeaseState = this.isProcessRunning(entry.processId) ? 'active' : 'orphaned';
            relationships.push({
                parent: cloneOwner(entry.owner),
                child: {
                    kind: 'runtime-lease',
                    leaseId: entry.leaseId
                },
                relationship: 'owns-runtime-lease'
            });
            leases.push({
                leaseId: entry.leaseId,
                kind: 'process',
                owner: cloneOwner(entry.owner),
                acquiredAt: entry.acquiredAt,
                state,
                processId: entry.processId,
                ...(entry.processGroupId ? { processGroupId: entry.processGroupId } : {}),
                metadata: {
                    origin: entry.origin,
                    surfacePath: entry.surfacePath,
                    launchMode: entry.launchMode
                }
            });
        }

        return {
            daemonProcessId: this.daemonProcessId,
            startedAt: this.startedAt,
            owners: [...owners.values()],
            relationships,
            leases
        };
    }

    public async dispose(): Promise<void> {
        for (const entry of this.entriesByOwnerKey.values()) {
            await terminateManagedProcess(entry, this.isProcessRunning);
        }
        this.entriesByOwnerKey.clear();
        this.inFlightEnsures.clear();
    }

    private async ensureSessionInternal(selector: ImpeccableLiveResolveParamsType): Promise<ImpeccableLiveSessionType> {
        const params = selector.repositoryId
            ? { repositoryId: selector.repositoryId }
            : { missionId: selector.missionId as string };
        const surfacePath = await this.resolveSurfacePath({ params });
        const owner = selector.repositoryId
            ? { kind: 'repository', repositoryRootPath: surfacePath } satisfies DaemonRuntimeOwnerReference
            : { kind: 'mission', missionId: selector.missionId as string } satisfies DaemonRuntimeOwnerReference;
        const ownerKey = stableRuntimeOwnerKey(owner);
        const tracked = this.entriesByOwnerKey.get(ownerKey);
        if (tracked && this.isProcessRunning(tracked.processId)) {
            return ImpeccableLiveSessionSchema.parse({ origin: tracked.origin });
        }
        if (tracked) {
            this.entriesByOwnerKey.delete(ownerKey);
        }

        const persisted = await this.readPersistedServerInfo(surfacePath);
        if (persisted && this.isProcessRunning(persisted.pid)) {
            const adopted = this.createEntry({
                owner,
                surfacePath,
                processId: persisted.pid,
                origin: persisted.origin,
                launchMode: 'adopted'
            });
            this.entriesByOwnerKey.set(ownerKey, adopted);
            return ImpeccableLiveSessionSchema.parse({ origin: persisted.origin });
        }

        const child = this.spawnProcess(process.execPath, [this.liveServerScriptPath], {
            cwd: surfacePath,
            detached: process.platform !== 'win32',
            stdio: 'ignore',
            windowsHide: true,
            env: {
                ...process.env,
                IMPECCABLE_LIVE_HOST: '127.0.0.1'
            }
        });
        if (!child.pid) {
            throw new Error(`Failed to start Impeccable live server for '${surfacePath}'.`);
        }
        child.unref();

        try {
            const session = await this.waitForLiveServerSession({ surfacePath, processId: child.pid });
            const managed = this.createEntry({
                owner,
                surfacePath,
                processId: child.pid,
                ...(process.platform === 'win32' ? {} : { processGroupId: child.pid }),
                origin: session.origin,
                launchMode: 'daemon-started'
            });
            this.entriesByOwnerKey.set(ownerKey, managed);
            return session;
        } catch (error) {
            await terminateManagedProcess({
                processId: child.pid,
                ...(process.platform === 'win32' ? {} : { processGroupId: child.pid })
            }, this.isProcessRunning);
            throw error;
        }
    }

    private async waitForLiveServerSession(input: { surfacePath: string; processId: number }): Promise<ImpeccableLiveSessionType> {
        const deadline = Date.now() + this.startupTimeoutMs;
        while (Date.now() < deadline) {
            const persisted = await this.readPersistedServerInfo(input.surfacePath);
            if (persisted && persisted.pid === input.processId && this.isProcessRunning(persisted.pid)) {
                return ImpeccableLiveSessionSchema.parse({ origin: persisted.origin });
            }
            if (!this.isProcessRunning(input.processId)) {
                throw new Error(`Impeccable live server exited before becoming ready for '${input.surfacePath}'.`);
            }
            await this.waitMs(this.pollIntervalMs);
        }

        throw new Error(`Impeccable live server did not become ready for '${input.surfacePath}'.`);
    }

    private async stopSessionInternal(selector: ImpeccableLiveResolveParamsType): Promise<ImpeccableLiveStopResultType> {
        const params = selector.repositoryId
            ? { repositoryId: selector.repositoryId }
            : { missionId: selector.missionId as string };
        const surfacePath = await this.resolveSurfacePath({ params });
        const owner = selector.repositoryId
            ? { kind: 'repository', repositoryRootPath: surfacePath } satisfies DaemonRuntimeOwnerReference
            : { kind: 'mission', missionId: selector.missionId as string } satisfies DaemonRuntimeOwnerReference;
        const ownerKey = stableRuntimeOwnerKey(owner);
        const tracked = this.entriesByOwnerKey.get(ownerKey);
        if (tracked) {
            this.entriesByOwnerKey.delete(ownerKey);
            const stopped = await terminateManagedProcess(tracked, this.isProcessRunning);
            return { stopped };
        }

        const persisted = await this.readPersistedServerInfo(surfacePath);
        if (!persisted || !this.isProcessRunning(persisted.pid)) {
            return { stopped: false };
        }

        const stopped = await terminateManagedProcess({
            processId: persisted.pid,
        }, this.isProcessRunning);
        return { stopped };
    }

    private createEntry(input: {
        owner: DaemonRuntimeOwnerReference;
        surfacePath: string;
        processId: number;
        processGroupId?: number | undefined;
        origin: string;
        launchMode: ManagedImpeccableLiveEntry['launchMode'];
    }): ManagedImpeccableLiveEntry {
        return {
            leaseId: `impeccable-live:${stableRuntimeOwnerKey(input.owner)}`,
            owner: cloneOwner(input.owner),
            surfacePath: input.surfacePath,
            acquiredAt: new Date().toISOString(),
            processId: input.processId,
            ...(input.processGroupId ? { processGroupId: input.processGroupId } : {}),
            origin: input.origin,
            launchMode: input.launchMode
        };
    }
}

function resolveImpeccableLiveServerScriptPath(): string {
    const corePackageRoot = resolveCorePackageRoot();
    return path.resolve(corePackageRoot, '..', '..', '.agents', 'skills', 'impeccable', 'scripts', 'live-server.mjs');
}

function resolveCorePackageRoot(): string {
    try {
        const require = createRequire(import.meta.url);
        const resolvedPackageEntry = require.resolve('@flying-pillow/open-mission-core');
        return path.resolve(resolvedPackageEntry, '..', '..');
    } catch {
        const currentFilePath = fileURLToPath(import.meta.url);
        return path.resolve(path.dirname(currentFilePath), '..', '..');
    }
}

function stableRuntimeOwnerKey(owner: DaemonRuntimeOwnerReference): string {
    switch (owner.kind) {
        case 'system':
            return `system:${owner.label}`;
        case 'repository':
            return `repository:${owner.repositoryRootPath}`;
        case 'mission':
            return `mission:${owner.missionId}`;
        case 'task':
            return `task:${owner.missionId}:${owner.taskId}:${owner.stageId ?? ''}`;
        case 'agent-execution':
            return `agent-execution:${owner.ownerId}:${owner.agentExecutionId}`;
    }
}

function cloneOwner(owner: DaemonRuntimeOwnerReference): DaemonRuntimeOwnerReference {
    return { ...owner };
}

function defaultIsProcessRunning(processId: number): boolean {
    try {
        process.kill(processId, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

async function defaultWaitMs(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminateManagedProcess(
    entry: Pick<ManagedImpeccableLiveEntry, 'processId' | 'processGroupId'>,
    isProcessRunning: (processId: number) => boolean
): Promise<boolean> {
    if (!isProcessRunning(entry.processId)) {
        return false;
    }

    sendSignal(entry, 'SIGTERM');
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
        if (!isProcessRunning(entry.processId)) {
            return true;
        }
        await defaultWaitMs(50);
    }
    sendSignal(entry, 'SIGKILL');
    return true;
}

function sendSignal(entry: Pick<ManagedImpeccableLiveEntry, 'processId' | 'processGroupId'>, signal: NodeJS.Signals): void {
    try {
        if (entry.processGroupId && process.platform !== 'win32') {
            process.kill(-entry.processGroupId, signal);
            return;
        }
        process.kill(entry.processId, signal);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw error;
        }
    }
}