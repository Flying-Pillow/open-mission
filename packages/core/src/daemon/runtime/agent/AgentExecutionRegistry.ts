import type { AgentRegistry } from '../../../entities/Agent/AgentRegistry.js';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import type {
    AgentCommand,
    AgentLaunchConfig,
    AgentPrompt
} from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import {
    AgentExecutionCommandSchema,
    AgentExecutionDataSchema,
    AgentExecutionPromptSchema,
    type AgentExecutionDataType
} from '../../../entities/AgentExecution/AgentExecutionSchema.js';
import { AgentExecutor } from './AgentExecutor.js';

type AgentExecutionRegistryEntry = {
    ownerKey: string;
    agentExecutor: AgentExecutor;
    execution: AgentExecution;
    dataChangeSubscription: { dispose(): void };
};

export type AgentExecutionRegistryCommand =
    | { commandId: 'agentExecution.complete' }
    | { commandId: 'agentExecution.cancel'; input?: unknown }
    | { commandId: 'agentExecution.sendPrompt'; input?: unknown }
    | { commandId: 'agentExecution.sendRuntimeMessage'; input?: unknown };

type AgentExecutionRegistryOptions = {
    logger?: {
        debug(message: string, metadata?: Record<string, unknown>): void;
    };
};

export class AgentExecutionRegistry {
    private readonly executionsBySessionId = new Map<string, AgentExecutionRegistryEntry>();
    private readonly sessionIdsByOwnerKey = new Map<string, string>();
    private readonly dataChangeListeners = new Set<(data: AgentExecutionDataType) => void>();
    private logger: AgentExecutionRegistryOptions['logger'];

    public constructor(options: AgentExecutionRegistryOptions = {}) {
        this.logger = options.logger;
    }

    public configure(options: AgentExecutionRegistryOptions = {}): void {
        if (options.logger) {
            this.logger = options.logger;
        }
    }

    public async ensureExecution(input: {
        ownerKey: string;
        agentRegistry: AgentRegistry;
        config: AgentLaunchConfig;
    }): Promise<AgentExecutionDataType> {
        const existingSessionId = this.sessionIdsByOwnerKey.get(input.ownerKey);
        if (existingSessionId) {
            const existing = this.executionsBySessionId.get(existingSessionId);
            if (existing) {
                const snapshot = existing.execution.getSnapshot();
                if (!AgentExecution.isTerminalFinalStatus(snapshot.status)) {
                    return this.toExecutionData(existing.execution);
                }
            }
        }

        const agentExecutor = new AgentExecutor({
            agentRegistry: input.agentRegistry,
            ...(this.logger ? { logger: this.logger } : {})
        });
        const execution = await agentExecutor.startExecution(input.config);
        const sessionId = execution.sessionId;
        this.disposeSession(sessionId);
        const dataChangeSubscription = execution.onDidDataChange((data) => this.emitDataChanged(data));
        this.sessionIdsByOwnerKey.set(input.ownerKey, sessionId);
        this.executionsBySessionId.set(sessionId, {
            ownerKey: input.ownerKey,
            agentExecutor,
            execution,
            dataChangeSubscription
        });
        this.emitDataChanged(this.toExecutionData(execution));
        return this.toExecutionData(execution);
    }

    public readExecution(sessionId: string): AgentExecutionDataType {
        const entry = this.requireExecution(sessionId);
        return this.toExecutionData(entry.execution);
    }

    public async commandExecution(sessionId: string, command: AgentExecutionRegistryCommand): Promise<AgentExecutionDataType> {
        const entry = this.requireExecution(sessionId);
        switch (command.commandId) {
            case 'agentExecution.complete':
                await entry.agentExecutor.completeExecution(sessionId);
                break;
            case 'agentExecution.cancel':
                await entry.agentExecutor.cancelExecution(sessionId, readReason(command.input));
                break;
            case 'agentExecution.sendPrompt':
                await entry.agentExecutor.submitPrompt(sessionId, normalizePrompt(AgentExecutionPromptSchema.parse(command.input)));
                break;
            case 'agentExecution.sendRuntimeMessage':
                await entry.agentExecutor.submitCommand(sessionId, normalizeCommand(AgentExecutionCommandSchema.parse(command.input)));
                break;
        }
        return this.toExecutionData(entry.execution);
    }

    public hasExecution(sessionId: string): boolean {
        return this.executionsBySessionId.has(sessionId);
    }

    public onDidExecutionDataChange(listener: (data: AgentExecutionDataType) => void): { dispose(): void } {
        this.dataChangeListeners.add(listener);
        return {
            dispose: () => {
                this.dataChangeListeners.delete(listener);
            }
        };
    }

    public dispose(): void {
        for (const sessionId of [...this.executionsBySessionId.keys()]) {
            this.disposeSession(sessionId);
        }
        this.sessionIdsByOwnerKey.clear();
    }

    private requireExecution(sessionId: string): AgentExecutionRegistryEntry {
        const entry = this.executionsBySessionId.get(sessionId);
        if (!entry) {
            throw new Error(`AgentExecution '${sessionId}' is not registered in the daemon AgentExecutionRegistry.`);
        }
        return entry;
    }

    private disposeSession(sessionId: string): void {
        const entry = this.executionsBySessionId.get(sessionId);
        if (!entry) {
            return;
        }
        entry.agentExecutor.dispose();
        entry.dataChangeSubscription.dispose();
        this.executionsBySessionId.delete(sessionId);
        if (this.sessionIdsByOwnerKey.get(entry.ownerKey) === sessionId) {
            this.sessionIdsByOwnerKey.delete(entry.ownerKey);
        }
    }

    private toExecutionData(execution: AgentExecution): AgentExecutionDataType {
        return AgentExecutionDataSchema.parse(execution.toData());
    }

    private emitDataChanged(data: AgentExecutionDataType): void {
        const parsed = AgentExecutionDataSchema.parse(data);
        for (const listener of this.dataChangeListeners) {
            listener(parsed);
        }
    }
}

let defaultAgentExecutionRegistry: AgentExecutionRegistry | undefined;

export function getDefaultAgentExecutionRegistry(options: AgentExecutionRegistryOptions = {}): AgentExecutionRegistry {
    defaultAgentExecutionRegistry ??= new AgentExecutionRegistry(options);
    defaultAgentExecutionRegistry.configure(options);
    return defaultAgentExecutionRegistry;
}

export function setDefaultAgentExecutionRegistry(registry: AgentExecutionRegistry): void {
    defaultAgentExecutionRegistry = registry;
}

function readReason(input: unknown): string | undefined {
    if (!isRecord(input) || typeof input['reason'] !== 'string') {
        return undefined;
    }
    const reason = input['reason'].trim();
    return reason.length > 0 ? reason : undefined;
}

function normalizePrompt(input: { source: AgentPrompt['source']; text: string; title?: string | undefined; metadata?: AgentPrompt['metadata'] | undefined }): AgentPrompt {
    return {
        source: input.source,
        text: input.text,
        ...(input.title ? { title: input.title } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {})
    };
}

function normalizeCommand(input: { type: AgentCommand['type']; reason?: string | undefined; metadata?: AgentCommand['metadata'] | undefined }): AgentCommand {
    return {
        type: input.type,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {})
    };
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}
