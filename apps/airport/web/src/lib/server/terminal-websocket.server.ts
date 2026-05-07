import type { Notification as DaemonNotification } from '@flying-pillow/mission-core/daemon/protocol/contracts';
import {
    MissionTerminalOutputSchema,
    MissionTerminalSnapshotSchema,
    MissionTerminalSocketClientMessageSchema,
    MissionTerminalSocketServerMessageSchema,
    type MissionTerminalSnapshotType
} from '@flying-pillow/mission-core/entities/Mission/MissionSchema';
import {
    AgentExecutionTerminalOutputSchema,
    AgentExecutionTerminalSnapshotSchema,
    AgentExecutionTerminalSocketClientMessageSchema,
    AgentExecutionTerminalSocketServerMessageSchema,
    AgentExecutionTerminalRouteParamsSchema,
    AgentExecutionTerminalQuerySchema,
    type AgentExecutionTerminalSnapshotType
} from '@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
import { connectDedicatedAuthenticatedDaemonClient } from './daemon/connections.server';
import { resolveMissionTerminalRuntimeError } from './mission-terminal-errors';
import { resolveRepositoryRootPath } from './repository-root-path.server';

const TERMINAL_WS_PATH_PATTERN = /^\/api\/runtime\/sessions\/([^/]+)\/terminal\/ws$/u;
const MISSION_TERMINAL_WS_PATH_PATTERN = /^\/api\/runtime\/missions\/([^/]+)\/terminal\/ws$/u;
const AIRPORT_WEB_TERMINAL_SCREEN_LIMIT = 40_000;
const TERMINAL_SUBSCRIPTION_TIMEOUT_MS = 5_000;
const TERMINAL_INITIAL_SNAPSHOT_TIMEOUT_MS = 8_000;
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
            sessionId: AgentExecutionTerminalRouteParamsSchema.parse({ sessionId: decodeURIComponent(sessionMatch[1]) }).sessionId
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
    const query = AgentExecutionTerminalQuerySchema.extend({
        repositoryId: AgentExecutionTerminalQuerySchema.shape.missionId.optional(),
        repositoryRootPath: AgentExecutionTerminalQuerySchema.shape.missionId.optional()
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

    const sendSnapshot = (state: AgentExecutionTerminalSnapshotType, type: 'snapshot' | 'disconnected' = 'snapshot') => {
        const terminalScreen = clipTerminalScreen(state.screen);
        const snapshot = AgentExecutionTerminalSnapshotSchema.parse({
            missionId: query.missionId,
            sessionId,
            connected: state.connected,
            dead: state.dead,
            exitCode: state.dead ? state.exitCode : null,
            ...(state.cols ? { cols: state.cols } : {}),
            ...(state.rows ? { rows: state.rows } : {}),
            screen: terminalScreen.screen,
            ...(state.recording ? { recording: state.recording } : {}),
            ...(state.truncated || terminalScreen.truncated ? { truncated: true } : {}),
            ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
        });
        send(AgentExecutionTerminalSocketServerMessageSchema.parse({ type, snapshot }));
    };

    const sendOutput = (state: AgentExecutionTerminalSnapshotType) => {
        const output = AgentExecutionTerminalOutputSchema.parse({
            missionId: query.missionId,
            sessionId,
            chunk: state.chunk ?? '',
            dead: state.dead,
            exitCode: state.dead ? state.exitCode : null,
            ...(state.truncated ? { truncated: true } : {}),
            ...(state.terminalHandle ? { terminalHandle: state.terminalHandle } : {})
        });
        send(AgentExecutionTerminalSocketServerMessageSchema.parse({ type: 'output', output }));
    };

    const sendError = (message: string) => {
        send(AgentExecutionTerminalSocketServerMessageSchema.parse({
            type: 'error',
            message
        }));
    };

    const processRawMessage = async (rawMessage: Buffer) => {
        try {
            const message = AgentExecutionTerminalSocketClientMessageSchema.parse(JSON.parse(rawMessage.toString()));
            if (message.type === 'input') {
                daemon?.client.request('entity.command', {
                    entity: 'AgentExecution',
                    method: 'sendTerminalInput',
                    payload: {
                        missionId: query.missionId,
                        sessionId,
                        data: message.data,
                        ...(message.literal !== undefined ? { literal: message.literal } : {})
                    }
                }).catch(() => { });
                return;
            }
            const nextState = AgentExecutionTerminalSnapshotSchema.parse(await daemon?.client.request('entity.command', {
                entity: 'AgentExecution',
                method: 'sendTerminalInput',
                payload: {
                    missionId: query.missionId,
                    sessionId,
                    cols: message.cols,
                    rows: message.rows
                }
            }));
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
        const repositoryRootPath = await resolveRepositoryRootPath({
            repositoryId: query.repositoryId,
            repositoryRootPath: query.repositoryRootPath
        });
        daemon = await connectDedicatedAuthenticatedDaemonClient({
            ...(repositoryRootPath ? { surfacePath: repositoryRootPath } : {})
        });
        await daemon.client.request<null>('event.subscribe', {
            channels: [`agent_execution:${query.missionId}/${sessionId}.terminal`]
        }, {
            timeoutMs: TERMINAL_SUBSCRIPTION_TIMEOUT_MS
        });

        const initialState = AgentExecutionTerminalSnapshotSchema.parse(await daemon.client.request('entity.query', {
            entity: 'AgentExecution',
            method: 'readTerminal',
            payload: {
                missionId: query.missionId,
                sessionId
            }
        }, {
            timeoutMs: TERMINAL_INITIAL_SNAPSHOT_TIMEOUT_MS
        }));
        sendSnapshot(initialState);
        if (!initialState.connected || initialState.dead) {
            sendSnapshot(initialState, 'disconnected');
            dispose();
            webSocket.close();
            return;
        }

        subscription = daemon.client.onDidEvent((event: DaemonNotification) => {
            if (event.type !== 'execution.terminal' || event.missionId !== query.missionId || event.entityId !== `agent_execution:${query.missionId}/${sessionId}`) {
                return;
            }

            void (async () => {
                const snapshot = AgentExecutionTerminalSnapshotSchema.parse(event.payload);
                if (!snapshot.connected || snapshot.dead) {
                    const completedSnapshot = AgentExecutionTerminalSnapshotSchema.parse(await daemon?.client.request('entity.query', {
                        entity: 'AgentExecution',
                        method: 'readTerminal',
                        payload: {
                            missionId: query.missionId,
                            sessionId
                        }
                    }));
                    sendSnapshot(completedSnapshot, 'disconnected');
                    dispose();
                    webSocket.close();
                    return;
                }

                if (typeof snapshot.chunk === 'string' && snapshot.chunk.length > 0) {
                    sendOutput(snapshot);
                    return;
                }

                sendSnapshot(snapshot);
            })().catch((error) => {
                sendError(error instanceof Error ? error.message : String(error));
            });
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
        const nextDisconnected = state.dead || !state.connected;
        const hasChunk = typeof state.chunk === 'string' && state.chunk.length > 0;

        if (hasChunk && !nextDisconnected) {
            sendOutput(state);
        } else {
            sendSnapshot(state, nextDisconnected ? 'disconnected' : 'snapshot');
        }

        lastScreen = state.screen;
        lastDead = state.dead;
    };

    const processRawMessage = async (rawMessage: Buffer) => {
        try {
            const message = MissionTerminalSocketClientMessageSchema.parse(JSON.parse(rawMessage.toString()));
            if (message.type === 'input') {
                daemon?.client.request('entity.command', {
                    entity: 'Mission',
                    method: 'sendTerminalInput',
                    payload: {
                        missionId,
                        data: message.data,
                        ...(message.literal !== undefined ? { literal: message.literal } : {})
                    }
                }).catch(() => { });
                return;
            }
            const nextState = MissionTerminalSnapshotSchema.parse(await daemon?.client.request('entity.command', {
                entity: 'Mission',
                method: 'sendTerminalInput',
                payload: {
                    missionId,
                    cols: message.cols,
                    rows: message.rows
                }
            }));
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
        repositoryRootPath = await resolveRepositoryRootPath({
            repositoryId,
            repositoryRootPath: queryRepositoryRootPath
        });
        daemon = await connectDedicatedAuthenticatedDaemonClient({
            ...(repositoryRootPath ? { surfacePath: repositoryRootPath } : {})
        });
        await daemon.client.request<null>('event.subscribe', {
            channels: [`mission:${missionId}.terminal`]
        }, {
            timeoutMs: TERMINAL_SUBSCRIPTION_TIMEOUT_MS
        });
        const initialState = MissionTerminalSnapshotSchema.parse(await daemon.client.request('entity.command', {
            entity: 'Mission',
            method: 'ensureTerminal',
            payload: { missionId }
        }, {
            timeoutMs: TERMINAL_INITIAL_SNAPSHOT_TIMEOUT_MS
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
            const snapshot = MissionTerminalSnapshotSchema.parse(event.payload);
            sendMissionState(snapshot);
            if (!snapshot.connected || snapshot.dead) {
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
    state: Pick<AgentExecutionTerminalSnapshotType, 'connected' | 'dead' | 'screen'> | null,
): { screen: string; truncated: boolean } {
    if (state && !state.connected && state.dead) {
        return { screen: state.screen, truncated: false };
    }

    return clipTerminalScreen(state?.screen ?? '');
}
