import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { connectDaemon } from '@flying-pillow/open-mission-core/daemon/client/connectDaemon';
import {
    startOpenMissionDaemonProcess,
    type DaemonRuntimeMode
} from '@flying-pillow/open-mission-core/daemon/runtime/DaemonProcessControl';
import {
    AgentSignalPayloadSchema,
    AgentSignalToolPayloadSchemasByType,
    AgentExecutionProtocolDescriptorSchema
} from '@flying-pillow/open-mission-core/entities/AgentExecution/AgentExecutionSchema';
import {
    readAgentExecutionSemanticOperationDescriptor,
    readAgentExecutionSemanticOperationInputSchema
} from '@flying-pillow/open-mission-core/daemon/runtime/agent/AgentExecutionSemanticOperations';
import { z } from 'zod/v4';
import type { EntryContext } from './entryContext.js';

const OpenMissionMcpBridgeToolInputBaseSchema = z.object({
    eventId: z.string().trim().min(1).optional()
}).strict();
const OPEN_MISSION_MCP_DAEMON_HANDSHAKE_TIMEOUT_MS = 3_000;
const OPEN_MISSION_MCP_LIST_TOOLS_TIMEOUT_MS = 8_000;
const OPEN_MISSION_MCP_CALL_TOOL_TIMEOUT_MS = 30_000;
const AgentExecutionRecoverySchema = z.object({
    protocolDescriptor: AgentExecutionProtocolDescriptorSchema
}).strict();

export type OpenMissionMcpToolDescriptor = {
    name: string;
    title: string;
    description?: string;
    kind?: 'signal' | 'semantic-operation';
};

export async function runOpenMissionMcpCommand(context: EntryContext): Promise<void> {
    const [subcommand, ...args] = context.args;
    if (subcommand !== 'connect') {
        throw new Error("Unknown mcp command. Use 'open-mission mcp connect --agent-execution <id>'.");
    }

    const agentExecutionId = readFlagValue(args, '--agent-execution');
    if (!agentExecutionId) {
        throw new Error("open-mission mcp connect requires '--agent-execution <id>'.");
    }

    const token = process.env['OPEN_MISSION_MCP_TOKEN']?.trim();
    if (!token) {
        throw new Error('open-mission mcp connect requires OPEN_MISSION_MCP_TOKEN.');
    }
    const ownerId = process.env['OPEN_MISSION_AGENT_EXECUTION_OWNER_ID']?.trim();

    const client = await connectOpenMissionDaemon(context);
    const tools = await readOpenMissionMcpTools({
        client,
        agentExecutionId,
        ...(ownerId ? { ownerId } : {}),
        token
    });

    const server = new McpServer({ name: 'open-mission-mcp', version: '0.1.0-alpha.1' });
    for (const tool of tools) {
        const inputSchema = createOpenMissionMcpBridgeToolInputSchema(tool);
        server.registerTool(tool.name, {
            title: tool.title,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: inputSchema.shape
        }, async (input: unknown): Promise<CallToolResult> => {
            const parsed = inputSchema.parse(input);
            const result = await client.request<unknown>('open-mission-mcp.callTool', {
                name: tool.name,
                input: createOpenMissionMcpBridgeDaemonToolInput({
                    tool,
                    parsed,
                    agentExecutionId,
                    token
                })
            }, {
                timeoutMs: OPEN_MISSION_MCP_CALL_TOOL_TIMEOUT_MS
            });
            return {
                content: [{ type: 'text', text: JSON.stringify(result) }],
                structuredContent: result as Record<string, unknown>
            };
        });
    }

    await server.connect(new StdioServerTransport());
}

async function connectOpenMissionDaemon(context: EntryContext) {
    try {
        return await connectDaemon({
            surfacePath: context.workingDirectory,
            handshakeTimeoutMs: OPEN_MISSION_MCP_DAEMON_HANDSHAKE_TIMEOUT_MS
        });
    } catch {
        await startOpenMissionDaemonProcess({
            surfacePath: context.workingDirectory,
            runtimeMode: resolveOpenMissionDaemonRuntimeMode()
        });
        return connectDaemon({
            surfacePath: context.workingDirectory,
            handshakeTimeoutMs: OPEN_MISSION_MCP_DAEMON_HANDSHAKE_TIMEOUT_MS
        });
    }
}

async function readOpenMissionMcpTools(input: {
    client: Awaited<ReturnType<typeof connectDaemon>>;
    agentExecutionId: string;
    ownerId?: string;
    token: string;
}): Promise<OpenMissionMcpToolDescriptor[]> {
    try {
        return await input.client.request<OpenMissionMcpToolDescriptor[]>('open-mission-mcp.listTools', {
            agentExecutionId: input.agentExecutionId,
            token: input.token
        }, {
            timeoutMs: OPEN_MISSION_MCP_LIST_TOOLS_TIMEOUT_MS
        });
    } catch (error) {
        if (!shouldRecoverOpenMissionMcpAccess(error) || !input.ownerId) {
            throw error;
        }
        await recoverOpenMissionMcpAccess({
            client: input.client,
            agentExecutionId: input.agentExecutionId,
            ownerId: input.ownerId,
            token: input.token
        });
        return input.client.request<OpenMissionMcpToolDescriptor[]>('open-mission-mcp.listTools', {
            agentExecutionId: input.agentExecutionId,
            token: input.token
        }, {
            timeoutMs: OPEN_MISSION_MCP_LIST_TOOLS_TIMEOUT_MS
        });
    }
}

