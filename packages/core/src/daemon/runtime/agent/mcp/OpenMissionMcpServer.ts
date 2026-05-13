import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
    AgentSignalMarkerPayloadSchema,
    AgentSignalPayloadSchema,
    AgentSignalToolPayloadSchemasByType,
    AgentExecutionObservationAckSchema,
    AgentExecutionProtocolDescriptorSchema,
    MAX_AGENT_SIGNAL_MARKER_LENGTH,
    type AgentSignalDescriptorType,
    type AgentSignalPayloadType,
    type AgentExecutionObservationAckType,
    type AgentExecutionProtocolDescriptorType
} from '../../../../entities/AgentExecution/AgentExecutionProtocolSchema.js';
import {
    cloneAgentExecutionScope,
    type AgentExecutionScope,
    type AgentExecutionObservation
} from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import { createAgentExecutionSignalFromPayload } from '../../../../entities/AgentExecution/AgentExecutionSignalRegistry.js';
import {
    AgentExecutionSemanticOperationDescriptors,
    type AgentExecutionReadArtifactOperationInputType,
    type AgentExecutionSemanticOperationInvoker,
    type AgentExecutionSemanticOperationName,
    type AgentExecutionSemanticOperationResultType,
    readAgentExecutionSemanticOperationDescriptor,
    readAgentExecutionSemanticOperationInputSchema
} from '../AgentExecutionSemanticOperations.js';

const OPEN_MISSION_MCP_SERVER_NAME = 'open-mission-mcp';

const OpenMissionMcpToolCallInputSchema = AgentSignalMarkerPayloadSchema.extend({
    token: z.string().trim().min(1)
}).strict();

const OpenMissionMcpDirectToolInputBaseSchema = z.object({
    eventId: z.string().trim().min(1).optional(),
    token: z.string().trim().min(1)
}).strict();

type OpenMissionMcpToolCallInput = z.infer<typeof OpenMissionMcpToolCallInputSchema>;

export const OpenMissionMcpListToolsInputSchema = z.object({
    agentExecutionId: z.string().trim().min(1),
    token: z.string().trim().min(1)
}).strict();

export const OpenMissionMcpRegisterAccessInputSchema = z.object({
    agentExecutionId: z.string().trim().min(1),
    token: z.string().trim().min(1).optional(),
    protocolDescriptor: AgentExecutionProtocolDescriptorSchema
}).strict();

export const OpenMissionMcpCallToolInputSchema = z.object({
    name: z.string().trim().min(1),
    input: z.unknown()
}).strict();

export type OpenMissionMcpListToolsInputType = z.infer<typeof OpenMissionMcpListToolsInputSchema>;
export type OpenMissionMcpRegisterAccessInputType = z.infer<typeof OpenMissionMcpRegisterAccessInputSchema>;
export type OpenMissionMcpCallToolInputType = z.infer<typeof OpenMissionMcpCallToolInputSchema>;

type OpenMissionMcpLogger = {
    debug(message: string, metadata?: Record<string, unknown>): void;
};

type OpenMissionMcpAccessRecord = {
    accessId: string;
    agentExecutionId: string;
    token: string;
    protocolDescriptor: AgentExecutionProtocolDescriptorType;
    registeredAt: string;
};

type OpenMissionMcpToolDescriptor = {
    name: string;
    title: string;
    description?: string;
    kind: 'signal' | 'semantic-operation';
    payloadSchemaKey?: string;
    policy?: AgentSignalDescriptorType['policy'];
    outcomes?: AgentSignalDescriptorType['outcomes'];
};

type AgentExecutionTransportObservationRouter = {
    routeTransportObservation(input: {
        agentExecutionId: string;
        observation: AgentExecutionObservation;
    }): AgentExecutionObservationAckType | Promise<AgentExecutionObservationAckType>;
    invokeSemanticOperation?: AgentExecutionSemanticOperationInvoker['invokeSemanticOperation'];
};

export type OpenMissionMcpRegisterAccessInput = {
    agentExecutionId: string;
    token?: string | undefined;
    protocolDescriptor: AgentExecutionProtocolDescriptorType;
};

export type OpenMissionMcpRegisteredAccess = {
    accessId: string;
    agentExecutionId: string;
    token: string;
    serverName: 'open-mission-mcp';
    tools: OpenMissionMcpToolDescriptor[];
};

