import {
    DaemonApi,
    missionSessionTerminalOutputDtoSchema,
    missionSessionTerminalSnapshotDtoSchema,
    missionSessionTerminalSocketClientMessageSchema,
    missionSessionTerminalSocketServerMessageSchema,
    missionSessionTerminalRouteParamsSchema,
    missionSessionTerminalQuerySchema,
    type Notification,
    type MissionAgentTerminalState
} from '@flying-pillow/mission-core';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
import { connectDedicatedAuthenticatedDaemonClient } from './daemon/connections.server';

const TERMINAL_WS_PATH_PATTERN = /^\/api\/runtime\/sessions\/([^/]+)\/terminal\/ws$/u;
const AIRPORT_WEB_TERMINAL_SCREEN_LIMIT = 40_000;
type UpgradeCapableServer = {
    on(event: 'upgrade', listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
};

const attachedServers = new WeakSet<UpgradeCapableServer>();

export function attachTerminalWebSocketServer(server: UpgradeCapableServer): void {
    if (attachedServers.has(server)) {
        return;
    }
    attachedServers.add(server);

    const webSocketServer = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
        const sessionId = resolveSessionId(request);
        if (!sessionId) {
            return;
        }

        webSocketServer.handleUpgrade(request, socket, head, (webSocket: NodeWebSocket) => {
            webSocketServer.emit('connection', webSocket, request, { sessionId });
        });
    });

    webSocketServer.on('connection', (webSocket: NodeWebSocket, request: IncomingMessage, context: { sessionId: string }) => {
        void handleTerminalConnection(webSocket, request, context.sessionId);
    });
}

function resolveSessionId(request: IncomingMessage): string | undefined {
    const requestUrl = request.url?.trim();
    if (!requestUrl) {
        return undefined;
    }
    const parsedUrl = new URL(requestUrl, 'http://localhost');
    const match = parsedUrl.pathname.match(TERMINAL_WS_PATH_PATTERN);
    if (!match?.[1]) {
        return undefined;
    }
    return missionSessionTerminalRouteParamsSchema.parse({ sessionId: decodeURIComponent(match[1]) }).sessionId;
}

async function handleTerminalConnection(
    webSocket: NodeWebSocket,
    request: IncomingMessage,
    sessionId: string
): Promise<void> {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const query = missionSessionTerminalQuerySchema.parse({
        missionId: requestUrl.searchParams.get('missionId')
    });

    let daemon: Awaited<ReturnType<typeof connectDedicatedAuthenticatedDaemonClient>> | undefined;
    let api: DaemonApi | undefined;
    let closed = false;
    let subscription: { dispose(): void } | undefined;

    const dispose = () => {
        if (closed) {
            return;
        }
        closed = true;
        subscription?.dispose();
        daemon?.dispose();
    };

    const send = (payload: unknown) => {
        if (closed || webSocket.readyState !== NodeWebSocket.OPEN) {
            return;
        }
        webSocket.send(JSON.stringify(payload));
    };

    const sendSnapshot = (state: MissionAgentTerminalState | null, type: 'snapshot' | 'disconnected' = 'snapshot') => {
        const terminalScreen = clipTerminalScreen(state?.screen ?? '');
        const snapshot = missionSessionTerminalSnapshotDtoSchema.parse({
            missionId: query.missionId,
            sessionId,
            connected: state?.connected ?? false,
            dead: state?.dead ?? true,
            exitCode: state?.dead ? state.exitCode : null,
            screen: terminalScreen.screen,
            ...(state?.truncated || terminalScreen.truncated ? { truncated: true } : {}),
            ...(state?.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
        });
        send(missionSessionTerminalSocketServerMessageSchema.parse({ type, snapshot }));
    };

    const sendOutput = (state: MissionAgentTerminalState) => {
        const output = missionSessionTerminalOutputDtoSchema.parse({
            missionId: query.missionId,
            sessionId,
            chunk: state.chunk ?? '',
            dead: state.dead,
            exitCode: state.dead ? state.exitCode : null,
            ...(state.truncated ? { truncated: true } : {}),
            ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
        });
        send(missionSessionTerminalSocketServerMessageSchema.parse({ type: 'output', output }));
    };

    const sendError = (message: string) => {
        send(missionSessionTerminalSocketServerMessageSchema.parse({
            type: 'error',
            message
        }));
    };

    try {
        daemon = await connectDedicatedAuthenticatedDaemonClient({ allowStart: false });
        api = new DaemonApi(daemon.client);
        await daemon.client.request<null>('event.subscribe', {
            eventTypes: ['session.terminal'],
            missionId: query.missionId,
            sessionId
        });

        const initialState = await api.mission.getSessionTerminalState({ missionId: query.missionId }, sessionId);
        sendSnapshot(initialState);
        if (!initialState?.connected || initialState.dead) {
            sendSnapshot(initialState, 'disconnected');
            dispose();
            webSocket.close();
            return;
        }

        subscription = daemon.client.onDidEvent((event: Notification) => {
            if (event.type !== 'session.terminal' || event.missionId !== query.missionId || event.sessionId !== sessionId) {
                return;
            }

            const state = event.state;
            if (!state.connected || state.dead) {
                sendSnapshot(state, 'disconnected');
                dispose();
                webSocket.close();
                return;
            }

            if (typeof state.chunk === 'string' && state.chunk.length > 0) {
                sendOutput(state);
                return;
            }

            sendSnapshot(state);
        });

        webSocket.on('message', async (rawMessage: Buffer) => {
            try {
                const message = missionSessionTerminalSocketClientMessageSchema.parse(JSON.parse(rawMessage.toString()));
                const inputParams = {
                    selector: { missionId: query.missionId },
                    sessionId,
                    respondWithState: false,
                    ...(message.type === 'input'
                        ? {
                            data: message.data,
                            ...(message.literal !== undefined ? { literal: message.literal } : {})
                        }
                        : {
                            cols: message.cols,
                            rows: message.rows
                        })
                };
                const nextState = await daemon?.client.request<MissionAgentTerminalState | null>('session.terminal.input', inputParams);
                if (message.type === 'input') {
                    return;
                }
                if (message.type === 'resize' && nextState === null) {
                    const currentState = await api?.mission.getSessionTerminalState({ missionId: query.missionId }, sessionId);
                    if (!currentState) {
                        sendError(`Mission session '${sessionId}' is not available as a terminal-backed session.`);
                        return;
                    }
                    sendSnapshot(currentState, currentState.dead || !currentState.connected ? 'disconnected' : 'snapshot');
                    return;
                }
                if (!nextState) {
                    sendError(`Mission session '${sessionId}' is not available as a terminal-backed session.`);
                    return;
                }
                if (message.type === 'resize' || nextState.dead || !nextState.connected) {
                    sendSnapshot(nextState, nextState.dead || !nextState.connected ? 'disconnected' : 'snapshot');
                }
            } catch (error) {
                sendError(error instanceof Error ? error.message : String(error));
            }
        });

        webSocket.once('close', dispose);
        webSocket.once('error', dispose);
    } catch (error) {
        sendError(error instanceof Error ? error.message : String(error));
        dispose();
        webSocket.close();
    }
}

function clipTerminalScreen(screen: string): { screen: string; truncated: boolean } {
    if (screen.length <= AIRPORT_WEB_TERMINAL_SCREEN_LIMIT) {
        return { screen, truncated: false };
    }

    return {
        screen: screen.slice(-AIRPORT_WEB_TERMINAL_SCREEN_LIMIT),
        truncated: true
    };
}