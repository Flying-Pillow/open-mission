import type {
    AgentCommand,
    AgentExecutionReference,
    AgentExecutionTerminalHandleType,
    AgentLaunchConfig,
    AgentPrompt
} from '../../../../entities/AgentExecution/AgentExecutionSchema.js';
import { AgentExecution } from '../../../../entities/AgentExecution/AgentExecution.js';
import { ManagedAgentExecution } from '../AgentExecutionRegistry.js';
import type {
    AgentAdapterDiagnosticsType,
    AgentCapabilityType,
    AgentIdType
} from '../../../../entities/Agent/AgentSchema.js';

export type AgentAdapterLaunchMode = 'interactive' | 'print';

export type AgentAdapterLaunchPlan = {
    mode: AgentAdapterLaunchMode;
    command: string;
    args: string[];
    env?: NodeJS.ProcessEnv;
};

export type AgentAdapterStartRequest = AgentLaunchConfig & {
    terminalName?: string | undefined;
    task?: {
        taskId?: string | undefined;
        missionId?: string | undefined;
        stageId?: string | undefined;
    } | undefined;
    transportId?: string | undefined;
};

export type AgentAdapterSettings = {
    model: string;
    launchMode: AgentAdapterLaunchMode;
    runtimeEnv?: NodeJS.ProcessEnv;
    reasoningEffort?: string;
    dangerouslySkipPermissions?: boolean;
    resumeAgentExecution?: string;
    captureAgentExecutions?: boolean;
};

export type AgentAdapterSettingsResolver<TConfig = AgentLaunchConfig> = (
    config: TConfig,
    agentId: string
) => AgentAdapterSettings;

export type AgentAdapterAvailability = {
    available: boolean;
    reason?: string;
};

export type AgentAdapterInput = {
    command: string;
    defaultLaunchMode?: AgentAdapterLaunchMode;
    transportId?: 'terminal' | 'none';
    createLaunchPlan?: (config: AgentLaunchConfig, settings: AgentAdapterSettings) => AgentAdapterLaunchPlan;
};

export type AgentInput = {
    id: string;
    agentId: AgentIdType;
    displayName: string;
    icon: string;
    adapter: AgentAdapterInput;
    default?: boolean;
};

export type CreateAgentAdapterContext = {
    resolveSettings: AgentAdapterSettingsResolver<AgentLaunchConfig>;
    logLine?: (line: string) => void;
};

type AgentAdapterOptions = {
    id: string;
    displayName: string;
    icon?: string;
    command: string;
    defaultLaunchMode?: AgentAdapterLaunchMode;
    transportId?: 'terminal' | 'none';
    createLaunchPlan?: (config: AgentLaunchConfig, settings: AgentAdapterSettings) => AgentAdapterLaunchPlan;
    resolveSettings?: AgentAdapterSettingsResolver;
    logLine?: (line: string) => void;
};

export class AgentAdapter {
    private executionCounter = 0;
    protected readonly executionsById = new Map<string, ManagedAgentExecution>();
    protected lastStartRequest: AgentAdapterStartRequest | undefined;
    private readonly resolveSettings: AgentAdapterSettingsResolver<AgentLaunchConfig>;
    private readonly launchPlanFactory: (config: AgentLaunchConfig, settings: AgentAdapterSettings) => AgentAdapterLaunchPlan;

    public readonly id: string;
    public readonly displayName: string;
    public readonly icon: string;
    public readonly command: string;
    public readonly defaultLaunchMode: AgentAdapterLaunchMode;
    public readonly transportId: 'terminal' | 'none';

    public constructor(options: AgentAdapterOptions) {
        this.id = options.id;
        this.displayName = options.displayName;
        this.icon = options.icon ?? 'lucide:bot';
        this.command = options.command;
        this.defaultLaunchMode = options.defaultLaunchMode ?? 'interactive';
        this.transportId = options.transportId ?? 'terminal';
        this.resolveSettings = options.resolveSettings ?? ((config) => ({
            model: String(config.metadata?.['model'] ?? ''),
            launchMode: (config.metadata?.['launchMode'] === 'print' ? 'print' : config.metadata?.['launchMode'] === 'interactive' ? 'interactive' : this.defaultLaunchMode),
            runtimeEnv: process.env
        }));
        this.launchPlanFactory = options.createLaunchPlan ?? ((_config, settings) => ({
            mode: settings.launchMode,
            command: this.command,
            args: [
                ...(settings.launchMode === 'print' ? ['--print'] : []),
                ...(settings.model ? ['--model', settings.model] : [])
            ],
            ...(settings.runtimeEnv ? { env: settings.runtimeEnv } : {})
        }));
        void options.logLine;
    }