export type OpenMissionMcpCallToolResultType = AgentExecutionObservationAckType | AgentExecutionSemanticOperationResultType;

export class OpenMissionMcpServer {
    public readonly serverName = OPEN_MISSION_MCP_SERVER_NAME;
    private readonly agentExecutionRegistry: AgentExecutionTransportObservationRouter;
    private readonly sessions = new OpenMissionMcpSessionRegistry();
    private readonly tools = new OpenMissionMcpToolCatalog();
    private readonly logger: OpenMissionMcpLogger | undefined;
    private started = false;

    public constructor(input: {
        agentExecutionRegistry: AgentExecutionTransportObservationRouter;
        logger?: OpenMissionMcpLogger;
    }) {
        this.agentExecutionRegistry = input.agentExecutionRegistry;
        this.logger = input.logger;
    }

    public async start(): Promise<void> {
        if (this.started) {
            return;
        }
        this.started = true;
        this.logger?.debug('Open Mission MCP server started.', { serverName: this.serverName });
    }

    public async stop(): Promise<void> {
        if (!this.started) {
            return;
        }
        this.sessions.clear();
        this.started = false;
        this.logger?.debug('Open Mission MCP server stopped.', { serverName: this.serverName });
    }

    public registerAccess(input: OpenMissionMcpRegisterAccessInput): OpenMissionMcpRegisteredAccess {
        this.requireStarted();
        const protocolDescriptor = AgentExecutionProtocolDescriptorSchema.parse(input.protocolDescriptor);
        if (protocolDescriptor.mcp?.serverName !== this.serverName) {
            throw new Error(`AgentExecution '${input.agentExecutionId}' does not declare open-mission-mcp delivery.`);
        }
        const accessRecord = this.sessions.register({
            accessId: randomUUID(),
            agentExecutionId: input.agentExecutionId,
            token: input.token?.trim() || randomUUID(),
            protocolDescriptor,
            registeredAt: new Date().toISOString()
        });
        return this.toRegisteredAccess(accessRecord);
    }

    public unregisterAccess(agentExecutionId: string): void {
        this.sessions.unregister(agentExecutionId);
    }

    public listTools(input: OpenMissionMcpListToolsInputType): OpenMissionMcpToolDescriptor[] {
        this.requireStarted();
        const accessRecord = this.sessions.requireAuthorized(OpenMissionMcpListToolsInputSchema.parse(input));
        return this.tools.materialize(accessRecord.protocolDescriptor);
    }

    public createServerForAccess(input: { agentExecutionId: string; token: string }): McpServer {
        this.requireStarted();
        const accessRecord = this.sessions.requireAuthorized(input);
        const mcpServer = new McpServer({ name: this.serverName, version: '0.1.0' });
        for (const tool of this.tools.materialize(accessRecord.protocolDescriptor)) {
            mcpServer.registerTool(
                tool.name,
                {
                    title: tool.title,
                    ...(tool.description ? { description: tool.description } : {}),
                    inputSchema: createOpenMissionMcpDirectToolInputSchema(tool.name).shape
                },
                async (callInput): Promise<CallToolResult> => this.toCallToolResult(await this.callTool({
                    name: tool.name,
                    input: {
                        ...callInput,
                        agentExecutionId: input.agentExecutionId
                    }
                }))
            );
        }
        return mcpServer;
    }

    public async callTool(input: OpenMissionMcpCallToolInputType): Promise<OpenMissionMcpCallToolResultType> {
        this.requireStarted();
        const semanticOperationDescriptor = readAgentExecutionSemanticOperationDescriptor(input.name);
        if (semanticOperationDescriptor) {
            return this.callSemanticOperationTool(semanticOperationDescriptor.name, input.input);
        }
        const toolCall = OpenMissionMcpToolCall.parse(OpenMissionMcpCallToolInputSchema.parse(input));
        if (!toolCall.accepted) {
            return toolCall.ack;
        }
        const accessRecord = this.sessions.read(toolCall.input.agentExecutionId);
        if (!accessRecord) {
            return rejectedAck(toolCall.input.agentExecutionId, toolCall.input.eventId, 'AgentExecution is not registered for open-mission-mcp access.');
        }
        const authorization = this.sessions.authorize(accessRecord, toolCall.input.token);
        if (!authorization.authorized) {
            return rejectedAck(toolCall.input.agentExecutionId, toolCall.input.eventId, authorization.reason);
        }
        const descriptor = this.tools.readSignalDescriptor(accessRecord.protocolDescriptor, input.name);
        if (!descriptor) {
            return rejectedAck(toolCall.input.agentExecutionId, toolCall.input.eventId, `Tool '${input.name}' is not declared for this AgentExecution.`);
        }
        if (toolCall.input.signal.type !== descriptor.type) {
            return rejectedAck(toolCall.input.agentExecutionId, toolCall.input.eventId, `Tool '${input.name}' received signal '${toolCall.input.signal.type}'.`);
        }

        const observation = this.toObservation(accessRecord, toolCall.input);
        return AgentExecutionObservationAckSchema.parse(await this.agentExecutionRegistry.routeTransportObservation({
            agentExecutionId: toolCall.input.agentExecutionId,
            observation
        }));
    }

