import { createEntityId, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
import type { AgentAdapter } from '../../daemon/runtime/agent/AgentAdapter.js';
import {
    agentEntityName,
    AgentDataSchema,
    AgentFindSchema,
    AgentLocatorSchema,
    AgentCapabilitySchema,
    type AgentAvailabilityType,
    type AgentCapabilityType,
    type AgentDataType,
    type AgentIdType
} from './AgentSchema.js';

export class Agent extends Entity<AgentDataType, string> {
    public static override readonly entityName = agentEntityName;

    public constructor(data: AgentDataType, private readonly adapter?: AgentAdapter) {
        super(AgentDataSchema.parse(data));
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
        return new Agent(AgentDataSchema.parse({
            id: Agent.createEntityId(adapter.id),
            agentId: adapter.id,
            displayName: adapter.displayName,
            capabilities: cloneCapabilities(capabilities),
            availability: normalizeAvailability(availability)
        }), adapter);
    }

    public requireAdapter(): AgentAdapter {
        if (!this.adapter) {
            throw new Error(`Agent '${this.agentId}' does not have an attached adapter.`);
        }
        return this.adapter;
    }

    public static async read(payload: unknown, context: EntityExecutionContext): Promise<AgentDataType> {
        const input = AgentLocatorSchema.parse(payload);
        const registry = await loadAgentRegistry(input.repositoryRootPath ?? context.surfacePath);
        return registry.requireAgent(input.agentId).toData();
    }

    public static async find(payload: unknown, context: EntityExecutionContext): Promise<AgentDataType[]> {
        const input = AgentFindSchema.parse(payload);
        const registry = await loadAgentRegistry(input.repositoryRootPath ?? context.surfacePath);
        return registry.listAgents().map((agent) => agent.toData());
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

