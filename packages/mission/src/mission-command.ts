#!/usr/bin/env node

import { connectDaemon } from '@flying-pillow/mission-core/daemon/client/connectAirportDaemon';

type JsonRpcRequest = {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: unknown;
};

type McpTool = {
	name: string;
	description: string;
	inputSchema: {
		type: 'object';
		additionalProperties: boolean;
	};
};

const toolDescriptions: Record<string, string> = {
	progress: 'Report structured progress.',
	request_input: 'Ask for an operator decision.',
	blocked: 'Report that the session is blocked.',
	ready: 'Report ready-for-verification.',
	complete: 'Report a completion claim.',
	fail: 'Report a failure claim.',
	note: 'Append a short session note.',
	usage: 'Attach structured usage metadata.',
	entity: 'Invoke an allowlisted entity command.'
};

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
	buffer += chunk;
	while (true) {
		const newlineIndex = buffer.indexOf('\n');
		if (newlineIndex < 0) return;
		const line = buffer.slice(0, newlineIndex).trim();
		buffer = buffer.slice(newlineIndex + 1);
		if (line) void handleLine(line);
	}
});

async function handleLine(line: string): Promise<void> {
	let request: JsonRpcRequest;
	try {
		request = JSON.parse(line) as JsonRpcRequest;
	} catch (error) {
		writeResponse(null, undefined, error);
		return;
	}

	try {
		switch (request.method) {
			case 'initialize':
				writeResponse(request.id, {
					protocolVersion: '2024-11-05',
					capabilities: { tools: {} },
					serverInfo: { name: 'mission', version: '0.1.0-alpha.0' }
				});
				return;
			case 'notifications/initialized':
				return;
			case 'tools/list':
				writeResponse(request.id, { tools: await listTools() });
				return;
			case 'tools/call':
				writeResponse(request.id, await callTool(request.params));
				return;
			default:
				writeResponse(request.id, undefined, new Error(`Unsupported MCP method '${String(request.method)}'.`));
		}
	} catch (error) {
		writeResponse(request.id, undefined, error);
	}
}

async function listTools(): Promise<McpTool[]> {
	const client = await connectDaemon(createDaemonConnectionOptions());
	try {
		const result = await client.request<{ tools: string[] }>('mcp.tools.list');
		return result.tools.map((toolName) => ({
			name: toolName,
			description: toolDescriptions[toolName] ?? `Mission MCP tool ${toolName}.`,
			inputSchema: {
				type: 'object',
				additionalProperties: true
			}
		}));
	} finally {
		client.dispose();
	}
}

async function callTool(params: unknown): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
	const parsed = parseToolCallParams(params);
	const client = await connectDaemon(createDaemonConnectionOptions());
	try {
		const result = await client.request('mcp.tool.invoke', {
			name: parsed.name,
			payload: parsed.arguments
		});
		const accepted = typeof result === 'object' && result !== null && (result as { accepted?: unknown }).accepted === true;
		return {
			content: [{ type: 'text', text: JSON.stringify(result) }],
			...(accepted ? {} : { isError: true })
		};
	} finally {
		client.dispose();
	}
}

function parseToolCallParams(params: unknown): { name: string; arguments: unknown } {
	if (!params || typeof params !== 'object' || Array.isArray(params)) {
		throw new Error('tools/call params must be an object.');
	}
	const record = params as Record<string, unknown>;
	if (typeof record['name'] !== 'string' || !record['name'].trim()) {
		throw new Error('tools/call requires a tool name.');
	}
	return {
		name: record['name'].trim(),
		arguments: record['arguments'] ?? {}
	};
}

function createDaemonConnectionOptions(): { surfacePath: string; authToken?: string } {
	const surfacePath = process.env['MISSION_ENTRY_CWD']?.trim() || process.cwd();
	const authToken = process.env['MISSION_MCP_SESSION_TOKEN']?.trim();
	return authToken ? { surfacePath, authToken } : { surfacePath };
}

function writeResponse(id: JsonRpcRequest['id'], result?: unknown, error?: unknown): void {
	if (id === undefined) return;
	const response = error === undefined
		? { jsonrpc: '2.0', id, result }
		: {
			jsonrpc: '2.0',
			id,
			error: {
				code: -32000,
				message: error instanceof Error ? error.message : String(error)
			}
		};
	process.stdout.write(`${JSON.stringify(response)}\n`);
}
