import { createEntityId, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import type { AgentAdapter } from '../../daemon/runtime/agent/AgentAdapter.js';
import {
    agentEntityName,
    AgentAdapterDiagnosticsSchema,
    AgentSchema,
    AgentFindSchema,
    AgentTestConnectionInputSchema,
    AgentConnectionTestResultSchema,
    AgentLocatorSchema,
    AgentCapabilitySchema,
    type AgentAvailabilityType,
    type AgentCapabilityType,
    type AgentConnectionTestResultType,
    type AgentType,
    type AgentIdType
} from './AgentSchema.js';

export class Agent extends Entity<AgentType, string> {
    public static override readonly entityName = agentEntityName;

    public constructor(data: AgentType, private readonly adapter?: AgentAdapter) {
        super(AgentSchema.parse(data));
    }

    public override get id(): string {
        return this.data.id;
    }

    public get agentId(): AgentIdType {
        return this.data.agentId;
    }

    public get displayName(): string {
        return this.data.displayName;
    }

    public static createEntityId(agentId: string): string {
        return createEntityId('agent', agentId);
    }

    public static async fromAdapter(adapter: AgentAdapter): Promise<Agent> {
        const [capabilities, availability] = await Promise.all([
            adapter.getCapabilities(),
            adapter.isAvailable()
        ]);
        return new Agent(AgentSchema.parse({
            id: Agent.createEntityId(adapter.id),
            agentId: adapter.id,
            displayName: adapter.displayName,
            icon: adapter.icon,
            capabilities: cloneCapabilities(capabilities),
            availability: normalizeAvailability(availability),
            diagnostics: cloneDiagnostics(adapter.readDiagnostics())
        }), adapter);
    }

    public requireAdapter(): AgentAdapter {
        if (!this.adapter) {
            throw new Error(`Agent '${this.agentId}' does not have an attached adapter.`);
        }
        return this.adapter;
    }

    public static async read(payload: unknown, context: EntityExecutionContext): Promise<AgentType> {
        const input = AgentLocatorSchema.parse(payload);
        const registry = await loadAgentRegistry(input.repositoryRootPath ?? context.surfacePath);
        return registry.requireAgent(input.agentId).toData();
    }

    public static async find(payload: unknown, context: EntityExecutionContext): Promise<AgentType[]> {
        const input = AgentFindSchema.parse(payload);
        const registry = await loadAgentRegistry(input.repositoryRootPath ?? context.surfacePath);
        return registry.listAgents().map((agent) => agent.toData());
    }

    public static async testConnection(payload: unknown, context: EntityExecutionContext): Promise<AgentConnectionTestResultType> {
        const input = AgentTestConnectionInputSchema.parse(payload);
        const repositoryRootPath = input.repositoryRootPath ?? context.surfacePath;
        const workingDirectory = input.workingDirectory ?? repositoryRootPath;
        const registry = await loadAgentRegistry(repositoryRootPath);
        const agent = registry.requireAgent(input.agentId);
        const { AgentConnectionTester } = await import('../../daemon/runtime/agent/AgentConnectionTester.js');
        const tester = new AgentConnectionTester();
        return AgentConnectionTestResultSchema.parse(await tester.test({
            agent,
            repositoryRootPath,
            workingDirectory,
            ...(input.model ? { model: input.model } : {}),
            ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
            ...(input.launchMode ? { launchMode: input.launchMode } : {}),
            ...(input.initialPrompt ? { initialPrompt: input.initialPrompt } : {})
        }));
    }
}

async function loadAgentRegistry(repositoryRootPath: string) {
    const { AgentRegistry } = await import('./AgentRegistry.js');
    return AgentRegistry.createConfigured({ repositoryRootPath });
}

function cloneCapabilities(capabilities: AgentCapabilityType): AgentCapabilityType {
    return AgentCapabilitySchema.parse(capabilities);
}

function normalizeAvailability(input: { available: boolean; reason?: string }): AgentAvailabilityType {
    return input.available
        ? { available: true }
        : {
            available: false,
            ...(input.reason ? { reason: input.reason } : {})
        };
}

function cloneDiagnostics(input: ReturnType<AgentAdapter['readDiagnostics']>) {
    return AgentAdapterDiagnosticsSchema.parse(input);
}

