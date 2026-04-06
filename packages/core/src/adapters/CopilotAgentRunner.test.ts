import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionEvent, AgentSessionStartRequest } from '../runtime/AgentRuntimeTypes.js';

const mockStart = vi.fn();
const mockGetStatus = vi.fn();
const mockCreateSession = vi.fn();
const mockResumeSession = vi.fn();
const mockForceStop = vi.fn();

function createMockSdkSession() {
    return {
        send: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
        disconnect: vi.fn(async () => undefined),
        rpc: {
            mode: {
                set: vi.fn(async () => undefined)
            }
        }
    };
}

vi.mock('@github/copilot-sdk', () => {
    class CopilotClient {
        public constructor(_config: unknown) { }

        public readonly start = mockStart;
        public readonly getStatus = mockGetStatus;
        public readonly createSession = mockCreateSession;
        public readonly resumeSession = mockResumeSession;
        public readonly forceStop = mockForceStop;
    }

    return { CopilotClient };
});

import { CopilotAgentRunner } from './CopilotAgentRunner.js';

function createStartRequest(overrides: Partial<AgentSessionStartRequest> = {}): AgentSessionStartRequest {
    return {
        missionId: 'mission-1',
        taskId: 'task-1',
        workingDirectory: '/tmp/work',
        initialPrompt: {
            source: 'engine',
            text: 'Implement the task.'
        },
        ...overrides
    };
}

describe('CopilotAgentRunner', () => {
    beforeEach(() => {
        mockStart.mockReset().mockResolvedValue(undefined);
        mockGetStatus.mockReset().mockResolvedValue({ protocolVersion: 1, version: '1.0.0' });
        mockCreateSession.mockReset().mockResolvedValue(createMockSdkSession());
        mockResumeSession.mockReset().mockResolvedValue(createMockSdkSession());
        mockForceStop.mockReset().mockResolvedValue(undefined);
    });

    it('rejects unsupported structured commands with command.rejected event', async () => {
        const runner = new CopilotAgentRunner();
        const session = await runner.startSession(createStartRequest());
        const events: AgentSessionEvent[] = [];
        session.onDidEvent((event) => {
            events.push(event);
        });

        await expect(session.submitCommand({ kind: 'finish' })).rejects.toThrow("Command 'finish' is unsupported");

        const rejection = events.find((event) => event.type === 'command.rejected');
        expect(rejection).toBeDefined();
        if (rejection && rejection.type === 'command.rejected') {
            expect(rejection.command.kind).toBe('finish');
        }
    });

    it('prevents prompt submission after a session reaches a terminal phase', async () => {
        const runner = new CopilotAgentRunner();
        const session = await runner.startSession(createStartRequest());

        await session.terminate('done');

        await expect(
            session.submitPrompt({
                source: 'engine',
                text: 'extra prompt'
            })
        ).rejects.toThrow('because it is terminated');
    });

    it('maps MCP server references into SDK session configuration', async () => {
        const runner = new CopilotAgentRunner();

        await runner.startSession(createStartRequest({
            mcpServers: [
                {
                    name: 'local-mcp',
                    transport: 'stdio',
                    command: 'node',
                    args: ['server.mjs'],
                    env: { NODE_ENV: 'test' }
                },
                {
                    name: 'remote-mcp',
                    transport: 'sse',
                    url: 'https://example.test/mcp'
                }
            ]
        }));

        expect(mockCreateSession).toHaveBeenCalledTimes(1);
        const sessionConfig = mockCreateSession.mock.calls[0]?.[0] as {
            mcpServers?: Record<string, { type: string; command?: string; args?: string[]; url?: string }>;
        };

        expect(sessionConfig.mcpServers?.['local-mcp']).toMatchObject({
            type: 'local',
            command: 'node',
            args: ['server.mjs']
        });
        expect(sessionConfig.mcpServers?.['remote-mcp']).toMatchObject({
            type: 'http',
            url: 'https://example.test/mcp'
        });
    });

    it('resumes sessions through SDK when attaching by reference', async () => {
        const runner = new CopilotAgentRunner();

        await runner.attachSession({
            runnerId: 'copilot',
            sessionId: 'resumed-session'
        });

        expect(mockResumeSession).toHaveBeenCalledTimes(1);
        expect(mockResumeSession).toHaveBeenCalledWith(
            'resumed-session',
            expect.objectContaining({
                onEvent: expect.any(Function),
                onPermissionRequest: expect.any(Function),
                onUserInputRequest: expect.any(Function)
            })
        );
    });

    it('materializes a terminated session when attach targets a dead provider session', async () => {
        mockResumeSession.mockReset().mockRejectedValue(new Error('missing session'));
        const runner = new CopilotAgentRunner();
        const attached = await runner.attachSession({
            runnerId: 'copilot',
            sessionId: 'missing-session'
        });
        const events: AgentSessionEvent[] = [];
        attached.onDidEvent((event) => {
            events.push(event);
        });

        await Promise.resolve();
        await Promise.resolve();

        expect(attached.getSnapshot().phase).toBe('terminated');
        expect(attached.getSnapshot().failureMessage).toContain('no longer exists');
        expect(events[0]?.type).toBe('session.terminated');
    });
});
