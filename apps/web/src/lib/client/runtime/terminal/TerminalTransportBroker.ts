import {
    AgentExecutionTerminalSchema,
    AgentExecutionTerminalSocketServerMessageSchema,
    type AgentExecutionTerminalType,
    type AgentExecutionTerminalSocketClientMessageType,
    type AgentExecutionTerminalSocketServerMessageType
} from '@flying-pillow/open-mission-core/entities/AgentExecution/AgentExecutionSchema';
import {
    MissionTerminalSnapshotSchema,
    MissionTerminalSocketServerMessageSchema,
    type MissionTerminalSnapshotType,
    type MissionTerminalSocketClientMessageType,
    type MissionTerminalSocketServerMessageType
} from '@flying-pillow/open-mission-core/entities/Terminal/MissionTerminalSchema';

type TerminalSnapshotBase = {
    connected: boolean;
    dead: boolean;
    exitCode: number | null;
    screen: string;
    chunk?: string;
    truncated?: boolean;
    terminalHandle?: {
        terminalName: string;
        terminalPaneId: string;
        sharedTerminalName?: string;
    };
};

type TerminalOutputBase = {
    chunk: string;
    dead: boolean;
    exitCode: number | null;
    truncated?: boolean;
};

type TerminalServerMessage<TSnapshot extends TerminalSnapshotBase, TOutput extends TerminalOutputBase> =
    | {
        type: 'snapshot';
        snapshot: TSnapshot;
    }
    | {
        type: 'disconnected';
        snapshot: TSnapshot;
    }
    | {
        type: 'terminal' | 'disconnected';
        terminal: TSnapshot;
    }
    | {
        type: 'output';
        output: TOutput;
    }
    | {
        type: 'error';
        message: string;
    };

type TerminalClientMessage =
    | MissionTerminalSocketClientMessageType
    | AgentExecutionTerminalSocketClientMessageType;

type SharedTerminalSnapshot =
    | MissionTerminalSnapshotType
    | AgentExecutionTerminalType;

type SharedTerminalServerMessage =
    | MissionTerminalSocketServerMessageType
    | AgentExecutionTerminalSocketServerMessageType;

type TerminalBrokerState<TSnapshot extends TerminalSnapshotBase> = {
    snapshot: TSnapshot | null;
    loading: boolean;
    error: string | null;
};

type TerminalBrokerConfig<
    TSnapshot extends TerminalSnapshotBase,
    TOutput extends TerminalOutputBase,
    TMessage extends TerminalServerMessage<TSnapshot, TOutput>,
> = {
    key: string;
    loadData: () => Promise<TSnapshot | null>;
    createSocket: () => WebSocket;
    parseMessage: (value: unknown) => TMessage;
    connectionTimeoutMs?: number;
    retryOnDisconnected?: boolean;
};

type TerminalBrokerListener<TSnapshot extends TerminalSnapshotBase> = (
    state: TerminalBrokerState<TSnapshot>,
) => void;

export type SharedTerminalTransportSubscription<
    TSnapshot extends TerminalSnapshotBase,
> = {
    sendInput: (data: string, literal?: boolean) => Promise<void>;
    sendResize: (cols: number, rows: number) => Promise<void>;
    dispose: () => void;
    getState: () => TerminalBrokerState<TSnapshot>;
};

const DEFAULT_CONNECTION_TIMEOUT_MS = 5000;
const IDLE_SOCKET_CLOSE_MS = 2000;
const MAX_TERMINAL_SNAPSHOT_LENGTH = 40_000;
const RECONNECT_DELAY_MS = 1000;

const terminalChannels = new Map<string, TerminalTransportChannel<any, any, any>>();

export function subscribeSharedTerminalTransport<
    TSnapshot extends TerminalSnapshotBase,
    TOutput extends TerminalOutputBase,
    TMessage extends TerminalServerMessage<TSnapshot, TOutput>,
>(
    config: TerminalBrokerConfig<TSnapshot, TOutput, TMessage>,
    listener: TerminalBrokerListener<TSnapshot>,
): SharedTerminalTransportSubscription<TSnapshot> {
    const channel = getOrCreateTerminalChannel(config);
    return channel.subscribe(listener);
}

