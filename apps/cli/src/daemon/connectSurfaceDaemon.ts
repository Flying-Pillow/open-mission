import * as fs from 'node:fs';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
    DaemonClient,
    PROTOCOL_VERSION,
    type Ping
} from '@flying-pillow/mission-core';
import {
    startMissionDaemon,
    stopMissionDaemon,
    type MissionDaemonLaunchMode
} from '../commands/daemonControl.js';

export type ConnectSurfaceDaemonOptions = {
    surfacePath: string;
    startupTimeoutMs?: number;
    launchMode?: MissionDaemonLaunchMode;
    runtimeFactoryModulePath?: string;
    logLine?: (line: string) => void;
};

class IncompatibleDaemonError extends Error {
    public constructor(
        public readonly pid: number | undefined,
        public readonly protocolVersion: number | undefined
    ) {
        super(
            `Mission daemon protocol ${String(protocolVersion ?? 'unknown')} is incompatible with client protocol ${String(PROTOCOL_VERSION)}.`
        );
        this.name = 'IncompatibleDaemonError';
    }
}

export function resolveSurfaceDaemonLaunchMode(
    moduleUrl: string | URL
): MissionDaemonLaunchMode {
    const modulePath = fileURLToPath(moduleUrl);
    return modulePath.includes(`${path.sep}src${path.sep}`) ? 'source' : 'build';
}

export async function connectSurfaceDaemon(
    options: ConnectSurfaceDaemonOptions
): Promise<DaemonClient> {
    const runtimeFactoryModulePath =
        options.runtimeFactoryModulePath ?? resolveDefaultRuntimeFactoryModulePath();

    try {
        return await connectCompatibleDaemon(options.surfacePath);
    } catch (error) {
        await restartIncompatibleDaemon(error, options.logLine);
    }

    await startMissionDaemon({
        surfacePath: options.surfacePath,
        ...(options.launchMode ? { launchMode: options.launchMode } : {}),
        ...(runtimeFactoryModulePath ? { runtimeFactoryModulePath } : {})
    });

    const timeoutAt = Date.now() + (options.startupTimeoutMs ?? 15_000);
    let lastError: Error | undefined;
    while (Date.now() < timeoutAt) {
        try {
            return await connectCompatibleDaemon(options.surfacePath);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            await restartIncompatibleDaemon(error, options.logLine);
            await delay(150);
        }
    }

    throw new Error(
        lastError
            ? `Mission daemon did not become ready: ${lastError.message}`
            : 'Mission daemon did not become ready.'
    );
}

async function connectCompatibleDaemon(surfacePath: string): Promise<DaemonClient> {
    const client = new DaemonClient();
    try {
        await client.connect({ surfacePath });
        const ping = await client.request<Ping>('ping');
        if (ping.protocolVersion !== PROTOCOL_VERSION) {
            throw new IncompatibleDaemonError(ping.pid, ping.protocolVersion);
        }
        return client;
    } catch (error) {
        client.dispose();
        throw error;
    }
}

async function restartIncompatibleDaemon(
    error: unknown,
    logLine?: (line: string) => void
): Promise<void> {
    if (!(error instanceof IncompatibleDaemonError)) {
        return;
    }

    logLine?.(
        `Stopping incompatible Mission daemon pid=${String(error.pid ?? 'unknown')} protocol=${String(error.protocolVersion ?? 'unknown')}.`
    );
    await stopMissionDaemon();
}

function resolveDefaultRuntimeFactoryModulePath(): string | undefined {
    const currentFilePath = fileURLToPath(import.meta.url);
    const packageRoot = path.resolve(path.dirname(currentFilePath), '..', '..');
    const workspaceRoot = path.resolve(packageRoot, '..', '..');
    const sourcePath = path.join(workspaceRoot, 'packages', 'adapters', 'src', 'index.ts');
    const buildPath = path.join(workspaceRoot, 'packages', 'adapters', 'build', 'index.js');

    if (currentFilePath.includes(`${path.sep}src${path.sep}`) && fs.existsSync(sourcePath)) {
        return sourcePath;
    }

    if (fs.existsSync(buildPath)) {
        return buildPath;
    }

    if (fs.existsSync(sourcePath)) {
        return sourcePath;
    }

    return undefined;
}