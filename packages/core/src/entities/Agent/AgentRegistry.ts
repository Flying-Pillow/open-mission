import type { AgentAdapter } from '../../daemon/runtime/agent/AgentAdapter.js';
import { missionAgents } from '../../daemon/runtime/agent/adapters/index.js';
import { AgentExecutionMcpAccessProvisioner } from '../../daemon/runtime/agent/mcp/AgentExecutionMcpAccessProvisioner.js';
import type { MissionMcpSignalServer } from '../../daemon/runtime/agent/mcp/MissionMcpSignalServer.js';
import { Agent } from './Agent.js';
import { Repository } from '../Repository/Repository.js';
import {
    createDefaultRepositorySettings,
    readRepositoryAgentAdapterSettings,
    type RepositorySettingsType
} from '../Repository/RepositorySchema.js';
import { AgentDataSchema, type AgentIdType } from './AgentSchema.js';
import {
    createAgentAdapter,
    type AgentInput,
    type AgentAdapterSettingsResolver
} from '../../daemon/runtime/agent/AgentAdapter.js';

export type AgentRegistryOptions = {
    agents: Agent[];
};

export type ConfiguredAgentRegistryOptions = {
    repositoryRootPath: string;
    logLine?: (line: string) => void;
    mcpSignalServer?: MissionMcpSignalServer;
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
        const settings = Repository.readSettingsDocument(options.repositoryRootPath) ?? createDefaultRepositorySettings();
        const resolveSettings = createProviderSettingsResolver({ settings });
        const mcpProvisioner = options.mcpSignalServer
            ? new AgentExecutionMcpAccessProvisioner({ signalServer: options.mcpSignalServer })
            : undefined;
        const adapterContext = {
            resolveSettings,
            ...(mcpProvisioner ? { mcpProvisioner } : {}),
            ...(options.logLine ? { logLine: options.logLine } : {})
        };
        const agents = await Promise.all(missionAgents.map((agentInput) => createConfiguredAgent(agentInput, adapterContext)));
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
        const defaultReasoningEffort = supportsDefaultReasoningEffort(agentId)
            ? readStringMetadata(config, 'reasoningEffort')
            ?? defaults.settings.defaultReasoningEffort?.trim()
            ?? readRepositoryAgentAdapterSettings(defaults.settings, agentId)?.reasoningEfforts[0]
            : undefined;
        const defaultModel = defaults.settings.defaultModel?.trim()
            ?? readRepositoryAgentAdapterSettings(defaults.settings, agentId)?.models[0]?.value;
        const settings = {
            model: readStringMetadata(config, 'model') ?? defaultModel ?? '',
            launchMode: 'interactive' as const,
            runtimeEnv: process.env
        };
        const reasoningEffort = defaultReasoningEffort;
        const dangerouslySkipPermissions = readBooleanMetadata(config, 'dangerouslySkipPermissions');
        const resumeSession = readStringMetadata(config, 'resumeSession');
        const captureSessions = readBooleanMetadata(config, 'captureSessions');
        return {
            ...settings,
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(dangerouslySkipPermissions !== undefined ? { dangerouslySkipPermissions } : {}),
            ...(resumeSession ? { resumeSession } : {}),
            ...(captureSessions !== undefined ? { captureSessions } : {})
        };
    };
}

function supportsDefaultReasoningEffort(agentId: string): boolean {
    return missionAgents.some((agentInput) => agentInput.agentId === agentId && agentInput.supportsDefaultReasoningEffort === true);
}

function isDefaultAgentId(agentId: string): boolean {
    return missionAgents.some((agentInput) => agentInput.default === true && agentInput.agentId === agentId);
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

async function createConfiguredAgent(
    agentInput: AgentInput,
    adapterContext: Parameters<typeof createAgentAdapter>[1]
): Promise<Agent> {
    const adapter = createAgentAdapter(agentInput, adapterContext);
    const [capabilities, availability] = await Promise.all([
        adapter.getCapabilities(),
        adapter.isAvailable()
    ]);
    return new Agent(AgentDataSchema.parse({
        id: agentInput.id,
        agentId: agentInput.agentId,
        displayName: agentInput.displayName,
        capabilities,
        availability: availability.available
            ? { available: true }
            : {
                available: false,
                ...(availability.reason ? { reason: availability.reason } : {})
            }
    }), adapter);
}