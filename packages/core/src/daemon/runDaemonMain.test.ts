import { describe, expect, it, vi } from 'vitest';
import { MissionRegistry } from './MissionRegistry.js';
import { createResponse, resolveMutationNotificationEntityId } from './runDaemonMain.js';

vi.mock('./MissionTerminal.js', () => ({
    ensureMissionTerminalState: vi.fn(async () => ({
        sessionId: 'mission-shell:connect-four:fixture:1-initial-setup',
        connected: true,
        dead: false,
        exitCode: null,
        screen: '$ ',
        terminalHandle: {
            sessionName: 'mission-shell:connect-four:fixture:1-initial-setup',
            paneId: 'pty'
        }
    })),
    sendMissionTerminalInput: vi.fn(async () => ({
        sessionId: 'mission-shell:connect-four:fixture:1-initial-setup',
        connected: true,
        dead: false,
        exitCode: null,
        screen: '$ printf daemon-terminal-test\ndaemon-terminal-test\n$ ',
        terminalHandle: {
            sessionName: 'mission-shell:connect-four:fixture:1-initial-setup',
            paneId: 'pty'
        }
    })),
    observeMissionTerminalUpdates: vi.fn(() => ({ dispose: vi.fn() }))
}));

describe('minimal source daemon request handling', () => {
    it('resolves notification ids for mission-owned child command acknowledgements', () => {
        expect(resolveMutationNotificationEntityId('Task', {
            ok: true,
            entity: 'Task',
            method: 'command',
            id: 'spec/01-spec-from-prd',
            missionId: '4-prepare-repo-for-mission',
            taskId: 'spec/01-spec-from-prd',
            commandId: 'task.start'
        })).toBe('task:4-prepare-repo-for-mission/spec/01-spec-from-prd');

        expect(resolveMutationNotificationEntityId('Stage', {
            ok: true,
            entity: 'Stage',
            method: 'command',
            id: 'spec',
            missionId: '4-prepare-repo-for-mission',
            stageId: 'spec',
            commandId: 'stage.generateTasks'
        })).toBe('stage:4-prepare-repo-for-mission/spec');

        expect(resolveMutationNotificationEntityId('AgentSession', {
            ok: true,
            entity: 'AgentSession',
            method: 'command',
            id: 'session-1',
            missionId: '4-prepare-repo-for-mission',
            sessionId: 'session-1',
            commandId: 'agentSession.cancel'
        })).toBe('agent_session:4-prepare-repo-for-mission/session-1');
    });

    it('acknowledges event subscriptions so SSE streams can stay open', async () => {
        await expect(createResponse({
            type: 'request',
            id: 'request-1',
            method: 'event.subscribe',
            params: {
                channels: ['mission:mission-29.status']
            }
        }, '2026-04-26T18:05:00.000Z')).resolves.toEqual({
            type: 'response',
            id: 'request-1',
            ok: true,
            result: null
        });
    });

    it('returns a mission terminal snapshot for mission entity ensure requests', async () => {
        const services = createMissionTerminalServices();
        const response = await createResponse({
            type: 'request',
            id: 'request-mission-terminal-ensure',
            method: 'entity.command',
            surfacePath: '/repositories/Flying-Pillow/connect-four',
            params: {
                entity: 'Mission',
                method: 'ensureTerminal',
                payload: { missionId: '1-initial-setup' }
            }
        }, '2026-04-26T18:15:00.000Z', services);

        expect(response.type).toBe('response');
        expect(response.id).toBe('request-mission-terminal-ensure');
        expect(response.ok).toBe(true);
        if (!response.ok) {
            return;
        }
        expect(response.result).toMatchObject({
            missionId: '1-initial-setup',
            connected: true,
            dead: false,
            exitCode: null,
            screen: expect.any(String)
        });
    });

    it('returns a mission terminal snapshot for mission entity input requests after explicit ensure', async () => {
        const services = createMissionTerminalServices();
        await createResponse({
            type: 'request',
            id: 'request-mission-terminal-ensure-for-input',
            method: 'entity.command',
            surfacePath: '/repositories/Flying-Pillow/connect-four',
            params: {
                entity: 'Mission',
                method: 'ensureTerminal',
                payload: { missionId: '1-initial-setup' }
            }
        }, '2026-04-26T18:15:00.000Z', services);

        const response = await createResponse({
            type: 'request',
            id: 'request-mission-terminal-input',
            method: 'entity.command',
            surfacePath: '/repositories/Flying-Pillow/connect-four',
            params: {
                entity: 'Mission',
                method: 'sendTerminalInput',
                payload: {
                    missionId: '1-initial-setup',
                    data: 'printf daemon-terminal-test\n'
                }
            }
        }, '2026-04-26T18:15:00.000Z', services);

        expect(response.type).toBe('response');
        expect(response.id).toBe('request-mission-terminal-input');
        expect(response.ok).toBe(true);
        if (!response.ok) {
            return;
        }
        expect(response.result).toMatchObject({
            missionId: '1-initial-setup',
            connected: true,
            dead: false,
            exitCode: null,
            screen: expect.any(String)
        });
    });

    function createMissionTerminalServices() {
        const mission = {
            ensureTerminal: vi.fn(async (payload: { missionId: string }) => ({
                missionId: payload.missionId,
                connected: true,
                dead: false,
                exitCode: null,
                screen: '$ '
            })),
            sendTerminalInput: vi.fn(async (payload: { missionId: string }) => ({
                missionId: payload.missionId,
                connected: true,
                dead: false,
                exitCode: null,
                screen: '$ printf daemon-terminal-test\ndaemon-terminal-test\n$ '
            }))
        };
        const missionRegistry = new MissionRegistry();
        vi.spyOn(missionRegistry, 'loadRequiredMission').mockResolvedValue(mission as never);
        return { missionRegistry };
    }
});