async function recoverOpenMissionMcpAccess(input: {
    client: Awaited<ReturnType<typeof connectDaemon>>;
    agentExecutionId: string;
    ownerId: string;
    token: string;
}): Promise<void> {
    const execution = await input.client.request<unknown>('entity.query', {
        entity: 'AgentExecution',
        method: 'read',
        payload: {
            ownerId: input.ownerId,
            agentExecutionId: input.agentExecutionId
        }
    });
    const parsedExecution = AgentExecutionRecoverySchema.parse(execution);
    await input.client.request('open-mission-mcp.registerAccess' as any, {
        agentExecutionId: input.agentExecutionId,
        token: input.token,
        protocolDescriptor: parsedExecution['protocolDescriptor']
    });
}

function shouldRecoverOpenMissionMcpAccess(error: unknown): boolean {
    return error instanceof Error && /not registered for open-mission-mcp access/i.test(error.message);
}

function resolveOpenMissionDaemonRuntimeMode(): DaemonRuntimeMode {
    return process.env['OPEN_MISSION_DAEMON_RUNTIME_MODE']?.trim() === 'source' ? 'source' : 'build';
}

export function createOpenMissionMcpBridgeToolInputSchema(tool: OpenMissionMcpToolDescriptor) {
    if (isSemanticOperationTool(tool)) {
        const semanticOperationDescriptor = readAgentExecutionSemanticOperationDescriptor(tool.name);
        const operationInputSchema = semanticOperationDescriptor
            ? readAgentExecutionSemanticOperationInputSchema(semanticOperationDescriptor.name)
            : undefined;
        return operationInputSchema
            ? OpenMissionMcpBridgeToolInputBaseSchema.extend(operationInputSchema.shape).strict()
            : OpenMissionMcpBridgeToolInputBaseSchema;
    }

    const payloadSchema = readSignalToolPayloadSchema(tool.name);
    return payloadSchema ? OpenMissionMcpBridgeToolInputBaseSchema.extend(payloadSchema.shape).strict() : OpenMissionMcpBridgeToolInputBaseSchema;
}

export function createOpenMissionMcpBridgeDaemonToolInput(input: {
    tool: OpenMissionMcpToolDescriptor;
    parsed: Record<string, unknown>;
    agentExecutionId: string;
    token: string;
}): Record<string, unknown> {
    if (isSemanticOperationTool(input.tool)) {
        return {
            ...input.parsed,
            agentExecutionId: input.agentExecutionId,
            token: input.token
        };
    }

    const signal = AgentSignalPayloadSchema.parse({
        type: input.tool.name,
        ...readOpenMissionMcpBridgeSignalPayload(input.tool.name, input.parsed)
    });
    return {
        version: 1,
        agentExecutionId: input.agentExecutionId,
        eventId: typeof input.parsed['eventId'] === 'string' && input.parsed['eventId'].trim()
            ? input.parsed['eventId'].trim()
            : createOpenMissionMcpEventId(input.tool.name),
        token: input.token,
        signal
    };
}

function createOpenMissionMcpEventId(toolName: string): string {
    return `mcp:${toolName}:${randomUUID()}`;
}

function readOpenMissionMcpBridgeSignalPayload(toolName: string, input: unknown): Record<string, unknown> {
    const payloadSchema = readSignalToolPayloadSchema(toolName);
    if (!payloadSchema) {
        throw new Error(`Tool '${toolName}' is not a known Agent signal tool.`);
    }
    return payloadSchema.parse(omitTransportFields(input)) as Record<string, unknown>;
}

function isSemanticOperationTool(tool: OpenMissionMcpToolDescriptor): boolean {
    return tool.kind === 'semantic-operation' || (!tool.kind && Boolean(readAgentExecutionSemanticOperationDescriptor(tool.name)));
}

function omitTransportFields(input: unknown): Record<string, unknown> {
    if (!isRecord(input)) {
        return {};
    }
    const { eventId: _eventId, ...payload } = input;
    return payload;
}

function readSignalToolPayloadSchema(toolName: string) {
    return isSignalToolName(toolName) ? AgentSignalToolPayloadSchemasByType[toolName] : undefined;
}

function isSignalToolName(toolName: string): toolName is Extract<keyof typeof AgentSignalToolPayloadSchemasByType, string> {
    return toolName in AgentSignalToolPayloadSchemasByType;
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}


function readFlagValue(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    if (index === -1) {
        return undefined;
    }
    return args[index + 1]?.trim() || undefined;
}
