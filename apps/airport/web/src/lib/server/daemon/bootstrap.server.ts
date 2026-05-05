// /apps/airport/web/src/lib/server/daemon/bootstrap.server.ts: One-shot Airport startup check for daemon availability.
import {
    getMissionDaemonProcessStatus,
    resolveDefaultRuntimeFactoryModulePath,
    startMissionDaemonProcess,
    type DaemonRuntimeMode
} from '@flying-pillow/mission-core/daemon/runtime/DaemonProcessControl';
import { resolveSurfacePath } from './context.server';

let bootstrapAttempt: Promise<void> | undefined;

export function startMissionDaemonBootstrap(): Promise<void> | undefined {
    if (process.env['MISSION_AIRPORT_DAEMON_BOOTSTRAP']?.trim() === '0') {
        return undefined;
    }

    bootstrapAttempt ??= ensureMissionDaemonInBackground().catch((error) => {
        bootstrapAttempt = undefined;
        process.stderr.write(`Mission daemon bootstrap failed: ${formatError(error)}\n`);
    });
    return bootstrapAttempt;
}

async function ensureMissionDaemonInBackground(): Promise<void> {
    const status = await getMissionDaemonProcessStatus();
    if (status.running) {
        return;
    }

    const runtimeMode = resolveConfiguredRuntimeMode();
    const runtimeFactoryModulePath = resolveDefaultRuntimeFactoryModulePath(runtimeMode);
    await startMissionDaemonProcess({
        surfacePath: resolveSurfacePath(),
        runtimeMode,
        ...(runtimeFactoryModulePath ? { runtimeFactoryModulePath } : {})
    });
}

function resolveConfiguredRuntimeMode(): DaemonRuntimeMode {
    return process.env['MISSION_DAEMON_RUNTIME_MODE']?.trim() === 'source' ? 'source' : 'build';
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.stack ?? error.message : String(error);
}