    private async callSemanticOperationTool(
        operationName: AgentExecutionSemanticOperationName,
        input: unknown
    ): Promise<OpenMissionMcpCallToolResultType> {
        const parsedInput = parseOpenMissionMcpSemanticOperationInput(operationName, input);
        if (!parsedInput.success) {
            return rejectedAck(readAgentExecutionId(input), readEventId(input), parsedInput.reason ?? `Open Mission MCP semantic operation '${operationName}' input failed schema validation.`);
        }
        const accessRecord = this.sessions.read(parsedInput.input.agentExecutionId);
        if (!accessRecord) {
            return rejectedAck(parsedInput.input.agentExecutionId, parsedInput.input.eventId, 'AgentExecution is not registered for open-mission-mcp access.');
        }
        const authorization = this.sessions.authorize(accessRecord, parsedInput.input.token);
        if (!authorization.authorized) {
            return rejectedAck(parsedInput.input.agentExecutionId, parsedInput.input.eventId, authorization.reason);
        }
        if (!this.agentExecutionRegistry.invokeSemanticOperation) {
            return rejectedAck(parsedInput.input.agentExecutionId, parsedInput.input.eventId, `Mission semantic operation '${operationName}' is unavailable.`);
        }
        return this.agentExecutionRegistry.invokeSemanticOperation({
            agentExecutionId: parsedInput.input.agentExecutionId,
            name: operationName,
            input: parsedInput.input.input
        });
    }

    private toRegisteredAccess(accessRecord: OpenMissionMcpAccessRecord): OpenMissionMcpRegisteredAccess {
        return {
            accessId: accessRecord.accessId,
            agentExecutionId: accessRecord.agentExecutionId,
            token: accessRecord.token,
            serverName: this.serverName,
            tools: this.tools.materialize(accessRecord.protocolDescriptor)
        };
    }

    private toObservation(
        accessRecord: OpenMissionMcpAccessRecord,
        input: OpenMissionMcpToolCallInput
    ): AgentExecutionObservation {
        const address = {
            agentExecutionId: input.agentExecutionId,
            scope: cloneAgentExecutionScope(accessRecord.protocolDescriptor.scope as AgentExecutionScope)
        };
        return {
            observationId: `agent-signal:${input.eventId}`,
            observedAt: new Date().toISOString(),
            signal: createAgentExecutionSignalFromPayload(input.signal),
            route: {
                origin: 'agent-signal',
                address
            },
            claimedAddress: {
                agentExecutionId: input.agentExecutionId,
                scope: cloneAgentExecutionScope(accessRecord.protocolDescriptor.scope as AgentExecutionScope)
            },
            rawText: JSON.stringify({
                version: input.version,
                agentExecutionId: input.agentExecutionId,
                eventId: input.eventId,
                signal: input.signal
            })
        };
    }

    private toCallToolResult(result: OpenMissionMcpCallToolResultType): CallToolResult {
        return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
            isError: isObservationAckResult(result) ? result.status === 'rejected' : false
        };
    }

    private requireStarted(): void {
        if (!this.started) {
            throw new Error('Open Mission MCP server is not started.');
        }
    }
}

class OpenMissionMcpSessionRegistry {
    private readonly accessByAgentExecutionId = new Map<string, OpenMissionMcpAccessRecord>();

