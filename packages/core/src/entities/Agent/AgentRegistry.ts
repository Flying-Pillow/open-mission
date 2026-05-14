import type { AgentAdapter } from '../../daemon/runtime/agent-execution/adapter/AgentAdapter.js';
import { agentAdapterInputs } from '../../daemon/runtime/agent-execution/adapter/adapters/index.js';
import { Agent } from './Agent.js';
import { Repository } from '../Repository/Repository.js';
import {
    createDefaultRepositorySettings,
    type RepositorySettingsType
} from '../Repository/RepositorySchema.js';
import { AgentSchema, type AgentIdType } from './AgentSchema.js';
import {
    createAgentAdapter,
    type AgentInput,
    type AgentAdapterSettingsResolver
} from '../../daemon/runtime/agent-execution/adapter/AgentAdapter.js';

export type AgentRegistryOptions = {
    agents: Agent[];
};

export type ConfiguredAgentRegistryOptions = {
    repositoryRootPath: string;
    settings?: RepositorySettingsType;
    logLine?: (line: string) => void;
};

export class AgentRegistry {
    private readonly agentsById = new Map<string, Agent>();

    public constructor(options: AgentRegistryOptions) {
        for (const agent of options.agents) {
            if (this.agentsById.has(agent.agentId)) {
                throw new Error(`AgentRegistry received duplicate Agent '${agent.agentId}'.`);
            }
            this.agentsById.set(agent.agentId, agent);
        }
    }

    public static async createConfigured(options: ConfiguredAgentRegistryOptions): Promise<AgentRegistry> {
        const settings = options.settings ?? Repository.readSettingsDocument(options.repositoryRootPath) ?? createDefaultRepositorySettings();
        const resolveSettings = createProviderSettingsResolver({ settings });
        const adapterContext = {
            resolveSettings,
            ...(options.logLine ? { logLine: options.logLine } : {})
        };
        const agents = await Promise.all(agentAdapterInputs.map((agentInput) => createConfiguredAgent(agentInput, adapterContext)));
        return new AgentRegistry({ agents });
    }

    public listAgents(): Agent[] {
        return [...this.agentsById.values()];
    }

    public hasAgent(agentId: string): boolean {
        return this.agentsById.has(agentId);
    }

    public resolveAgent(agentId: string): Agent | undefined {
        return this.agentsById.get(agentId);
    }

    public requireAgent(agentId: string): Agent {
        const agent = this.resolveAgent(agentId);
        if (!agent) {
            throw new Error(`Agent '${agentId}' is not registered.`);
        }
        return agent;
    }

    public requireAgentAdapter(agentId: string): AgentAdapter {
        return this.requireAgent(agentId).requireAdapter();
    }

    public resolveStartAgentId(requestedAgentId?: string): AgentIdType | undefined {
        const requested = requestedAgentId?.trim();
        if (requested) {
            return this.requireAgent(requested).agentId;
        }
        if (this.agentsById.size === 1) {
            return this.listAgents()[0]?.agentId;
        }
        return this.listAgents().find((agent) => isDefaultAgentId(agent.agentId))?.agentId;
    }
}

function createProviderSettingsResolver(
    defaults: { settings: RepositorySettingsType }
): AgentAdapterSettingsResolver<string> {
    return (config, agentId) => {
        const defaultReasoningEffort = readStringMetadata(config, 'reasoningEffort')
            ?? defaults.settings.defaultReasoningEffort?.trim();
        const defaultModel = defaults.settings.defaultModel?.trim();
        const settings = {
            model: readStringMetadata(config, 'model') ?? defaultModel ?? '',
            launchMode: readLaunchModeMetadata(config) ?? readAgentDefaultLaunchMode(agentId) ?? 'interactive' as const,
            runtimeEnv: process.env
        };
        const reasoningEffort = defaultReasoningEffort;
        const dangerouslySkipPermissions = readBooleanMetadata(config, 'dangerouslySkipPermissions');
        const resumeAgentExecution = readStringMetadata(config, 'resumeAgentExecution');
        const captureAgentExecutions = readBooleanMetadata(config, 'captureAgentExecutions');
        return {
            ...settings,
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(dangerouslySkipPermissions !== undefined ? { dangerouslySkipPermissions } : {}),
            ...(resumeAgentExecution ? { resumeAgentExecution } : {}),
            ...(captureAgentExecutions !== undefined ? { captureAgentExecutions } : {})
        };
    };
}

function isDefaultAgentId(agentId: string): boolean {
    return agentAdapterInputs.some((agentInput) => agentInput.default === true && agentInput.agentId === agentId);
}

function readAgentDefaultLaunchMode(agentId: string): 'interactive' | 'print' | undefined {
    return agentAdapterInputs.find((agentInput) => agentInput.agentId === agentId)?.adapter.defaultLaunchMode;
}

function readStringMetadata(
    config: Parameters<AgentAdapterSettingsResolver<string>>[0],
    key: string
): string | undefined {
    const value = config.metadata?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readBooleanMetadata(
    config: Parameters<AgentAdapterSettingsResolver<string>>[0],
    key: string
): boolean | undefined {
    const value = config.metadata?.[key];
    return typeof value === 'boolean' ? value : undefined;
}

function readLaunchModeMetadata(
    config: Parameters<AgentAdapterSettingsResolver<string>>[0]
): 'interactive' | 'print' | undefined {
    const value = config.metadata?.['launchMode'];
    return value === 'interactive' || value === 'print' ? value : undefined;
}

async function createConfiguredAgent(
    agentInput: AgentInput,
    adapterContext: Parameters<typeof createAgentAdapter>[1]
): Promise<Agent> {
    const adapter = createAgentAdapter(agentInput, adapterContext);
    const [capabilities, availability] = await Promise.all([
        adapter.getCapabilities(),
        adapter.isAvailable()
    ]);
    return new Agent(AgentSchema.parse({
        id: agentInput.id,
        agentId: agentInput.agentId,
        displayName: agentInput.displayName,
        icon: agentInput.icon,
        capabilities,
        availability: availability.available
            ? { available: true }
            : {
                available: false,
                ...(availability.reason ? { reason: availability.reason } : {})
            },
        diagnostics: adapter.readDiagnostics()
    }), adapter);
}