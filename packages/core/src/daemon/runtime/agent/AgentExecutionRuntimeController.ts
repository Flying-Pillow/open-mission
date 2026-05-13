import type { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import type {
    AgentCommand,
    AgentExecutionReference,
    AgentExecutionType,
    AgentLaunchConfig,
    AgentPrompt
} from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import type {
    AgentExecutionProtocolDescriptorType,
} from '../../../entities/AgentExecution/AgentExecutionProtocolSchema.js';
import type { AgentExecutionTransportStateType } from '../../../entities/AgentExecution/AgentExecutionStateSchema.js';
import type { SharedTerminalRegistryOptions } from '../../../entities/Terminal/TerminalRegistry.js';

export type AgentExecutionRuntimeController = {
    readonly execution: AgentExecution;
    submitPrompt(prompt: AgentPrompt): Promise<AgentExecutionType>;
    submitCommand(command: AgentCommand): Promise<AgentExecutionType>;
    complete(): Promise<AgentExecutionType>;
    cancel(reason?: string): Promise<AgentExecutionType>;
    terminate(reason?: string): Promise<AgentExecutionType>;
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