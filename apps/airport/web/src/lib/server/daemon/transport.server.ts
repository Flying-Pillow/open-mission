// /apps/airport/web/src/lib/server/daemon/transport.server.ts: Opens raw daemon connections for the Airport web server without adding web-specific policy.
import type { DaemonClient } from '@flying-pillow/mission-core/daemon/client/DaemonClient';
import { connectDaemon } from '@flying-pillow/mission-core/daemon/client/connectAirportDaemon';

export async function openDaemonConnection(input: {
    surfacePath: string;
    authToken?: string;
}): Promise<{
    client: DaemonClient;
    dispose: () => void;
}> {
    const client = await connectDaemon({
        surfacePath: input.surfacePath,
        ...(input.authToken ? { authToken: input.authToken } : {})
    });

    return {
        client,
        dispose: () => {
            client.dispose();
        }
    };
}