export function subscribeMissionTerminalTransport(
    input: {
        missionId: string;
        repositoryId: string;
        repositoryRootPath?: string;
    },
    listener: TerminalBrokerListener<MissionTerminalSnapshotType>,
): SharedTerminalTransportSubscription<MissionTerminalSnapshotType> {
    const missionId = input.missionId.trim();
    const repositoryId = input.repositoryId.trim();
    const repositoryRootPath = input.repositoryRootPath?.trim() || undefined;
    const transportKey = [missionId, repositoryId, repositoryRootPath ?? ''].join(':');
    const query = buildTerminalQuery({ repositoryId, repositoryRootPath });

    return subscribeSharedTerminalTransport({
        key: `mission-terminal:${transportKey}`,
        loadData: async () => {
            const response = await fetch(
                `/api/runtime/missions/${encodeURIComponent(missionId)}/terminal?${query}`,
            );
            if (!response.ok) {
                const errorBody = await response.json().catch(() => null) as {
                    message?: string;
                } | null;
                throw new Error(
                    errorBody?.message?.trim()
                    || `Terminal data request failed (${response.status}).`,
                );
            }

            return MissionTerminalSnapshotSchema.parse(await response.json());
        },
        createSocket: () => {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = new URL(
                `/api/runtime/missions/${encodeURIComponent(missionId)}/terminal/ws?${query}`,
                `${wsProtocol}//${window.location.host}`,
            );
            return new WebSocket(wsUrl);
        },
        parseMessage: (value) => MissionTerminalSocketServerMessageSchema.parse(value),
        retryOnDisconnected: true,
    }, listener);
}

export function subscribeAgentExecutionTerminalTransport(
    input: {
        ownerId: string;
        repositoryId: string;
        repositoryRootPath?: string;
        agentExecutionId: string;
    },
    listener: TerminalBrokerListener<AgentExecutionTerminalType>,
): SharedTerminalTransportSubscription<AgentExecutionTerminalType> {
    const ownerId = input.ownerId.trim();
    const repositoryId = input.repositoryId.trim();
    const repositoryRootPath = input.repositoryRootPath?.trim() || undefined;
    const agentExecutionId = input.agentExecutionId.trim();
    const transportKey = [ownerId, repositoryId, repositoryRootPath ?? '', agentExecutionId].join(':');
    const query = buildTerminalQuery({ ownerId, repositoryId, repositoryRootPath });

    return subscribeSharedTerminalTransport({
        key: `agent-execution-terminal:${transportKey}`,
        loadData: async () => {
            const response = await fetch(
                `/api/runtime/agent-executions/${encodeURIComponent(agentExecutionId)}/terminal?${query}`,
            );
            if (!response.ok) {
                throw new Error(`Terminal data request failed (${response.status}).`);
            }

            return AgentExecutionTerminalSchema.parse(await response.json());
        },
        createSocket: () => {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = new URL(
                `/api/runtime/agent-executions/${encodeURIComponent(agentExecutionId)}/terminal/ws?${query}`,
                `${wsProtocol}//${window.location.host}`,
            );
            return new WebSocket(wsUrl);
        },
        parseMessage: (value) => AgentExecutionTerminalSocketServerMessageSchema.parse(value),
        retryOnDisconnected: true,
    }, listener);
}

function buildTerminalQuery(input: {
    ownerId?: string;
    repositoryId: string;
    repositoryRootPath?: string;
}): string {
    const query = new URLSearchParams();
    if (input.ownerId?.trim()) {
        query.set('ownerId', input.ownerId.trim());
    }
    query.set('repositoryId', input.repositoryId.trim());
    if (input.repositoryRootPath?.trim()) {
        query.set('repositoryRootPath', input.repositoryRootPath.trim());
    }
    return query.toString();
}

class TerminalTransportChannel<
    TSnapshot extends TerminalSnapshotBase,
    TOutput extends TerminalOutputBase,
    TMessage extends TerminalServerMessage<TSnapshot, TOutput>,
