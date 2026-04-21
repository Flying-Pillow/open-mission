// /apps/airport/web/src/lib/server/daemon/transport.server.ts: Opens raw daemon connections for the Airport web server without adding web-specific policy.
import {
    connectAirportControl,
    type DaemonClient,
    resolveAirportControlRuntimeMode
} from '@flying-pillow/mission-core/node';

export async function openDaemonConnection(input: {
    surfacePath: string;
    allowStart: boolean;
    authToken?: string;
}): Promise<{
    client: DaemonClient;
    dispose: () => void;
}> {
    const client = await connectAirportControl({
        surfacePath: input.surfacePath,
        runtimeMode: resolveAirportControlRuntimeMode(import.meta.url),
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