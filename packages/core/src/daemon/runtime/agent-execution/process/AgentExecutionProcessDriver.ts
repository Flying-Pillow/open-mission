import type { AgentExecution } from '../../../../entities/AgentExecution/AgentExecution.js';
import type {
    AgentCommand,
    AgentExecutionReference,
    AgentExecutionProcess,
    AgentLaunchConfig,
    AgentPrompt
} from '../../../../entities/AgentExecution/protocol/AgentExecutionProtocolTypes.js';
import type {
    AgentExecutionProtocolDescriptorType,
} from '../../../../entities/AgentExecution/protocol/AgentExecutionProtocolSchema.js';
import type { AgentExecutionTransportStateType } from '../../../../entities/AgentExecution/AgentExecutionStateSchema.js';
import type { SharedTerminalRegistryOptions } from '../../../../entities/Terminal/TerminalRegistry.js';

export type AgentExecutionProcessDriver = {
    readonly execution: AgentExecution;
    submitPrompt(prompt: AgentPrompt): Promise<AgentExecutionProcess>;
    submitCommand(command: AgentCommand): Promise<AgentExecutionProcess>;
    complete(): Promise<AgentExecutionProcess>;
    cancel(reason?: string): Promise<AgentExecutionProcess>;
    terminate(reason?: string): Promise<AgentExecutionProcess>;
    dispose(): void;
};

export type AgentExecutionTerminalOptions = SharedTerminalRegistryOptions & {
    terminalPrefix?: string;
};

export type AgentExecutionLaunch = {
    command: string;
    args?: string[];
    stdin?: string;
    env?: NodeJS.ProcessEnv;
    agentExecutionId?: string;
    protocolDescriptor?: AgentExecutionProtocolDescriptorType;
    transportState?: AgentExecutionTransportStateType;
    terminalPrefix?: string;
    skipInitialPromptSubmission?: boolean;
};

export type AgentExecutionTerminalStartOptions = AgentExecutionTerminalOptions & {
    agentId: string;
    displayName: string;
    config: AgentLaunchConfig;
    launch: AgentExecutionLaunch;
};

export type AgentExecutionTerminalReconcileOptions = AgentExecutionTerminalOptions & {
    agentId: string;
    displayName: string;
    reference: AgentExecutionReference;
};

export function createAgentExecutionLiveOptions(launch: AgentExecutionLaunch): {
    protocolDescriptor?: AgentExecutionProtocolDescriptorType;
    transportState?: AgentExecutionTransportStateType;
} {
    return {
        ...(launch.protocolDescriptor ? { protocolDescriptor: launch.protocolDescriptor } : {}),
        ...(launch.transportState ? { transportState: launch.transportState } : {})
    };
}