    public register(accessRecord: OpenMissionMcpAccessRecord): OpenMissionMcpAccessRecord {
        this.accessByAgentExecutionId.set(accessRecord.agentExecutionId, accessRecord);
        return accessRecord;
    }

    public unregister(agentExecutionId: string): void {
        this.accessByAgentExecutionId.delete(agentExecutionId);
    }

    public read(agentExecutionId: string): OpenMissionMcpAccessRecord | undefined {
        return this.accessByAgentExecutionId.get(agentExecutionId);
    }

    public requireAuthorized(input: { agentExecutionId: string; token: string }): OpenMissionMcpAccessRecord {
        const accessRecord = this.read(input.agentExecutionId);
        if (!accessRecord) {
            throw new Error(`AgentExecution '${input.agentExecutionId}' is not registered for open-mission-mcp access.`);
        }
        const authorization = this.authorize(accessRecord, input.token);
        if (!authorization.authorized) {
            throw new Error(authorization.reason);
        }
        return accessRecord;
    }

    public authorize(accessRecord: OpenMissionMcpAccessRecord, token: string): { authorized: true } | { authorized: false; reason: string } {
        if (accessRecord.token !== token.trim()) {
            return { authorized: false, reason: 'open-mission-mcp token did not authorize this AgentExecution.' };
        }
        return { authorized: true };
    }

    public clear(): void {
        this.accessByAgentExecutionId.clear();
    }
}

class OpenMissionMcpToolCatalog {
    public materialize(protocolDescriptor: AgentExecutionProtocolDescriptorType): OpenMissionMcpToolDescriptor[] {
        return [
            ...AgentExecutionSemanticOperationDescriptors.map((descriptor) => ({
                name: descriptor.name,
                title: descriptor.title,
                description: descriptor.description,
                kind: 'semantic-operation' as const
            })),
            ...protocolDescriptor.signals
                .filter((signal) => signal.deliveries.includes('mcp-tool'))
                .map((signal) => ({
                    name: signal.type,
                    title: signal.label,
                    kind: 'signal' as const,
                    ...(signal.description ? { description: signal.description } : {}),
                    payloadSchemaKey: signal.payloadSchemaKey,
                    policy: signal.policy,
                    outcomes: [...signal.outcomes]
                }))
        ];
    }

    public readSignalDescriptor(
        protocolDescriptor: AgentExecutionProtocolDescriptorType,
        toolName: string
    ): AgentSignalDescriptorType | undefined {
        return protocolDescriptor.signals.find((signal) => signal.type === toolName && signal.deliveries.includes('mcp-tool'));
    }
}

class OpenMissionMcpToolCall {
    public static parse(input: { name: string; input: unknown }):
        | { accepted: true; input: OpenMissionMcpToolCallInput }
        | { accepted: false; ack: AgentExecutionObservationAckType } {
        if (JSON.stringify(input.input).length > MAX_AGENT_SIGNAL_MARKER_LENGTH) {
            return {
                accepted: false,
                ack: rejectedAck(readAgentExecutionId(input.input), readEventId(input.input), 'MCP tool call exceeded the maximum Agent signal length.')
            };
        }
        const result = OpenMissionMcpToolCallInputSchema.safeParse(input.input);
        if (!result.success) {
            const directResult = parseOpenMissionMcpDirectToolInput(input.name, input.input);
            if (!directResult.success) {
                return {
                    accepted: false,
                    ack: rejectedAck(readAgentExecutionId(input.input), readEventId(input.input), directResult.reason ?? result.error.issues[0]?.message ?? 'MCP tool call failed schema validation.')
                };
            }
            return { accepted: true, input: directResult.input };
        }
        if (result.data.signal.type !== input.name) {
            return {
                accepted: false,
                ack: rejectedAck(result.data.agentExecutionId, result.data.eventId, `Tool '${input.name}' received signal '${result.data.signal.type}'.`)
            };
        }
        return { accepted: true, input: result.data };
    }
}

function createOpenMissionMcpDirectToolInputSchema(toolName: string) {
    const semanticOperationDescriptor = readAgentExecutionSemanticOperationDescriptor(toolName);
    if (semanticOperationDescriptor) {
        const operationInputSchema = readAgentExecutionSemanticOperationInputSchema(semanticOperationDescriptor.name);
        return operationInputSchema
            ? OpenMissionMcpDirectToolInputBaseSchema.extend(operationInputSchema.shape).strict()
            : OpenMissionMcpDirectToolInputBaseSchema;
    }
    const payloadSchema = readSignalToolPayloadSchema(toolName);
    return payloadSchema ? OpenMissionMcpDirectToolInputBaseSchema.extend(payloadSchema.shape).strict() : OpenMissionMcpDirectToolInputBaseSchema;
}

