// /apps/airport/web/src/lib/server/gateway/AirportWebGateway.server.ts: Thin gateway that only exposes primary daemon and user system state to the web shell.
import type { SystemState } from '@flying-pillow/mission-core/system/SystemContract';
import type { AppContextServerValue } from '$lib/client/context/app-context.svelte';
import { readCachedDaemonSystemStatus } from '../daemon/health.server';

export type AirportSystemState = {
    appContext: AppContextServerValue;
    systemState?: SystemState;
};

export class AirportWebGateway {
    public constructor(private readonly locals?: App.Locals) { }

    public async getSystemState(): Promise<AirportSystemState> {
        return {
            appContext: this.getAppContext(),
            systemState: await readCachedDaemonSystemStatus({
                ...(this.locals ? { locals: this.locals } : {}),
            }),
        };
    }

    private getAppContext(): AppContextServerValue {
        return this.locals?.appContext ?? {
            daemon: {
                running: false,
                startedByHook: false,
                message: 'Mission daemon state is unavailable.',
                lastCheckedAt: new Date(0).toISOString(),
            },
            githubStatus: 'unknown',
        };
    }
}
