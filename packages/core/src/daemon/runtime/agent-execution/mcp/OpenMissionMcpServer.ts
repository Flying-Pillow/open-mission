import { z } from 'zod/v4';

export const OpenMissionMcpRegisterAccessInputSchema = z.record(z.string(), z.unknown());
export const OpenMissionMcpListToolsInputSchema = z.record(z.string(), z.unknown());
export const OpenMissionMcpCallToolInputSchema = z.object({
    name: z.string().trim().min(1),
    arguments: z.record(z.string(), z.unknown()).optional()
}).strict();

export class OpenMissionMcpServer {
    public constructor(_options: { agentExecutionRegistry?: unknown; logger?: unknown } = {}) { }

    public async start(): Promise<void> { }

    public async stop(): Promise<void> { }

    public registerAccess(_input: unknown): { ok: true } {
        return { ok: true };
    }

    public listTools(_input: unknown): { tools: [] } {
        return { tools: [] };
    }

    public async callTool(_input: unknown): Promise<{ ok: true; content: [] }> {
        return { ok: true, content: [] };
    }
}