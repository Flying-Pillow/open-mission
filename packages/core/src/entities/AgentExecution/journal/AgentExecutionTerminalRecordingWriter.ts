import type { AgentExecutionType } from '../AgentExecutionSchema.js';

export class AgentExecutionTerminalRecordingWriter {
    public constructor(..._args: unknown[]) { }

    public reconcile(_executions: AgentExecutionType[]): void { }

    public update(_execution: AgentExecutionType): void { }

    public dispose(): void { }
}