// /apps/web/src/lib/components/entities/System/System.svelte.ts: Browser-side entity for daemon system status and configuration.
import {
    systemConfigSchema,
    systemStateSchema,
    type SystemAgentSettingsType,
    type SystemConfig,
    type SystemConfigureType,
    type SystemState
} from '@flying-pillow/open-mission-core/entities/System/SystemSchema';
import { cmd } from '../../../../routes/api/entities/remote/command.remote';

export class System {
    private state = $state() as SystemState;

    public constructor(state: SystemState) {
        this.state = systemStateSchema.parse(state);
    }

    public get data(): SystemState {
        return structuredClone($state.snapshot(this.state));
    }

    public get sampledAt(): string {
        return this.state.sampledAt;
    }

    public get github(): SystemState['github'] {
        return structuredClone($state.snapshot(this.state.github));
    }

    public get config(): SystemConfig {
        return structuredClone($state.snapshot(this.state.config));
    }

    public get daemon(): SystemState['daemon'] {
        return structuredClone($state.snapshot(this.state.daemon));
    }

    public get host(): SystemState['host'] {
        return structuredClone($state.snapshot(this.state.host));
    }

    public get runtime(): SystemState['runtime'] {
        return structuredClone($state.snapshot(this.state.runtime));
    }

    public get diagnostics(): SystemState['diagnostics'] {
        return structuredClone($state.snapshot(this.state.diagnostics));
    }

    public applyData(state: SystemState): this {
        this.state = systemStateSchema.parse(state);
        return this;
    }

    public async configure(config: SystemConfigureType): Promise<this> {
        const nextConfig = await cmd({
            entity: 'System',
            method: 'configure',
            payload: config
        });
        this.applyData({
            ...this.data,
            config: systemConfigSchema.parse(nextConfig)
        });
        return this;
    }

    public async configureAgent(settings: SystemAgentSettingsType): Promise<this> {
        const config = await cmd({
            entity: 'System',
            method: 'configureAgent',
            payload: settings
        });
        this.applyData({
            ...this.data,
            config: systemConfigSchema.parse(config)
        });
        return this;
    }
}