    public createLaunchPlan(config: AgentLaunchConfig): AgentAdapterLaunchPlan {
        return this.launchPlanFactory(config, this.resolveSettings(config, this.id));
    }

    public async getCapabilities(): Promise<AgentCapabilityType> {
        return {
            acceptsPromptSubmission: true,
            acceptsCommands: true,
            supportsInterrupt: true,
            supportsResumeByReference: true,
            supportsCheckpoint: true
        };
    }

    public async isAvailable(): Promise<AgentAdapterAvailability> {
        return { available: true };
    }

    public readDiagnostics(): AgentAdapterDiagnosticsType {
        return {
            command: this.command,
            supportsUsageParsing: false,
            supportedMessageCount: 0,
            transportCapabilities: {
                supported: this.transportId === 'terminal' ? ['terminal'] : [],
                preferred: {
                    interactive: this.transportId === 'terminal' ? 'terminal' : undefined,
                    print: 'stdout'
                },
                provisioning: {
                    requiresRuntimeConfig: false,
                    supportsStdioBridge: this.transportId === 'terminal',
                    supportsAgentExecutionScopedTools: false
                }
            }
        };
    }

    public async startExecution(config: AgentLaunchConfig): Promise<ManagedAgentExecution> {
        this.lastStartRequest = {
            ...structuredClone(config),
            ...(typeof config.metadata?.['terminalName'] === 'string'
                ? { terminalName: config.metadata['terminalName'] }
                : {}),
            ...(config.scope.kind === 'task'
                ? {
                    task: {
                        taskId: config.scope.taskId,
                        missionId: config.scope.missionId,
                        ...(config.scope.stageId ? { stageId: config.scope.stageId } : {})
                    }
                }
                : {}),
            ...(this.transportId !== 'none' ? { transportId: this.transportId } : {})
        };
        const agentExecutionId = `${this.id}-agent-execution-${String(++this.executionCounter)}`;
        const execution = new ManagedAgentExecution(new AgentExecution(AgentExecution.createData({
            ownerEntity: scopeToOwnerEntity(config.scope),
            ownerId: config.ownerId ?? scopeToOwnerId(config.scope),
            agentId: config.requestedAdapterId ?? config.agentId ?? this.id,
            agentExecutionId
        })));
        const terminalHandle = this.transportId === 'terminal'
            ? {
                terminalName: readTerminalName(config, agentExecutionId),
                terminalPaneId: readTerminalName(config, agentExecutionId)
            } satisfies AgentExecutionTerminalHandleType
            : undefined;
        execution.attachRuntimeContext({
            ...(config.scope.kind === 'task' ? { taskId: config.scope.taskId } : {}),
            adapterLabel: this.displayName,
            ...(config.initialPrompt.title ?? config.specification.summary
                ? { currentTurnTitle: config.initialPrompt.title ?? config.specification.summary }
                : {}),
            ...(config.scope.kind === 'task' ? { assignmentLabel: config.scope.taskId } : {}),
            ...(terminalHandle ? { terminalHandle } : {}),
            ...(terminalHandle
                ? {
                    transport: {
                        kind: 'terminal',
                        terminalName: terminalHandle.terminalName,
                        terminalPaneId: terminalHandle.terminalPaneId
                    } as const
                }
                : {}),
            phase: 'running',
            awaitingInput: false
        });
        execution.attachRuntimeContext({
            workingDirectory: config.workingDirectory,
            ...(this.transportId !== 'none' ? { transportId: this.transportId } : {})
        } as never);
        execution.setLifecycleState('running', 'execution.started');
        this.executionsById.set(agentExecutionId, execution);
        return execution;
    }

    public async reconcileExecution(reference: AgentExecutionReference): Promise<ManagedAgentExecution> {
        const execution = this.executionsById.get(reference.agentExecutionId);
        if (!execution) {
            throw new Error(`AgentExecution '${reference.agentExecutionId}' is not active for adapter '${this.id}'.`);
        }
        const snapshot = execution.getSnapshot();
        execution.setLifecycleState(snapshot.lifecycleState ?? snapshot.lifecycle ?? 'running', 'execution.attached');
        return execution;
    }

