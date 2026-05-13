import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectSharedAuthenticatedDaemonClient = vi.fn();
const resetSharedAuthenticatedDaemonClient = vi.fn();
const isRecoverableDaemonConnectionError = vi.fn((error: unknown) => (
    error instanceof Error && error.message === 'Open Mission daemon connection closed.'
));

vi.mock('./connections.server', () => ({
    connectSharedAuthenticatedDaemonClient,
    resetSharedAuthenticatedDaemonClient,
    isRecoverableDaemonConnectionError
}));

describe('EntityProxy', () => {
    beforeEach(() => {
        vi.useRealTimers();
        vi.resetModules();
        vi.clearAllMocks();
        isRecoverableDaemonConnectionError.mockImplementation((error: unknown) => (
            error instanceof Error && error.message === 'Open Mission daemon connection closed.'
        ));
    });

    it('reconnects once when a daemon restart closes the shared client during a command', async () => {
        const staleClient = {
            request: vi.fn().mockRejectedValue(new Error('Open Mission daemon connection closed.'))
        };
        const freshClient = {
            request: vi.fn().mockResolvedValue({ accepted: true })
        };
        const staleDispose = vi.fn();
        const freshDispose = vi.fn();

        connectSharedAuthenticatedDaemonClient
            .mockResolvedValueOnce({ client: staleClient, dispose: staleDispose })
            .mockResolvedValueOnce({ client: freshClient, dispose: freshDispose });

        const { EntityProxy } = await import('./entity-proxy');
        const result = await new EntityProxy().executeEntityCommand({
            entity: 'Task',
            method: 'command',
            payload: {
                missionId: 'mission-31',
                taskId: 'implementation/04-agent-signal-parser',
                commandId: 'task.complete'
            }
        });

        expect(result).toEqual({ accepted: true });
        expect(resetSharedAuthenticatedDaemonClient).toHaveBeenCalledTimes(1);
        expect(connectSharedAuthenticatedDaemonClient).toHaveBeenCalledTimes(2);
        expect(staleDispose).toHaveBeenCalledTimes(1);
        expect(freshDispose).toHaveBeenCalledTimes(1);
        expect(freshClient.request).toHaveBeenCalledWith('entity.command', {
            entity: 'Task',
            method: 'command',
            payload: {
                missionId: 'mission-31',
                taskId: 'implementation/04-agent-signal-parser',
                commandId: 'task.complete'
            }
        });
    });

    it('does not retry non-transport command errors', async () => {
        const client = {
            request: vi.fn().mockRejectedValue(new Error('Task is not completable.'))
        };
        const dispose = vi.fn();
        connectSharedAuthenticatedDaemonClient.mockResolvedValueOnce({ client, dispose });

        const { EntityProxy } = await import('./entity-proxy');
        await expect(new EntityProxy().executeEntityCommand({
            entity: 'Task',
            method: 'command',
            payload: {
                missionId: 'mission-31',
                taskId: 'implementation/04-agent-signal-parser',
                commandId: 'task.complete'
            }
        })).rejects.toThrow('Task is not completable.');

        expect(resetSharedAuthenticatedDaemonClient).not.toHaveBeenCalled();
        expect(connectSharedAuthenticatedDaemonClient).toHaveBeenCalledTimes(1);
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('routes Repository commands with repositoryRootPath to the repository daemon surface', async () => {
        const client = {
            request: vi.fn().mockResolvedValue({ agentExecutionId: 'repository-chat' })
        };
        const dispose = vi.fn();
        connectSharedAuthenticatedDaemonClient.mockResolvedValueOnce({ client, dispose });

        const { EntityProxy } = await import('./entity-proxy');
        await expect(new EntityProxy().executeEntityCommand({
            entity: 'Repository',
            method: 'ensureRepositoryAgentExecution',
            payload: {
                id: 'repository:github/Flying-Pillow/connect-four',
                repositoryRootPath: '/repositories/Flying-Pillow/connect-four'
            }
        })).resolves.toEqual({ agentExecutionId: 'repository-chat' });

        expect(connectSharedAuthenticatedDaemonClient).toHaveBeenCalledWith({
            locals: undefined,
            surfacePath: '/repositories/Flying-Pillow/connect-four'
        });
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('routes repository-owned AgentExecution commands to the owner daemon surface', async () => {
        const client = {
            request: vi.fn().mockResolvedValue({ ok: true })
        };
        const dispose = vi.fn();
        connectSharedAuthenticatedDaemonClient.mockResolvedValueOnce({ client, dispose });

        const { EntityProxy } = await import('./entity-proxy');
        await expect(new EntityProxy().executeEntityCommand({
            entity: 'AgentExecution',
            method: 'command',
            payload: {
                ownerId: '/repositories/Flying-Pillow/connect-four',
                agentExecutionId: 'repository-chat',
                commandId: 'agentExecution.sendPrompt'
            }
        })).resolves.toEqual({ ok: true });

        expect(connectSharedAuthenticatedDaemonClient).toHaveBeenCalledWith({
            locals: undefined,
            surfacePath: '/repositories/Flying-Pillow/connect-four'
        });
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it.each([
        'add',
        'indexCode',
        'setup',
        'startMissionFromIssue',
        'startMissionFromBrief'
    ])('allows Repository %s commands to outlive the default entity timeout', async (method) => {
        vi.useFakeTimers();
        const client = {
            request: vi.fn().mockImplementation(() => new Promise((resolve) => {
                setTimeout(() => resolve({ ok: true, method }), 9_000);
            }))
        };
        const dispose = vi.fn();
        connectSharedAuthenticatedDaemonClient.mockResolvedValueOnce({ client, dispose });

        const { EntityProxy } = await import('./entity-proxy');
        const resultPromise = new EntityProxy().executeEntityCommand({
            entity: 'Repository',
            method,
            payload: {
                id: 'repository:github/Flying-Pillow/connect-four',
                repositoryRootPath: '/repositories/Flying-Pillow/connect-four',
                issueNumber: 1
            }
        });

        await vi.advanceTimersByTimeAsync(9_000);

        await expect(resultPromise).resolves.toEqual({ ok: true, method });
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('allows Repository readCodeIntelligenceIndex queries to outlive the default entity timeout', async () => {
        vi.useFakeTimers();
        const client = {
            request: vi.fn().mockImplementation(() => new Promise((resolve) => {
                setTimeout(() => resolve({ snapshot: null }), 9_000);
            }))
        };
        const dispose = vi.fn();
        connectSharedAuthenticatedDaemonClient.mockResolvedValueOnce({ client, dispose });

        const { EntityProxy } = await import('./entity-proxy');
        const resultPromise = new EntityProxy().executeEntityQuery({
            entity: 'Repository',
            method: 'readCodeIntelligenceIndex',
            payload: {
                id: 'repository:github/Flying-Pillow/connect-four',
                repositoryRootPath: '/repositories/Flying-Pillow/connect-four'
            }
        });

        await vi.advanceTimersByTimeAsync(9_000);

        await expect(resultPromise).resolves.toEqual({ snapshot: null });
        expect(connectSharedAuthenticatedDaemonClient).toHaveBeenCalledWith({
            locals: undefined,
            surfacePath: '/repositories/Flying-Pillow/connect-four'
        });
        expect(dispose).toHaveBeenCalledTimes(1);
    });
});