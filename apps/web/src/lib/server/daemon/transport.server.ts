// /apps/web/src/lib/server/daemon/transport.server.ts: Opens raw daemon connections for the Open Mission web server without adding web-specific policy.
import type { DaemonClient } from '@flying-pillow/open-mission-core/daemon/client/DaemonClient';
import { connectDaemon } from '@flying-pillow/open-mission-core/daemon/client/connectDaemon';

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