    public async submitPrompt(agentExecutionId: string, prompt: AgentPrompt): Promise<void> {
        const execution = this.requireExecution(agentExecutionId);
        const snapshot = execution.getSnapshot();
        execution.attachRuntimeContext({
            ...(prompt.title ?? snapshot.currentTurnTitle
                ? { currentTurnTitle: prompt.title ?? snapshot.currentTurnTitle }
                : {}),
            awaitingInput: false
        });
        execution.emitMessage(prompt.text, 'system');
    }

    public async submitCommand(agentExecutionId: string, command: AgentCommand): Promise<void> {
        const execution = this.requireExecution(agentExecutionId);
        execution.emitMessage(`command:${command.type}`, 'system');
    }

    public async cancelExecution(agentExecutionId: string, _reason?: string): Promise<ManagedAgentExecution> {
        const execution = this.requireExecution(agentExecutionId);
        execution.setLifecycleState('cancelled', 'execution.cancelled');
        return execution;
    }

    public async completeExecution(agentExecutionId: string): Promise<ManagedAgentExecution> {
        const execution = this.requireExecution(agentExecutionId);
        execution.setLifecycleState('completed', 'execution.completed');
        return execution;
    }

    public async terminateExecution(agentExecutionId: string, _reason?: string): Promise<ManagedAgentExecution> {
        const execution = this.requireExecution(agentExecutionId);
        execution.setLifecycleState('terminated', 'execution.terminated');
        return execution;
    }

    public getAgentExecution(agentExecutionId: string): ManagedAgentExecution | undefined {
        return this.executionsById.get(agentExecutionId);
    }

    public deleteAgentExecution(agentExecutionId: string): void {
        this.executionsById.delete(agentExecutionId);
    }

    public listExecutions(): ManagedAgentExecution[] {
        return [...this.executionsById.values()];
    }

    public getLastStartRequest(): AgentAdapterStartRequest | undefined {
        return this.lastStartRequest ? structuredClone(this.lastStartRequest) : undefined;
    }

    protected requireExecution(agentExecutionId: string): ManagedAgentExecution {
        const execution = this.executionsById.get(agentExecutionId);
        if (!execution) {
            throw new Error(`Unknown AgentExecution '${agentExecutionId}' for adapter '${this.id}'.`);
        }
        return execution;
    }
}

export function createAgentAdapter(input: AgentInput, context: CreateAgentAdapterContext): AgentAdapter {
    return new AgentAdapter({
        id: input.agentId,
        displayName: input.displayName,
        icon: input.icon,
        command: input.adapter.command,
        ...(input.adapter.defaultLaunchMode ? { defaultLaunchMode: input.adapter.defaultLaunchMode } : {}),
        ...(input.adapter.transportId ? { transportId: input.adapter.transportId } : {}),
        ...(input.adapter.createLaunchPlan ? { createLaunchPlan: input.adapter.createLaunchPlan } : {}),
        resolveSettings: context.resolveSettings,
        ...(context.logLine ? { logLine: context.logLine } : {})
    });
}

function scopeToOwnerEntity(scope: AgentLaunchConfig['scope']): 'System' | 'Repository' | 'Mission' | 'Task' | 'Artifact' {
    switch (scope.kind) {
        case 'system':
            return 'System';
        case 'repository':
            return 'Repository';
        case 'mission':
            return 'Mission';
        case 'task':
            return 'Task';
        case 'artifact':
            return 'Artifact';
    }
}

function scopeToOwnerId(scope: AgentLaunchConfig['scope']): string {
    switch (scope.kind) {
        case 'system':
            return 'system';
        case 'repository':
            return scope.repositoryRootPath ?? 'repository';
        case 'mission':
            return scope.missionId;
        case 'task':
            return scope.taskId;
        case 'artifact':
            return scope.artifactId;
    }
}

function readTerminalName(config: AgentLaunchConfig, fallback: string): string {
    const terminalName = config.metadata?.['terminalName'];
    return typeof terminalName === 'string' && terminalName.trim() ? terminalName.trim() : fallback;
}