// /apps/airport/web/src/lib/server/daemon/transport.server.ts: Opens raw daemon connections for the Airport web server without adding web-specific policy.
import {
    connectAirportDaemon,
    type DaemonClient,
    resolveAirportDaemonRuntimeMode
} from '@flying-pillow/mission-core/node';

function resolveDaemonAutoStart(allowStart: boolean): boolean {
    const supervisedDaemon = process.env['MISSION_DAEMON_SUPERVISED']?.trim();
    if (supervisedDaemon === '1' || supervisedDaemon === 'true') {
        return false;
    }

    return allowStart;
}

function resolveWebDaemonRuntimeMode(): 'source' | 'build' {
    if (process.env['NODE_ENV'] !== 'production') {
        return 'source';
    }

    return resolveAirportDaemonRuntimeMode(import.meta.url);
}

export async function openDaemonConnection(input: {
    surfacePath: string;
    allowStart: boolean;
    authToken?: string;
}): Promise<{
    client: DaemonClient;
    dispose: () => void;
}> {
    const client = await connectAirportDaemon({
        surfacePath: input.surfacePath,
        runtimeMode: resolveWebDaemonRuntimeMode(),
        allowStart: resolveDaemonAutoStart(input.allowStart),
        ...(input.authToken ? { authToken: input.authToken } : {})
    });

    return {
        client,
        dispose: () => {
            client.dispose();
        }
    };
}