function parseOpenMissionMcpSemanticOperationInput(operationName: AgentExecutionSemanticOperationName, input: unknown):
    | { success: true; input: { agentExecutionId: string; token: string; eventId: string; input: AgentExecutionReadArtifactOperationInputType } }
    | { success: false; reason?: string } {
    const operationInputSchema = readAgentExecutionSemanticOperationInputSchema(operationName);
    if (!operationInputSchema) {
        return { success: false, reason: `Semantic operation '${operationName}' is not registered.` };
    }

    const result = OpenMissionMcpDirectToolInputBaseSchema.extend(operationInputSchema.shape).extend({
        agentExecutionId: z.string().trim().min(1)
    }).strict().safeParse(input);
    if (!result.success) {
        const reason = result.error.issues[0]?.message;
        return reason ? { success: false, reason } : { success: false };
    }

    return {
        success: true,
        input: {
            agentExecutionId: result.data.agentExecutionId,
            token: result.data.token,
            eventId: result.data.eventId ?? createOpenMissionMcpEventId(operationName),
            input: operationInputSchema.parse(omitTransportFields(result.data)) as AgentExecutionReadArtifactOperationInputType
        }
    };
}

function parseOpenMissionMcpDirectToolInput(toolName: string, input: unknown):
    | { success: true; input: OpenMissionMcpToolCallInput }
    | { success: false; reason?: string } {
    const payloadSchema = readSignalToolPayloadSchema(toolName);
    if (!payloadSchema) {
        return { success: false, reason: `Tool '${toolName}' is not a known Agent signal tool.` };
    }
    const result = createOpenMissionMcpDirectToolInputSchema(toolName).extend({
        agentExecutionId: z.string().trim().min(1)
    }).strict().safeParse(input);
    if (!result.success) {
        const reason = result.error.issues[0]?.message;
        return reason ? { success: false, reason } : { success: false };
    }
    const payloadInput = omitTransportFields(result.data);
    const signal = AgentSignalPayloadSchema.parse({
        type: toolName,
        ...payloadSchema.parse(payloadInput)
    }) as AgentSignalPayloadType;
    return {
        success: true,
        input: OpenMissionMcpToolCallInputSchema.parse({
            version: 1,
            agentExecutionId: result.data.agentExecutionId,
            eventId: result.data.eventId ?? createOpenMissionMcpEventId(toolName),
            token: result.data.token,
            signal
        })
    };
}

function createOpenMissionMcpEventId(toolName: string): string {
    return `mcp:${toolName}:${randomUUID()}`;
}

function omitTransportFields(input: Record<string, unknown>): Record<string, unknown> {
    const { eventId: _eventId, token: _token, agentExecutionId: _agentExecutionId, ...payload } = input;
    return payload;
}

function readSignalToolPayloadSchema(toolName: string) {
    return isSignalToolName(toolName) ? AgentSignalToolPayloadSchemasByType[toolName] : undefined;
}

function isSignalToolName(toolName: string): toolName is keyof typeof AgentSignalToolPayloadSchemasByType {
    return toolName in AgentSignalToolPayloadSchemasByType;
}

function isObservationAckResult(result: OpenMissionMcpCallToolResultType): result is AgentExecutionObservationAckType {
    return 'status' in result;
}

function rejectedAck(agentExecutionId: string, eventId: string, reason: string): AgentExecutionObservationAckType {
    return AgentExecutionObservationAckSchema.parse({
        status: 'rejected',
        agentExecutionId,
        eventId,
        reason
    });
}

function readAgentExecutionId(input: unknown): string {
    if (isRecord(input) && typeof input['agentExecutionId'] === 'string' && input['agentExecutionId'].trim()) {
        return input['agentExecutionId'].trim();
    }
    return 'unknown';
}

function readEventId(input: unknown): string {
    if (isRecord(input) && typeof input['eventId'] === 'string' && input['eventId'].trim()) {
        return input['eventId'].trim();
    }
    return 'unknown';
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}
