import {
    type Notification as DaemonNotification,
    type MissionAgentTerminalState
} from '@flying-pillow/mission-core/node';
import {
    MissionTerminalOutputSchema,
    MissionTerminalSnapshotSchema,
    MissionTerminalSocketClientMessageSchema,
    MissionTerminalSocketServerMessageSchema,
    type MissionTerminalSnapshotType
} from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import {
    AgentSessionTerminalOutputSchema,
    AgentSessionTerminalSnapshotSchema,
    AgentSessionTerminalSocketClientMessageSchema,
    AgentSessionTerminalSocketServerMessageSchema,
    AgentSessionTerminalRouteParamsSchema,
    AgentSessionTerminalQuerySchema,
    type AgentSessionTerminalSnapshotType
} from '@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
import { connectDedicatedAuthenticatedDaemonClient } from './daemon/connections.server';
import { resolveMissionTerminalRuntimeError } from './mission-terminal-errors';
import { DaemonGateway } from './daemon/daemon-gateway';

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
            sessionId: AgentSessionTerminalRouteParamsSchema.parse({ sessionId: decodeURIComponent(sessionMatch[1]) }).sessionId
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
    const query = AgentSessionTerminalQuerySchema.extend({
        repositoryId: AgentSessionTerminalQuerySchema.shape.missionId.optional(),
        repositoryRootPath: AgentSessionTerminalQuerySchema.shape.missionId.optional()
    }).parse({
        missionId: requestUrl.searchParams.get('missionId'),
        repositoryId: requestUrl.searchParams.get('repositoryId') ?? undefined,
        repositoryRootPath: requestUrl.searchParams.get('repositoryRootPath') ?? undefined
    });

    let daemon: Awaited<ReturnType<typeof connectDedicatedAuthenticatedDaemonClient>> | undefined;
    let closed = false;
    let subscription: { dispose(): void } | undefined;
    let terminalReady = false;
    const pendingMessages: Buffer[] = [];

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

    const sendSnapshot = (state: AgentSessionTerminalSnapshotType, type: 'snapshot' | 'disconnected' = 'snapshot') => {
        const terminalScreen = clipTerminalScreen(state.screen);
        const snapshot = AgentSessionTerminalSnapshotSchema.parse({
            missionId: query.missionId,
            sessionId,
            connected: state.connected,
            dead: state.dead,
            exitCode: state.dead ? state.exitCode : null,
            screen: terminalScreen.screen,
            ...(state.truncated || terminalScreen.truncated ? { truncated: true } : {}),
            ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
        });
        send(AgentSessionTerminalSocketServerMessageSchema.parse({ type, snapshot }));
    };

    const sendOutput = (state: MissionAgentTerminalState) => {
        const output = AgentSessionTerminalOutputSchema.parse({
            missionId: query.missionId,
            sessionId,
            chunk: state.chunk ?? '',
            dead: state.dead,
            exitCode: state.dead ? state.exitCode : null,
            ...(state.truncated ? { truncated: true } : {}),
            ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
        });
        send(AgentSessionTerminalSocketServerMessageSchema.parse({ type: 'output', output }));
    };

    const sendError = (message: string) => {
        send(AgentSessionTerminalSocketServerMessageSchema.parse({
            type: 'error',
            message
        }));
    };

    const processRawMessage = async (rawMessage: Buffer) => {
        try {
            const message = AgentSessionTerminalSocketClientMessageSchema.parse(JSON.parse(rawMessage.toString()));
            const nextState = AgentSessionTerminalSnapshotSchema.parse(await daemon?.client.request('entity.command', {
                entity: 'AgentSession',
                method: 'sendTerminalInput',
                payload: {
                    missionId: query.missionId,
                    sessionId,
                    ...(message.type === 'input'
                        ? {
                            data: message.data,
                            ...(message.literal !== undefined ? { literal: message.literal } : {})
                        }
                        : {
                            cols: message.cols,
                            rows: message.rows
                        })
                }
            }));
            if (message.type === 'input') {
                return;
            }
            if (message.type === 'resize' || nextState.dead || !nextState.connected) {
                sendSnapshot(nextState, nextState.dead || !nextState.connected ? 'disconnected' : 'snapshot');
            }
        } catch (error) {
            sendError(error instanceof Error ? error.message : String(error));
        }
    };

    webSocket.on('message', (rawMessage: Buffer) => {
        if (!terminalReady) {
            pendingMessages.push(Buffer.from(rawMessage));
            return;
        }
        void processRawMessage(Buffer.from(rawMessage));
    });

    try {
        const repositoryRootPath = query.repositoryRootPath ?? (query.repositoryId
            ? (await new DaemonGateway().resolveRepositoryCandidate({ id: query.repositoryId })).repositoryRootPath
            : undefined);
        daemon = await connectDedicatedAuthenticatedDaemonClient({
            allowStart: true,
            ...(repositoryRootPath ? { surfacePath: repositoryRootPath } : {})
        });
        await daemon.client.request<null>('event.subscribe', {
            channels: [`agent_session:${query.missionId}/${sessionId}.terminal`]
        });

        const initialState = AgentSessionTerminalSnapshotSchema.parse(await daemon.client.request('entity.query', {
            entity: 'AgentSession',
            method: 'readTerminal',
            payload: {
                missionId: query.missionId,
                sessionId
            }
        }));
        sendSnapshot(initialState);
        if (!initialState.connected || initialState.dead) {
            sendSnapshot(initialState, 'disconnected');
            dispose();
            webSocket.close();
            return;
        }

        subscription = daemon.client.onDidEvent((event: DaemonNotification) => {
            if (event.type !== 'session.terminal' || event.missionId !== query.missionId || event.sessionId !== sessionId) {
                return;
            }

            const state = event.state;
            const snapshot = AgentSessionTerminalSnapshotSchema.parse({
                missionId: query.missionId,
                sessionId,
                connected: state.connected,
                dead: state.dead,
                exitCode: state.dead ? state.exitCode : null,
                screen: state.screen,
                ...(state.chunk ? { chunk: state.chunk } : {}),
                ...(state.truncated ? { truncated: true } : {}),
                ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
            });
            if (!state.connected || state.dead) {
                sendSnapshot(snapshot, 'disconnected');
                dispose();
                webSocket.close();
                return;
            }

            if (typeof state.chunk === 'string' && state.chunk.length > 0) {
                sendOutput(state);
                return;
            }

            sendSnapshot(snapshot);
        });

        terminalReady = true;
        for (const rawMessage of pendingMessages.splice(0)) {
            await processRawMessage(rawMessage);
        }

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
    const queryRepositoryRootPath = requestUrl.searchParams.get('repositoryRootPath')?.trim() || undefined;
    let daemon: Awaited<ReturnType<typeof connectDedicatedAuthenticatedDaemonClient>> | undefined;
    let closed = false;
    let subscription: { dispose(): void } | undefined;
    let terminalReady = false;
    const pendingMessages: Buffer[] = [];
    let lastScreen = '';
    let lastDead = true;
    let repositoryRootPath: string | undefined;

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

    const sendSnapshot = (state: MissionTerminalSnapshotType, type: 'snapshot' | 'disconnected' = 'snapshot') => {
        const terminalScreen = clipTerminalScreen(state.screen);
        const snapshot = MissionTerminalSnapshotSchema.parse({
            missionId,
            connected: state.connected,
            dead: state.dead,
            exitCode: state.dead ? state.exitCode : null,
            screen: terminalScreen.screen,
            ...(state.truncated || terminalScreen.truncated ? { truncated: true } : {}),
            ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
        });
        send(MissionTerminalSocketServerMessageSchema.parse({ type, snapshot }));
    };

    const sendOutput = (state: MissionTerminalSnapshotType & { chunk?: string }) => {
        const output = MissionTerminalOutputSchema.parse({
            missionId,
            chunk: state.chunk ?? '',
            dead: state.dead,
            exitCode: state.dead ? state.exitCode : null,
            ...(state.truncated ? { truncated: true } : {}),
            ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
        });
        send(MissionTerminalSocketServerMessageSchema.parse({ type: 'output', output }));
    };

    const sendError = (message: string) => {
        send(MissionTerminalSocketServerMessageSchema.parse({
            type: 'error',
            message
        }));
    };

    const sendMissionState = (state: MissionTerminalSnapshotType) => {
        const appendedChunk = state.screen.startsWith(lastScreen)
            ? state.screen.slice(lastScreen.length)
            : undefined;
        const nextDisconnected = state.dead || !state.connected;

        if (typeof appendedChunk === 'string' && appendedChunk.length > 0 && !nextDisconnected) {
            sendOutput({
                ...state,
                chunk: appendedChunk,
            });
        } else {
            sendSnapshot(state, nextDisconnected ? 'disconnected' : 'snapshot');
        }

        lastScreen = state.screen;
        lastDead = state.dead;
    };

    const processRawMessage = async (rawMessage: Buffer) => {
        try {
            const message = MissionTerminalSocketClientMessageSchema.parse(JSON.parse(rawMessage.toString()));
            const nextState = MissionTerminalSnapshotSchema.parse(await daemon?.client.request('entity.command', {
                entity: 'Mission',
                method: 'sendTerminalInput',
                payload: {
                    missionId,
                    ...(message.type === 'input'
                        ? {
                            data: message.data,
                            ...(message.literal !== undefined ? { literal: message.literal } : {})
                        }
                        : {
                            cols: message.cols,
                            rows: message.rows
                        })
                }
            }));
            if (message.type === 'input') {
                return;
            }
            sendMissionState(nextState);
        } catch (error) {
            sendError(error instanceof Error ? error.message : String(error));
        }
    };

    webSocket.on('message', (rawMessage: Buffer) => {
        if (!terminalReady) {
            pendingMessages.push(Buffer.from(rawMessage));
            return;
        }
        void processRawMessage(Buffer.from(rawMessage));
    });

    try {
        repositoryRootPath = queryRepositoryRootPath ?? (repositoryId
            ? (await new DaemonGateway().resolveRepositoryCandidate({ id: repositoryId })).repositoryRootPath
            : undefined);
        daemon = await connectDedicatedAuthenticatedDaemonClient({
            allowStart: true,
            ...(repositoryRootPath ? { surfacePath: repositoryRootPath } : {})
        });
        await daemon.client.request<null>('event.subscribe', {
            channels: [`mission:${missionId}.terminal`]
        });
        const initialState = MissionTerminalSnapshotSchema.parse(await daemon.client.request('entity.command', {
            entity: 'Mission',
            method: 'ensureTerminal',
            payload: { missionId }
        }));

        sendSnapshot(initialState);
        lastScreen = initialState.screen;
        lastDead = initialState.dead;
        if (!initialState?.connected || initialState.dead) {
            sendSnapshot(initialState, 'disconnected');
            dispose();
            webSocket.close();
            return;
        }

        subscription = daemon.client.onDidEvent((event: DaemonNotification) => {
            if (event.type !== 'mission.terminal' || event.missionId !== missionId) {
                return;
            }
            if (repositoryRootPath && event.workspaceRoot !== repositoryRootPath) {
                return;
            }

            sendMissionState(MissionTerminalSnapshotSchema.parse({
                missionId,
                connected: event.state.connected,
                dead: event.state.dead,
                exitCode: event.state.dead ? event.state.exitCode : null,
                screen: event.state.screen,
                ...(event.state.chunk ? { chunk: event.state.chunk } : {}),
                ...(event.state.truncated ? { truncated: true } : {}),
                ...(event.state.terminalHandle ? { terminalHandle: event.state.terminalHandle } : {})
            }));
            if (!event.state.connected || event.state.dead) {
                dispose();
                webSocket.close();
            }
        });

        terminalReady = true;
        for (const rawMessage of pendingMessages.splice(0)) {
            await processRawMessage(rawMessage);
        }

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

function clipMissionSessionTerminalScreen(
    state: Pick<MissionAgentTerminalState, 'connected' | 'dead' | 'screen'> | null,
): { screen: string; truncated: boolean } {
    if (state && !state.connected && state.dead) {
        return { screen: state.screen, truncated: false };
    }

    return clipTerminalScreen(state?.screen ?? '');
}