import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { DaemonClient } from '@flying-pillow/mission-core/daemon/client/DaemonClient';
import {
    AgentSignalPayloadSchema,
    AgentSignalToolPayloadSchemasByType
} from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import { z } from 'zod/v4';
import type { EntryContext } from './entryContext.js';

const MissionMcpBridgeToolInputBaseSchema = z.object({
    eventId: z.string().trim().min(1).optional()
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

    const client = new DaemonClient();
    await client.connect({ surfacePath: context.workingDirectory });
    const tools = await client.request<MissionMcpToolDescriptor[]>('mission-mcp.listTools', {
        agentExecutionId,
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
            });
            return {
                content: [{ type: 'text', text: JSON.stringify(result) }],
                structuredContent: result as Record<string, unknown>
            };
        });
    }

    await server.connect(new StdioServerTransport());
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
        throw new Error(`Tool '${toolName}' is not a known Agent-declared signal tool.`);
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
