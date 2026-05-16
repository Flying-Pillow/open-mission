import { createEntityId, Entity, type EntityExecutionContext } from '../Entity/Entity.js';
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
    type AgentAdapterDiagnosticsType,
    type AgentCapabilityType,
    type AgentConnectionTestResultType,
    type AgentType,
    type AgentIdType
} from './AgentSchema.js';
import { Repository } from '../Repository/Repository.js';

export type AgentAdapterHandle = {
    readonly id: string;
    readonly displayName: string;
    readonly icon: string;
    getCapabilities(): AgentCapabilityType | Promise<AgentCapabilityType>;
    isAvailable(): { available: boolean; reason?: string } | Promise<{ available: boolean; reason?: string }>;
    readDiagnostics(): AgentAdapterDiagnosticsType;
};

export type AgentConnectionTestRunner = {
    test(input: {
        agent: Agent;
        repositoryRootPath: string;
        workingDirectory: string;
        model?: string;
        reasoningEffort?: string;
        launchMode?: 'interactive' | 'print';
        initialPrompt?: string;
    }): Promise<unknown>;
};

export class Agent extends Entity<AgentType, string> {
    public static override readonly entityName = agentEntityName;

    public constructor(data: AgentType, private readonly adapter?: AgentAdapterHandle) {
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

    public static async fromAdapter(adapter: AgentAdapterHandle): Promise<Agent> {
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

    public requireAdapter<TAdapter extends AgentAdapterHandle = AgentAdapterHandle>(): TAdapter {
        if (!this.adapter) {
            throw new Error(`Agent '${this.agentId}' does not have an attached adapter.`);
        }
        return this.adapter as TAdapter;
    }

    public static async read(payload: unknown, context: EntityExecutionContext): Promise<AgentType> {
        const input = AgentLocatorSchema.parse(payload);
        const repositoryRootPath = await resolveRepositoryRootPath(input.repositoryId, context);
        const registry = await loadAgentRegistry(repositoryRootPath);
        return registry.requireAgent(input.agentId).toData();
    }

    public static async find(payload: unknown, context: EntityExecutionContext): Promise<AgentType[]> {
        const input = AgentFindSchema.parse(payload);
        const repositoryRootPath = await resolveRepositoryRootPath(input.repositoryId, context);
        const registry = await loadAgentRegistry(repositoryRootPath);
        return registry.listAgents().map((agent) => agent.toData());
    }

    public static async testConnection(payload: unknown, context: EntityExecutionContext): Promise<AgentConnectionTestResultType> {
        const input = AgentTestConnectionInputSchema.parse(payload);
        const repositoryRootPath = await resolveRepositoryRootPath(input.repositoryId, context);
        const workingDirectory = input.workingDirectory ?? repositoryRootPath;
        const registry = await loadAgentRegistry(repositoryRootPath);
        const agent = registry.requireAgent(input.agentId);
        const tester = requireAgentConnectionTestRunner(context);
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

async function resolveRepositoryRootPath(repositoryId: string, context: EntityExecutionContext): Promise<string> {
    const repository = await Repository.resolve({ id: repositoryId }, context);
    return repository.repositoryRootPath;
}

function requireAgentConnectionTestRunner(context: EntityExecutionContext): AgentConnectionTestRunner {
    const tester = context['agentConnectionTester'];
    if (!isAgentConnectionTestRunner(tester)) {
        throw new Error('Agent connection tests require an agentConnectionTester execution-context capability.');
    }
    return tester;
}

function isAgentConnectionTestRunner(input: unknown): input is AgentConnectionTestRunner {
    return typeof input === 'object' && input !== null && 'test' in input && typeof input.test === 'function';
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

function cloneDiagnostics(input: AgentAdapterDiagnosticsType) {
    return AgentAdapterDiagnosticsSchema.parse(input);
}

