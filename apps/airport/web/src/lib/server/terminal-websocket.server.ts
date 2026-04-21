import {
    DaemonApi,
    missionTerminalOutputDtoSchema,
    missionTerminalSnapshotDtoSchema,
    missionTerminalSocketClientMessageSchema,
    missionTerminalSocketServerMessageSchema,
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
import { resolveMissionTerminalRuntimeError } from './mission-terminal-errors';
import { AirportWebGateway } from './gateway/AirportWebGateway.server';

const TERMINAL_WS_PATH_PATTERN = /^\/api\/runtime\/sessions\/([^/]+)\/terminal\/ws$/u;
const MISSION_TERMINAL_WS_PATH_PATTERN = /^\/api\/runtime\/missions\/([^/]+)\/terminal\/ws$/u;
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
        const terminalContext = resolveTerminalContext(request);
        if (!terminalContext) {
            return;
        }

        webSocketServer.handleUpgrade(request, socket, head, (webSocket: NodeWebSocket) => {
            webSocketServer.emit('connection', webSocket, request, terminalContext);
        });
    });

    webSocketServer.on('connection', (webSocket: NodeWebSocket, request: IncomingMessage, context: { kind: 'mission'; missionId: string } | { kind: 'session'; sessionId: string }) => {
        if (context.kind === 'mission') {
            void handleMissionTerminalConnection(webSocket, request, context.missionId);
            return;
        }
        void handleTerminalConnection(webSocket, request, context.sessionId);
    });
}

function resolveTerminalContext(request: IncomingMessage): { kind: 'mission'; missionId: string } | { kind: 'session'; sessionId: string } | undefined {
    const requestUrl = request.url?.trim();
    if (!requestUrl) {
        return undefined;
    }
    const parsedUrl = new URL(requestUrl, 'http://localhost');
    const sessionMatch = parsedUrl.pathname.match(TERMINAL_WS_PATH_PATTERN);
    if (sessionMatch?.[1]) {
        return {
            kind: 'session',
            sessionId: missionSessionTerminalRouteParamsSchema.parse({ sessionId: decodeURIComponent(sessionMatch[1]) }).sessionId
        };
    }

    const missionMatch = parsedUrl.pathname.match(MISSION_TERMINAL_WS_PATH_PATTERN);
    if (!missionMatch?.[1]) {
        return undefined;
    }

    return {
        kind: 'mission',
        missionId: decodeURIComponent(missionMatch[1]).trim()
    };
}

async function handleTerminalConnection(
    webSocket: NodeWebSocket,
    request: IncomingMessage,
    sessionId: string
): Promise<void> {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const query = missionSessionTerminalQuerySchema.extend({
        repositoryId: missionSessionTerminalQuerySchema.shape.missionId.optional(),
        repositoryRootPath: missionSessionTerminalQuerySchema.shape.missionId.optional()
    }).parse({
        missionId: requestUrl.searchParams.get('missionId'),
        repositoryId: requestUrl.searchParams.get('repositoryId') ?? undefined,
        repositoryRootPath: requestUrl.searchParams.get('repositoryRootPath') ?? undefined
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
        const repositoryRootPath = query.repositoryRootPath?.trim()
            || (query.repositoryId
                ? (await new AirportWebGateway().resolveRepositoryCandidate({ repositoryId: query.repositoryId })).repositoryRootPath
                : undefined);
        daemon = await connectDedicatedAuthenticatedDaemonClient({
            allowStart: false,
            ...(repositoryRootPath ? { surfacePath: repositoryRootPath } : {})
        });
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
        sendError(resolveMissionTerminalRuntimeError(error).message);
        dispose();
        webSocket.close();
    }
}

async function handleMissionTerminalConnection(
    webSocket: NodeWebSocket,
    request: IncomingMessage,
    missionId: string
): Promise<void> {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const repositoryId = requestUrl.searchParams.get('repositoryId')?.trim();
    const requestedRepositoryRootPath = requestUrl.searchParams.get('repositoryRootPath')?.trim();
    let daemon: Awaited<ReturnType<typeof connectDedicatedAuthenticatedDaemonClient>> | undefined;
    let api: DaemonApi | undefined;
    let closed = false;
    let subscription: { dispose(): void } | undefined;
    let sessionId: string | undefined;

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
        const snapshot = missionTerminalSnapshotDtoSchema.parse({
            missionId,
            connected: state?.connected ?? false,
            dead: state?.dead ?? true,
            exitCode: state?.dead ? state.exitCode : null,
            screen: terminalScreen.screen,
            ...(state?.truncated || terminalScreen.truncated ? { truncated: true } : {}),
            ...(state?.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
        });
        send(missionTerminalSocketServerMessageSchema.parse({ type, snapshot }));
    };

    const sendOutput = (state: MissionAgentTerminalState) => {
        const output = missionTerminalOutputDtoSchema.parse({
            missionId,
            chunk: state.chunk ?? '',
            dead: state.dead,
            exitCode: state.dead ? state.exitCode : null,
            ...(state.truncated ? { truncated: true } : {}),
            ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
        });
        send(missionTerminalSocketServerMessageSchema.parse({ type: 'output', output }));
    };

    const sendError = (message: string) => {
        send(missionTerminalSocketServerMessageSchema.parse({
            type: 'error',
            message
        }));
    };

    try {
        const repositoryRootPath = requestedRepositoryRootPath
            || (repositoryId
                ? (await new AirportWebGateway().resolveRepositoryCandidate({ repositoryId })).repositoryRootPath
                : undefined);
        daemon = await connectDedicatedAuthenticatedDaemonClient({
            allowStart: false,
            ...(repositoryRootPath ? { surfacePath: repositoryRootPath } : {})
        });
        api = new DaemonApi(daemon.client);
        const initialState = await api.mission.getMissionTerminalState({ missionId });
        sessionId = initialState?.sessionId?.trim();
        if (!sessionId) {
            sendSnapshot(initialState);
            sendSnapshot(initialState, 'disconnected');
            dispose();
            webSocket.close();
            return;
        }
        await daemon.client.request<null>('event.subscribe', {
            eventTypes: ['session.terminal'],
            missionId,
            sessionId
        });

        sendSnapshot(initialState);
        if (!initialState?.connected || initialState.dead) {
            sendSnapshot(initialState, 'disconnected');
            dispose();
            webSocket.close();
            return;
        }

        subscription = daemon.client.onDidEvent((event: Notification) => {
            if (event.type !== 'session.terminal' || event.missionId !== missionId || event.sessionId !== sessionId) {
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
                const message = missionTerminalSocketClientMessageSchema.parse(JSON.parse(rawMessage.toString()));
                const nextState = await daemon?.client.request<MissionAgentTerminalState | null>('mission.terminal.input', {
                    selector: { missionId },
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
                });
                if (message.type === 'input') {
                    return;
                }
                if (message.type === 'resize' && nextState === null) {
                    const currentState = await api?.mission.getMissionTerminalState({ missionId });
                    if (!currentState) {
                        sendError(`Mission terminal for '${missionId}' is not available.`);
                        return;
                    }
                    sendSnapshot(currentState, currentState.dead || !currentState.connected ? 'disconnected' : 'snapshot');
                    return;
                }
                if (!nextState) {
                    sendError(`Mission terminal for '${missionId}' is not available.`);
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
        sendError(resolveMissionTerminalRuntimeError(error).message);
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