import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { connectDaemon } from '@flying-pillow/mission-core/daemon/client/connectAirportDaemon';
import {
    startMissionDaemonProcess,
    type DaemonRuntimeMode
} from '@flying-pillow/mission-core/daemon/runtime/DaemonProcessControl';
import {
    AgentSignalPayloadSchema,
    AgentSignalToolPayloadSchemasByType,
    AgentExecutionProtocolDescriptorSchema
} from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import { z } from 'zod/v4';
import type { EntryContext } from './entryContext.js';

const MissionMcpBridgeToolInputBaseSchema = z.object({
    eventId: z.string().trim().min(1).optional()
}).strict();
const MISSION_MCP_DAEMON_HANDSHAKE_TIMEOUT_MS = 3_000;
const MISSION_MCP_LIST_TOOLS_TIMEOUT_MS = 8_000;
const MISSION_MCP_CALL_TOOL_TIMEOUT_MS = 30_000;
const AgentExecutionRecoverySchema = z.object({
    protocolDescriptor: AgentExecutionProtocolDescriptorSchema
}).strict();

type MissionMcpToolDescriptor = {
    name: string;
    title: string;
    description?: string;
};

export async function runMissionMcpCommand(context: EntryContext): Promise<void> {
    const [subcommand, ...args] = context.args;
    if (subcommand !== 'connect') {
        throw new Error("Unknown mcp command. Use 'mission mcp connect --agent-execution <id>'.");
    }

    const agentExecutionId = readFlagValue(args, '--agent-execution');
    if (!agentExecutionId) {
        throw new Error("mission mcp connect requires '--agent-execution <id>'.");
    }

    const token = process.env['MISSION_MCP_TOKEN']?.trim();
    if (!token) {
        throw new Error('mission mcp connect requires MISSION_MCP_TOKEN.');
    }
    const ownerId = process.env['MISSION_AGENT_EXECUTION_OWNER_ID']?.trim();

    const client = await connectMissionDaemon(context);
    const tools = await readMissionMcpTools({
        client,
        agentExecutionId,
        ...(ownerId ? { ownerId } : {}),
        token
    });

    const server = new McpServer({ name: 'mission-mcp', version: '0.1.0-alpha.1' });
    for (const tool of tools) {
        const inputSchema = createMissionMcpBridgeToolInputSchema(tool.name);
        server.registerTool(tool.name, {
            title: tool.title,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: inputSchema.shape
        }, async (input: unknown): Promise<CallToolResult> => {
            const parsed = inputSchema.parse(input);
            const signal = AgentSignalPayloadSchema.parse({
                type: tool.name,
                ...readMissionMcpBridgeSignalPayload(tool.name, parsed)
            });
            const result = await client.request<unknown>('mission-mcp.callTool', {
                name: tool.name,
                input: {
                    version: 1,
                    agentExecutionId,
                    eventId: parsed.eventId ?? createMissionMcpEventId(tool.name),
                    token,
                    signal
                }
            }, {
                timeoutMs: MISSION_MCP_CALL_TOOL_TIMEOUT_MS
            });
            return {
                content: [{ type: 'text', text: JSON.stringify(result) }],
                structuredContent: result as Record<string, unknown>
            };
        });
    }

    await server.connect(new StdioServerTransport());
}

async function connectMissionDaemon(context: EntryContext) {
    try {
        return await connectDaemon({
            surfacePath: context.workingDirectory,
            handshakeTimeoutMs: MISSION_MCP_DAEMON_HANDSHAKE_TIMEOUT_MS
        });
    } catch {
        await startMissionDaemonProcess({
            surfacePath: context.workingDirectory,
            runtimeMode: resolveMissionDaemonRuntimeMode()
        });
        return connectDaemon({
            surfacePath: context.workingDirectory,
            handshakeTimeoutMs: MISSION_MCP_DAEMON_HANDSHAKE_TIMEOUT_MS
        });
    }
}

async function readMissionMcpTools(input: {
    client: Awaited<ReturnType<typeof connectDaemon>>;
    agentExecutionId: string;
    ownerId?: string;
    token: string;
}): Promise<MissionMcpToolDescriptor[]> {
    try {
        return await input.client.request<MissionMcpToolDescriptor[]>('mission-mcp.listTools', {
            agentExecutionId: input.agentExecutionId,
            token: input.token
        }, {
            timeoutMs: MISSION_MCP_LIST_TOOLS_TIMEOUT_MS
        });
    } catch (error) {
        if (!shouldRecoverMissionMcpAccess(error) || !input.ownerId) {
            throw error;
        }
        await recoverMissionMcpAccess({
            client: input.client,
            agentExecutionId: input.agentExecutionId,
            ownerId: input.ownerId,
            token: input.token
        });
        return input.client.request<MissionMcpToolDescriptor[]>('mission-mcp.listTools', {
            agentExecutionId: input.agentExecutionId,
            token: input.token
        }, {
            timeoutMs: MISSION_MCP_LIST_TOOLS_TIMEOUT_MS
        });
    }
}

async function recoverMissionMcpAccess(input: {
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
    await input.client.request('mission-mcp.registerAccess' as any, {
        agentExecutionId: input.agentExecutionId,
        token: input.token,
        protocolDescriptor: parsedExecution['protocolDescriptor']
    });
}

function shouldRecoverMissionMcpAccess(error: unknown): boolean {
    return error instanceof Error && /not registered for mission-mcp access/i.test(error.message);
}

function resolveMissionDaemonRuntimeMode(): DaemonRuntimeMode {
    return process.env['MISSION_DAEMON_RUNTIME_MODE']?.trim() === 'source' ? 'source' : 'build';
}

function createMissionMcpBridgeToolInputSchema(toolName: string) {
    const payloadSchema = readSignalToolPayloadSchema(toolName);
    return payloadSchema ? MissionMcpBridgeToolInputBaseSchema.extend(payloadSchema.shape).strict() : MissionMcpBridgeToolInputBaseSchema;
}

function createMissionMcpEventId(toolName: string): string {
    return `mcp:${toolName}:${randomUUID()}`;
}

function readMissionMcpBridgeSignalPayload(toolName: string, input: unknown): Record<string, unknown> {
    const payloadSchema = readSignalToolPayloadSchema(toolName);
    if (!payloadSchema) {
        throw new Error(`Tool '${toolName}' is not a known Agent signal tool.`);
    }
    return payloadSchema.parse(omitTransportFields(input)) as Record<string, unknown>;
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
