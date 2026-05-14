import type { EntityCommandInvocation, EntityQueryInvocation, EntityRemoteResult } from '@flying-pillow/open-mission-core/entities/Entity/EntityInvocation';
import {
    AgentExecutionCommandAcknowledgementSchema,
    AgentExecutionMessageShorthandResolutionSchema,
    AgentExecutionSemanticOperationResultSchema,
    type AgentExecutionCommandAcknowledgementType,
    type AgentExecutionMessageShorthandResolutionType,
    type AgentExecutionSemanticOperationPayloadType,
    type AgentExecutionSemanticOperationResultType
} from '@flying-pillow/open-mission-core/entities/AgentExecution/AgentExecutionSchema';
import type { EntityCommandDescriptorType } from '@flying-pillow/open-mission-core/entities/Entity/EntitySchema';
import type { AgentExecutionDependencies } from './AgentExecution.svelte.js';

export type AgentExecutionQueryExecutionContext = 'event' | 'render';
export type AgentExecutionCommandExecutor = (input: EntityCommandInvocation) => Promise<EntityRemoteResult>;
export type AgentExecutionQueryExecutor = (
    input: EntityQueryInvocation,
    context?: AgentExecutionQueryExecutionContext
) => Promise<EntityRemoteResult>;

export type AgentExecutionGatewayDependencies = {
    commandRemote: AgentExecutionCommandExecutor;
    queryRemote: AgentExecutionQueryExecutor;
};

const agentExecutionEntityName = 'AgentExecution';

export class AgentExecutionGateway {
    public constructor(private readonly dependencies: AgentExecutionGatewayDependencies) { }

    public createEntityDependencies(input: {
        resolveCommands?: (agentExecutionId: string) => EntityCommandDescriptorType[];
        afterMutation?: () => Promise<unknown> | unknown;
    } = {}): AgentExecutionDependencies {
        return {
            resolveCommands: input.resolveCommands ?? (() => []),
            executeCommand: async (ownerId, agentExecutionId, commandId, commandInput) => {
                await this.executeCommand({
                    ownerId,
                    agentExecutionId,
                    commandId,
                    ...(commandInput !== undefined ? { input: commandInput } : {})
                });
                await input.afterMutation?.();
            },
            resolveMessageShorthand: async (ownerId, agentExecutionId, text, terminalLane) => this.resolveMessageShorthand({
                ownerId,
                agentExecutionId,
                text,
                ...(terminalLane !== undefined ? { terminalLane } : {})
            }),
            invokeSemanticOperation: async (ownerId, agentExecutionId, operation) => {
                const result = await this.invokeSemanticOperation({
                    ownerId,
                    agentExecutionId,
                    operation
                });
                await input.afterMutation?.();
                return result;
            }
        };
    }

    public async executeCommand(input: {
        ownerId: string;
        agentExecutionId: string;
        commandId: string;
        input?: unknown;
    }): Promise<AgentExecutionCommandAcknowledgementType> {
        const ownerId = requireNonEmptyValue(input.ownerId, 'AgentExecution commands require ownerId, agentExecutionId, and commandId.');
        const agentExecutionId = requireNonEmptyValue(input.agentExecutionId, 'AgentExecution commands require ownerId, agentExecutionId, and commandId.');
        const commandId = requireNonEmptyValue(input.commandId, 'AgentExecution commands require ownerId, agentExecutionId, and commandId.');
        return AgentExecutionCommandAcknowledgementSchema.parse(await this.dependencies.commandRemote({
            entity: agentExecutionEntityName,
            method: 'command',
            payload: {
                ownerId,
                agentExecutionId,
                commandId,
                ...(input.input !== undefined ? { input: input.input } : {})
            }
        }));
    }

    public async resolveMessageShorthand(input: {
        ownerId: string;
        agentExecutionId: string;
        text: string;
        terminalLane?: boolean;
        executionContext?: AgentExecutionQueryExecutionContext;
    }): Promise<AgentExecutionMessageShorthandResolutionType> {
        const ownerId = requireNonEmptyValue(input.ownerId, 'AgentExecution message shorthand queries require ownerId, agentExecutionId, and text.');
        const agentExecutionId = requireNonEmptyValue(input.agentExecutionId, 'AgentExecution message shorthand queries require ownerId, agentExecutionId, and text.');
        return AgentExecutionMessageShorthandResolutionSchema.parse(await this.dependencies.queryRemote({
            entity: agentExecutionEntityName,
            method: 'resolveMessageShorthand',
            payload: {
                ownerId,
                agentExecutionId,
                text: input.text,
                ...(input.terminalLane !== undefined ? { terminalLane: input.terminalLane } : {})
            }
        }, input.executionContext));
    }

    public async invokeSemanticOperation(input: {
        ownerId: string;
        agentExecutionId: string;
        operation: AgentExecutionSemanticOperationPayloadType;
    }): Promise<AgentExecutionSemanticOperationResultType> {
        const ownerId = requireNonEmptyValue(input.ownerId, 'AgentExecution semantic operations require ownerId, agentExecutionId, and operation.');
        const agentExecutionId = requireNonEmptyValue(input.agentExecutionId, 'AgentExecution semantic operations require ownerId, agentExecutionId, and operation.');
        return AgentExecutionSemanticOperationResultSchema.parse(await this.dependencies.commandRemote({
            entity: agentExecutionEntityName,
            method: 'invokeSemanticOperation',
            payload: {
                ownerId,
                agentExecutionId,
                name: input.operation.name,
                input: input.operation.input
            }
        }));
    }
}

function requireNonEmptyValue(value: string, message: string): string {
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(message);
    }
    return normalized;
}
