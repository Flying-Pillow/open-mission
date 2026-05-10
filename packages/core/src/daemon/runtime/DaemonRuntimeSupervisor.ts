import { TerminalRegistry } from '../../entities/Terminal/TerminalRegistry.js';
import type { DaemonRuntimeSupervisionSnapshot } from './DaemonRuntimeSupervisionSchema.js';

export type DaemonRuntimeSupervisorOptions = {
    daemonProcessId: number;
    startedAt: string;
    terminalRegistry: TerminalRegistry;
};

export class DaemonRuntimeSupervisor {
    private readonly daemonProcessId: number;
    private readonly startedAt: string;
    private readonly terminalRegistry: TerminalRegistry;

    public constructor(options: DaemonRuntimeSupervisorOptions) {
        this.daemonProcessId = options.daemonProcessId;
        this.startedAt = options.startedAt;
        this.terminalRegistry = options.terminalRegistry;
    }

    public readSnapshot(): DaemonRuntimeSupervisionSnapshot {
        return this.terminalRegistry.readRuntimeSupervisionSnapshot({
            daemonProcessId: this.daemonProcessId,
            startedAt: this.startedAt
        });
    }

    public async releaseAll(): Promise<void> {
        await this.terminalRegistry.dispose();
    }
}