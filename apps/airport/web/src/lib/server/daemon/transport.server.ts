// /apps/airport/web/src/lib/server/daemon/transport.server.ts: Opens raw daemon connections for the Airport web server without adding web-specific policy.
import {
    connectAirportDaemon,
    type DaemonClient,
    resolveAirportDaemonRuntimeMode
} from '@flying-pillow/mission-core/node';

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
        runtimeMode: resolveAirportDaemonRuntimeMode(import.meta.url),
        allowStart: input.allowStart,
        ...(input.authToken ? { authToken: input.authToken } : {})
    });

    return {
        client,
        dispose: () => {
            client.dispose();
        }
    };
}