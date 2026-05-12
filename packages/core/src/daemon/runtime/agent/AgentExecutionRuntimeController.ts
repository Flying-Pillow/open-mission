import type { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import type {
    AgentCommand,
    AgentExecutionReference,
    AgentExecutionSnapshot,
    AgentLaunchConfig,
    AgentPrompt
} from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import type {
    AgentExecutionProtocolDescriptorType,
} from '../../../entities/AgentExecution/AgentExecutionProtocolSchema.js';
import type { AgentExecutionTransportStateType } from '../../../entities/AgentExecution/AgentExecutionRuntimeSchema.js';
import type { SharedTerminalRegistryOptions } from '../../../entities/Terminal/TerminalRegistry.js';

export type AgentExecutionRuntimeController = {
    readonly execution: AgentExecution;
    submitPrompt(prompt: AgentPrompt): Promise<AgentExecutionSnapshot>;
    submitCommand(command: AgentCommand): Promise<AgentExecutionSnapshot>;
    complete(): Promise<AgentExecutionSnapshot>;
    cancel(reason?: string): Promise<AgentExecutionSnapshot>;
    terminate(reason?: string): Promise<AgentExecutionSnapshot>;
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