> {
    private readonly listeners = new Set<TerminalBrokerListener<TSnapshot>>();
    private state: TerminalBrokerState<TSnapshot> = {
        snapshot: null,
        loading: false,
        error: null,
    };
    private socket: WebSocket | null = null;
    private bootstrapPromise: Promise<void> | null = null;
    private connectionTimer: number | null = null;
    private closeTimer: number | null = null;
    private reconnectTimer: number | null = null;
    private receivedSnapshot = false;
    private receivedInitializationSignal = false;
    private pendingMessages: TerminalClientMessage[] = [];

    public constructor(
        private readonly config: TerminalBrokerConfig<
            TSnapshot,
            TOutput,
            TMessage
        >,
    ) { }

    public subscribe(
        listener: TerminalBrokerListener<TSnapshot>,
    ): SharedTerminalTransportSubscription<TSnapshot> {
        this.clearCloseTimer();
        this.listeners.add(listener);
        listener(this.cloneState());
        void this.ensureActive();

        return {
            sendInput: async (data: string, literal?: boolean) => {
                await this.send({
                    type: 'input',
                    data,
                    ...(literal !== undefined ? { literal } : {}),
                });
            },
            sendResize: async (cols: number, rows: number) => {
                await this.send({
                    type: 'resize',
                    cols,
                    rows,
                });
            },
            dispose: () => {
                this.listeners.delete(listener);
                if (this.listeners.size === 0) {
                    this.scheduleSocketClose();
                }
            },
            getState: () => this.cloneState(),
        };
    }

    private async ensureActive(): Promise<void> {
        if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
            return;
        }

        if (this.state.snapshot?.connected && !this.state.snapshot.dead) {
            if (!this.socket) {
                this.openSocket();
            }
            return;
        }

        if (!this.bootstrapPromise) {
            this.bootstrapPromise = this.bootstrap();
        }
        await this.bootstrapPromise;
        if (
            !this.socket &&
            this.state.snapshot?.connected &&
            !this.state.snapshot.dead
        ) {
            this.openSocket();
        }
    }

    private async bootstrap(): Promise<void> {
        this.clearReconnectTimer();
        this.state = {
            ...this.state,
            loading: true,
            error: null,
        };
        this.notify();

        try {
            const snapshot = await this.config.loadData();
            this.state = {
                snapshot: snapshot ? cloneSnapshot(snapshot) : null,
                loading: false,
                error: null,
            };
            this.notify();

            if (snapshot?.connected && !snapshot.dead) {
                this.openSocket();
            } else if (this.config.retryOnDisconnected) {
                this.scheduleReconnect();
            }
        } catch (error) {
            this.state = {
                ...this.state,
                loading: false,
                error: error instanceof Error ? error.message : String(error),
            };
            this.notify();
            if (this.config.retryOnDisconnected) {
                this.scheduleReconnect();
            }
        } finally {
            this.bootstrapPromise = null;
        }
    }

    private openSocket(): void {
        if (this.socket) {
            return;
        }

        const socket = this.config.createSocket();
        this.socket = socket;
        this.receivedSnapshot = false;
        this.receivedInitializationSignal = false;
        this.connectionTimer = window.setTimeout(() => {
            if (!this.receivedSnapshot && this.socket === socket) {
                this.socket = null;
                this.state = {
                    ...this.state,
                    loading: false,
                    error: 'Terminal socket did not initialize.',
                };
                this.notify();
                socket.close();
            }
        }, this.config.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS);

        socket.addEventListener('message', (event) => {
            if (this.socket !== socket) {
                return;
            }

            const message = this.config.parseMessage(JSON.parse(event.data));
            this.handleMessage(message);
            if (
                message.type === 'snapshot' ||
                message.type === 'terminal' ||
                message.type === 'disconnected'
            ) {
                this.receivedSnapshot = true;
                this.receivedInitializationSignal = true;
                this.clearConnectionTimer();
                this.flushPendingMessages();
                return;
            }
            if (message.type === 'error') {
                this.receivedInitializationSignal = true;
                this.clearConnectionTimer();
            }
        });

        socket.addEventListener('error', () => {
            if (this.socket !== socket) {
                return;
            }
            this.clearConnectionTimer();
            this.state = {
                ...this.state,
                loading: false,
                error:
                    this.receivedInitializationSignal || this.receivedSnapshot
                        ? 'Terminal socket failed.'
                        : 'Terminal socket could not connect.',
            };
            this.notify();
            if (this.config.retryOnDisconnected) {
                this.scheduleReconnect();
            }
        });

        socket.addEventListener('close', () => {
            this.clearConnectionTimer();
            if (this.socket !== socket) {
                return;
            }
            this.socket = null;
            if (!this.state.error) {
                this.state = {
                    ...this.state,
                    loading: false,
                    error: !this.receivedInitializationSignal
                        ? 'Terminal socket disconnected before initialization.'
                        : !this.state.snapshot?.dead
                            ? 'Terminal socket disconnected.'
                            : null,
                };
                this.notify();
            }
            if (this.config.retryOnDisconnected) {
                this.scheduleReconnect();
            }
        });
    }

    private handleMessage(message: TMessage): void {
        if (message.type === 'snapshot') {
            this.state = {
                snapshot: cloneSnapshot(message.snapshot),
                loading: false,
                error: null,
            };
            this.notify();
            return;
        }

        if (message.type === 'terminal' || message.type === 'disconnected') {
            const nextSnapshot = 'terminal' in message ? message.terminal : message.snapshot;
            this.state = {
                snapshot: cloneSnapshot(nextSnapshot),
                loading: false,
                error: null,
            };
            this.notify();
            return;
        }

        if (message.type === 'error') {
            this.state = {
                ...this.state,
                loading: false,
                error: message.message,
            };
            this.notify();
            return;
        }

        const outputMessage = message as Extract<TMessage, { type: 'output' }>;
        this.state = {
            snapshot: mergeOutputIntoSnapshot(this.state.snapshot, outputMessage.output),
            loading: false,
            error: null,
        };
        this.notify();
    }

    private async send(message: TerminalClientMessage): Promise<void> {
        await this.ensureActive();

        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
            return;
        }

        if (
            this.socket?.readyState === WebSocket.CONNECTING ||
            (this.socket === null && this.state.snapshot?.connected && !this.state.snapshot.dead)
        ) {
            this.pendingMessages.push(message);
            if (this.socket === null) {
                this.openSocket();
            }
            return;
        }

        throw new Error('Terminal socket is not connected.');
    }

    private flushPendingMessages(): void {
        if (
            this.socket?.readyState !== WebSocket.OPEN ||
            !this.receivedInitializationSignal ||
            !this.state.snapshot?.connected ||
            this.state.snapshot.dead ||
            this.pendingMessages.length === 0
        ) {
            return;
        }

        const queuedMessages = this.pendingMessages;
        this.pendingMessages = [];
        for (const message of queuedMessages) {
            this.socket.send(JSON.stringify(message));
        }
    }

    private notify(): void {
        const state = this.cloneState();
        for (const listener of this.listeners) {
            listener(state);
        }
    }

    private cloneState(): TerminalBrokerState<TSnapshot> {
        return {
            snapshot: this.state.snapshot
                ? cloneSnapshot(this.state.snapshot)
                : null,
            loading: this.state.loading,
            error: this.state.error,
        };
    }

    private scheduleSocketClose(): void {
        this.clearCloseTimer();
        this.closeTimer = window.setTimeout(() => {
            this.closeTimer = null;
            if (this.listeners.size === 0) {
                this.clearReconnectTimer();
                this.socket?.close();
                this.socket = null;
                terminalChannels.delete(this.config.key);
            }
        }, IDLE_SOCKET_CLOSE_MS);
    }

    private scheduleReconnect(): void {
        if (this.listeners.size === 0 || this.reconnectTimer !== null) {
            return;
        }

        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.socket?.close();
            this.socket = null;
            void this.ensureActive();
        }, RECONNECT_DELAY_MS);
    }

    private clearConnectionTimer(): void {
        if (this.connectionTimer !== null) {
            window.clearTimeout(this.connectionTimer);
            this.connectionTimer = null;
        }
    }

    private clearCloseTimer(): void {
        if (this.closeTimer !== null) {
            window.clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}

function getOrCreateTerminalChannel<
    TSnapshot extends TerminalSnapshotBase,
    TOutput extends TerminalOutputBase,
    TMessage extends TerminalServerMessage<TSnapshot, TOutput>,
>(
    config: TerminalBrokerConfig<TSnapshot, TOutput, TMessage>,
): TerminalTransportChannel<TSnapshot, TOutput, TMessage> {
    const existing = terminalChannels.get(config.key);
    if (existing) {
        return existing;
    }

    const created = new TerminalTransportChannel(config);
    terminalChannels.set(config.key, created);
    return created;
}

function cloneSnapshot<TSnapshot extends TerminalSnapshotBase>(
    snapshot: TSnapshot,
): TSnapshot {
    return {
        ...snapshot,
        ...(snapshot.terminalHandle
            ? { terminalHandle: { ...snapshot.terminalHandle } }
            : {}),
    } as TSnapshot;
}

function mergeOutputIntoSnapshot<
    TSnapshot extends TerminalSnapshotBase,
    TOutput extends TerminalOutputBase,
>(current: TSnapshot | null, output: TOutput): TSnapshot | null {
    if (!current) {
        return current;
    }

    const nextScreen = appendTerminalScreen(
        current.screen,
        output.chunk,
        output.truncated === true,
    );
    return {
        ...current,
        dead: output.dead,
        exitCode: output.exitCode,
        screen: nextScreen,
        chunk: output.chunk,
        ...(output.truncated ? { truncated: true } : {}),
    } as TSnapshot;
}

function appendTerminalScreen(
    currentScreen: string,
    chunk: string,
    truncated: boolean,
): string {
    if (!chunk) {
        return currentScreen;
    }

    if (truncated || chunk.length >= MAX_TERMINAL_SNAPSHOT_LENGTH) {
        return chunk.slice(-MAX_TERMINAL_SNAPSHOT_LENGTH);
    }

    const overflow = currentScreen.length + chunk.length - MAX_TERMINAL_SNAPSHOT_LENGTH;
    const preservedScreen = overflow > 0 ? currentScreen.slice(overflow) : currentScreen;
    return `${preservedScreen}${chunk}`;
}