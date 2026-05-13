// /apps/web/src/lib/server/daemon/bootstrap.server.ts: One-shot Open Mission startup check for daemon availability.
import {
    getOpenMissionDaemonProcessStatus,
    startOpenMissionDaemonProcess,
    type DaemonRuntimeMode
} from '@flying-pillow/open-mission-core/daemon/runtime/DaemonProcessControl';
import { resolveSurfacePath } from './context.server';

let bootstrapAttempt: Promise<void> | undefined;

export function startOpenMissionDaemonBootstrap(): Promise<void> | undefined {
    if (process.env['OPEN_MISSION_DAEMON_BOOTSTRAP']?.trim() === '0') {
        return undefined;
    }

    bootstrapAttempt ??= ensureOpenMissionDaemonInBackground().catch((error) => {
        bootstrapAttempt = undefined;
        process.stderr.write(`Open Mission daemon bootstrap failed: ${formatError(error)}\n`);
    });
    return bootstrapAttempt;
}

async function ensureOpenMissionDaemonInBackground(): Promise<void> {
    const status = await getOpenMissionDaemonProcessStatus();
    if (status.running) {
        return;
    }

    const runtimeMode = resolveConfiguredRuntimeMode();
    await startOpenMissionDaemonProcess({
        surfacePath: resolveSurfacePath(),
        runtimeMode
    });
}

function resolveConfiguredRuntimeMode(): DaemonRuntimeMode {
    return process.env['OPEN_MISSION_DAEMON_RUNTIME_MODE']?.trim() === 'source' ? 'source' : 'build';
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.stack ?? error.message : String(error);
}
