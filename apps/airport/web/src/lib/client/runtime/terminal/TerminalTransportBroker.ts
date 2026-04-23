import type {
    MissionSessionTerminalSocketClientMessageDto,
    MissionSessionTerminalSocketServerMessageDto,
    MissionSessionTerminalSnapshotDto,
    MissionTerminalSocketClientMessageDto,
    MissionTerminalSocketServerMessageDto,
    MissionTerminalSnapshotDto,
} from '@flying-pillow/mission-core/airport/runtime';

type TerminalSnapshotBase = {
    connected: boolean;
    dead: boolean;
    exitCode: number | null;
    screen: string;
    chunk?: string;
    truncated?: boolean;
};

type TerminalOutputBase = {
    chunk: string;
    dead: boolean;
    exitCode: number | null;
    truncated?: boolean;
};

type TerminalServerMessage<TSnapshot extends TerminalSnapshotBase, TOutput extends TerminalOutputBase> =
    | {
        type: 'snapshot' | 'disconnected';
        snapshot: TSnapshot;
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
    | MissionTerminalSocketClientMessageDto
    | MissionSessionTerminalSocketClientMessageDto;

type SharedTerminalSnapshot =
    | MissionTerminalSnapshotDto
    | MissionSessionTerminalSnapshotDto;

type SharedTerminalServerMessage =
    | MissionTerminalSocketServerMessageDto
    | MissionSessionTerminalSocketServerMessageDto;

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
    loadSnapshot: () => Promise<TSnapshot | null>;
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
            const snapshot = await this.config.loadSnapshot();
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
        if (message.type === 'snapshot' || message.type === 'disconnected') {
            this.state = {
                snapshot: cloneSnapshot(message.snapshot),
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

        this.state = {
            snapshot: mergeOutputIntoSnapshot(this.state.snapshot, message.output),
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

function cloneSnapshot<TSnapshot extends SharedTerminalSnapshot>(
    snapshot: TSnapshot,
): TSnapshot {
    return {
        ...snapshot,
        ...(snapshot.terminalHandle
            ? { terminalHandle: { ...snapshot.terminalHandle } }
            : {}),
    };
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
    };
}

function appendTerminalScreen(
    currentScreen: string,
    chunk: string,
    truncated: boolean,
): string {
    const nextScreen = `${currentScreen}${chunk}`;
    if (truncated || nextScreen.length > MAX_TERMINAL_SNAPSHOT_LENGTH) {
        return nextScreen.slice(-MAX_TERMINAL_SNAPSHOT_LENGTH);
    }
    return nextScreen;
}