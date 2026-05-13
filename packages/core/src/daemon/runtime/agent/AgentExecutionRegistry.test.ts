import { describe, expect, it, vi } from 'vitest';
import { AgentExecutionRegistry } from './AgentExecutionRegistry.js';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import {
    deriveAgentExecutionInteractionCapabilities
} from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import type {
    AgentExecutionType,
    AgentExecutionTransportStateType
} from '../../../entities/AgentExecution/AgentExecutionSchema.js';
import { AgentExecutionSchema } from '../../../entities/AgentExecution/AgentExecutionSchema.js';

describe('AgentExecutionRegistry', () => {
    it('does not expose a degraded execution as reusable', () => {
        const registry = new AgentExecutionRegistry();
        installEntry(registry, {
            ownerKey: 'Repository.agentExecution:/repo',
            agentExecutionId: 'execution-1',
            transportState: {
                selected: 'stdout-marker',
                degraded: true,
                health: 'protocol-incompatible',
                signalCompatible: false,
                reason: 'Open Mission daemon protocol 32 is incompatible with client protocol 30.'
            }
        });

        expect(registry.readReusableExecution({
            ownerKey: 'Repository.agentExecution:/repo',
            requestedAgentId: 'copilot-cli'
        })).toBeUndefined();
    });

    it('restarts a degraded execution instead of reusing it during ensureExecution', async () => {
        const registry = new AgentExecutionRegistry();
        const terminateExecution = vi.fn().mockResolvedValue(undefined);
        installEntry(registry, {
            ownerKey: 'Repository.agentExecution:/repo',
            agentExecutionId: 'execution-1',
            transportState: {
                selected: 'stdout-marker',
                degraded: true,
                health: 'protocol-incompatible',
                commandable: false,
                reason: 'Open Mission daemon protocol 32 is incompatible with client protocol 30.'
            },
            terminateExecution
        });
        const restarted = createExecutionData('execution-2');
        (registry as unknown as { startExecution: ReturnType<typeof vi.fn> }).startExecution = vi.fn().mockResolvedValue(restarted);

        const result = await registry.ensureExecution({
            ownerKey: 'Repository.agentExecution:/repo',
            agentRegistry: {
                resolveStartAgentId: () => 'copilot-cli'
            } as never,
            config: {
                requestedAdapterId: 'copilot-cli'
            } as never
        });

        expect(terminateExecution).toHaveBeenCalledWith(
            'execution-1',
            'replaced after runtime transport degradation'
        );
        expect(result).toEqual(restarted);
    });

    it('restarts the active execution on explicit refresh even when the adapter is unchanged', async () => {
        const registry = new AgentExecutionRegistry();
        const terminateExecution = vi.fn().mockResolvedValue(undefined);
        installEntry(registry, {
            ownerKey: 'Repository.agentExecution:/repo',
            agentExecutionId: 'execution-1',
            terminateExecution
        });
        const restarted = createExecutionData('execution-2');
        (registry as unknown as { startExecution: ReturnType<typeof vi.fn> }).startExecution = vi.fn().mockResolvedValue(restarted);

        const result = await registry.replaceActiveExecution({
            ownerKey: 'Repository.agentExecution:/repo',
            agentRegistry: {
                resolveStartAgentId: () => 'copilot-cli'
            } as never,
            config: {
                requestedAdapterId: 'copilot-cli'
            } as never
        });

        expect(terminateExecution).toHaveBeenCalledWith(
            'execution-1',
            'restarted by explicit repository refresh'
        );
        expect(result).toEqual(restarted);
    });

    it('reports degraded and protocol-incompatible execution runtime summary buckets', () => {
        const registry = new AgentExecutionRegistry();
        installEntry(registry, {
            ownerKey: 'Repository.agentExecution:/repo:one',
            agentExecutionId: 'execution-1',
            transportState: {
                selected: 'stdout-marker',
                degraded: true,
                health: 'protocol-incompatible',
                leaseAttached: false,
                signalCompatible: false,
                reason: 'Protocol mismatch.'
            }
        });
        installEntry(registry, {
            ownerKey: 'Repository.agentExecution:/repo:two',
            agentExecutionId: 'execution-2',
            terminalName: 'terminal-two',
            transportState: {
                selected: 'stdout-marker',
                degraded: false,
                health: 'attached',
                leaseAttached: true,
                signalCompatible: true
            }
        });

        const summary = registry.readRuntimeSummary();

        expect(summary).toMatchObject({
            activeAgentExecutionCount: 2,
            attachedAgentExecutionCount: 1,
            detachedAgentExecutionCount: 1,
            degradedAgentExecutionCount: 1,
            protocolIncompatibleAgentExecutionCount: 1,
            executionsWithoutRuntimeLeaseCount: 1
        });
    });
});

function createExecutionData(
    agentExecutionId: string,
    transportState?: AgentExecutionTransportStateType
): AgentExecutionType {
    return AgentExecutionSchema.parse({
        ...AgentExecution.createLive(createExecution(agentExecutionId)).toData(),
        ...(transportState ? { transportState } : {})
    });
}

function installEntry(
    registry: AgentExecutionRegistry,
    input: {
        ownerKey: string;
        agentExecutionId: string;
        terminalName?: string;
        transportState?: AgentExecutionTransportStateType;
        terminateExecution?: ReturnType<typeof vi.fn>;
    }
): void {
    const execution = AgentExecution.createLive(createExecution(input.agentExecutionId, input.terminalName));
    execution.updateFromData(
        AgentExecutionSchema.parse({
            ...execution.toData(),
            ...(input.transportState ? { transportState: input.transportState } : {})
        })
    );
    (registry as unknown as {
        agentExecutionIdsByOwnerKey: Map<string, string>;
        executionsByAgentExecutionId: Map<string, unknown>;
    }).agentExecutionIdsByOwnerKey.set(input.ownerKey, input.agentExecutionId);
    (registry as unknown as {
        executionsByAgentExecutionId: Map<string, unknown>;
    }).executionsByAgentExecutionId.set(input.agentExecutionId, {
        ownerKey: input.ownerKey,
        agentExecutor: {
            terminateExecution: input.terminateExecution ?? vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn()
        },
        execution,
        dataChangeSubscription: {
            dispose: vi.fn()
        }
    });
}

function createExecution(agentExecutionId: string, terminalName?: string): AgentExecutionType {
    return {
        agentId: 'copilot-cli',
        agentExecutionId,
        scope: {
            kind: 'repository',
            repositoryRootPath: '/repo'
        },
        workingDirectory: '/repo',
        status: 'running',
        attention: 'autonomous',
        progress: {
            state: 'idle',
            updatedAt: '2026-05-10T00:00:00.000Z'
        },
        waitingForInput: false,
        acceptsPrompts: true,
        acceptedCommands: ['resume', 'checkpoint', 'nudge'],
        interactionPosture: 'structured-headless',
        interactionCapabilities: deriveAgentExecutionInteractionCapabilities({
            status: 'running',
            acceptsPrompts: true,
            acceptedCommands: ['resume', 'checkpoint', 'nudge']
        }),
        reference: {
            agentId: 'copilot-cli',
            agentExecutionId
        },
        ...(terminalName
            ? {
                transport: {
                    kind: 'terminal' as const,
                    terminalName
                }
            }
            : {}),
        startedAt: '2026-05-10T00:00:00.000Z',
        updatedAt: '2026-05-10T00:00:00.000Z'
    };
}