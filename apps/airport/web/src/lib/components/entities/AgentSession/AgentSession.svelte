<script lang="ts">
    import type { AgentSession } from "$lib/client/entities/AgentSession";
    import AgentSessionActionbar from "$lib/components/entities/AgentSession/AgentSessionActionbar.svelte";
    import type { MissionStageId } from "@flying-pillow/mission-core/types.js";
    import {
        missionSessionTerminalSnapshotDtoSchema,
        missionSessionTerminalSocketServerMessageSchema,
        type MissionSessionTerminalSnapshotDto,
        type MissionSessionTerminalSocketServerMessageDto,
    } from "@flying-pillow/mission-core/airport/runtime";
    import "xterm/css/xterm.css";

    let {
        missionId,
        repositoryId,
        refreshNonce,
        stageId,
        session,
        onActionExecuted,
    }: {
        missionId: string;
        repositoryId: string;
        refreshNonce: number;
        stageId?: MissionStageId;
        session?: AgentSession;
        onActionExecuted: () => Promise<void>;
    } = $props();

    let container = $state<HTMLDivElement | null>(null);
    let terminalSnapshot = $state<MissionSessionTerminalSnapshotDto | null>(
        null,
    );
    let loading = $state(false);
    let error = $state<string | null>(null);
    let sendingInput = $state(false);
    let activeTransportSessionId = $state<string | null>(null);
    let transportRunToken = 0;

    let terminal: import("xterm").Terminal | null = null;
    let fitAddon: import("xterm-addon-fit").FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let terminalSocket: WebSocket | null = null;
    let pendingInput = "";
    let lastRenderedScreen = "";
    let pendingResize: { cols: number; rows: number } | null = null;

    const MAX_TERMINAL_SNAPSHOT_LENGTH = 40_000;
    const TERMINAL_SOCKET_INIT_TIMEOUT_MS = 5000;

    const canAttachTerminal = $derived(Boolean(session?.isTerminalBacked()));
    const terminalSessionId = $derived(session?.sessionId ?? null);
    const terminalStateLabel = $derived.by(() => {
        if (!session) {
            return "No session";
        }
        if (!canAttachTerminal) {
            return "Not terminal-backed";
        }
        if (loading && !terminalSnapshot) {
            return "Connecting";
        }
        if (terminalSnapshot?.dead) {
            return terminalSnapshot.exitCode === null
                ? "Exited"
                : `Exited (${terminalSnapshot.exitCode})`;
        }
        if (terminalSnapshot?.connected) {
            return "Attached";
        }
        if (session.lifecycleState === "failed") {
            return "Failed";
        }
        return "Connecting";
    });

    $effect(() => {
        if (!container || terminal) {
            return;
        }

        let disposed = false;
        void initializeTerminal(container, () => disposed);

        return () => {
            disposed = true;
            resizeObserver?.disconnect();
            terminal?.dispose();
            fitAddon = null;
            terminal = null;
            lastRenderedScreen = "";
        };
    });

    $effect(() => {
        if (!terminalSessionId || !canAttachTerminal) {
            transportRunToken += 1;
            activeTransportSessionId = null;
            terminalSnapshot = null;
            error = null;
            loading = false;
            closeTerminalSocket();
            return;
        }

        if (activeTransportSessionId === terminalSessionId) {
            return;
        }

        transportRunToken += 1;
        const runToken = transportRunToken;
        activeTransportSessionId = terminalSessionId;
        loading = true;
        error = null;
        closeTerminalSocket();

        void bootstrapTerminalTransport(
            terminalSessionId,
            () => runToken !== transportRunToken,
        );
    });

    $effect(() => {
        const screen = terminalSnapshot?.screen ?? "";
        if (
            !terminal ||
            typeof screen !== "string" ||
            screen === lastRenderedScreen
        ) {
            return;
        }

        lastRenderedScreen = screen;
        terminal.reset();
        terminal.write(normalizeScreen(screen));
        fitAddon?.fit();
    });

    async function flushPendingInput(): Promise<void> {
        if (!session || !canAttachTerminal || pendingInput.length === 0) {
            return;
        }
        if (terminalSocket?.readyState !== WebSocket.OPEN) {
            return;
        }

        sendingInput = true;
        try {
            while (
                pendingInput.length > 0 &&
                terminalSocket?.readyState === WebSocket.OPEN
            ) {
                const data = pendingInput;
                pendingInput = "";
                await postTerminalUpdate({ data });
            }
        } catch (sendError) {
            error =
                sendError instanceof Error
                    ? sendError.message
                    : String(sendError);
        } finally {
            sendingInput = false;
        }
    }

    function applyTerminalSnapshot(
        snapshot: MissionSessionTerminalSnapshotDto,
    ): void {
        terminalSnapshot = snapshot;
        error = null;
        loading = false;
    }

    function closeTerminalSocket(): void {
        terminalSocket?.close();
        terminalSocket = null;
    }

    async function bootstrapTerminalTransport(
        sessionId: string,
        isCancelled: () => boolean,
    ): Promise<void> {
        const initialSnapshot = await loadTerminalSnapshot(sessionId);
        if (isCancelled()) {
            return;
        }

        if (initialSnapshot) {
            applyTerminalSnapshot(initialSnapshot);
            if (!initialSnapshot.connected || initialSnapshot.dead) {
                closeTerminalSocket();
                return;
            }
        }

        await openTerminalTransport(sessionId, isCancelled);
    }

    async function loadTerminalSnapshot(
        sessionId: string,
    ): Promise<MissionSessionTerminalSnapshotDto | null> {
        try {
            const response = await fetch(
                `/api/runtime/sessions/${encodeURIComponent(sessionId)}/terminal?missionId=${encodeURIComponent(missionId)}`,
            );
            if (!response.ok) {
                throw new Error(
                    `Terminal snapshot request failed (${response.status}).`,
                );
            }

            return missionSessionTerminalSnapshotDtoSchema.parse(
                await response.json(),
            );
        } catch (snapshotError) {
            error =
                snapshotError instanceof Error
                    ? snapshotError.message
                    : String(snapshotError);
            loading = false;
            return null;
        }
    }

    async function openTerminalTransport(
        sessionId: string,
        isCancelled: () => boolean,
    ): Promise<void> {
        const wsProtocol =
            window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = new URL(
            `/api/runtime/sessions/${encodeURIComponent(sessionId)}/terminal/ws?missionId=${encodeURIComponent(missionId)}`,
            `${wsProtocol}//${window.location.host}`,
        );
        const socket = new WebSocket(wsUrl);
        terminalSocket = socket;

        let receivedSnapshot = false;
        const connectionTimer = window.setTimeout(() => {
            if (!receivedSnapshot) {
                if (terminalSocket === socket) {
                    terminalSocket = null;
                }
                error = "Terminal socket did not initialize.";
                loading = false;
                socket.close();
            }
        }, TERMINAL_SOCKET_INIT_TIMEOUT_MS);

        socket.addEventListener("open", () => {
            if (isCancelled() || terminalSocket !== socket) {
                return;
            }
            if (pendingResize) {
                void flushPendingResize();
            }
            if (pendingInput.length > 0 && !sendingInput) {
                void flushPendingInput();
            }
        });

        socket.addEventListener("message", (event) => {
            if (isCancelled() || terminalSocket !== socket) {
                return;
            }
            const message =
                missionSessionTerminalSocketServerMessageSchema.parse(
                    JSON.parse(event.data),
                );
            handleTerminalSocketMessage(message);
            if (
                message.type === "snapshot" ||
                message.type === "disconnected"
            ) {
                receivedSnapshot = true;
                window.clearTimeout(connectionTimer);
            }
        });

        socket.addEventListener("error", () => {
            if (terminalSocket !== socket) {
                return;
            }
            window.clearTimeout(connectionTimer);
            error = receivedSnapshot
                ? "Terminal socket failed."
                : "Terminal socket could not connect.";
            loading = false;
        });

        socket.addEventListener("close", () => {
            window.clearTimeout(connectionTimer);
            if (isCancelled() || terminalSocket !== socket) {
                return;
            }
            terminalSocket = null;
            if (!receivedSnapshot) {
                error = "Terminal socket disconnected before initialization.";
            } else if (!terminalSnapshot?.dead) {
                error = "Terminal socket disconnected.";
            }
            loading = false;
        });
    }

    function handleTerminalSocketMessage(
        message: MissionSessionTerminalSocketServerMessageDto,
    ): void {
        if (message.type === "snapshot" || message.type === "disconnected") {
            applyTerminalSnapshot(message.snapshot);
            return;
        }
        if (message.type === "error") {
            error = message.message;
            loading = false;
            return;
        }
        if (!terminal || message.output.chunk.length === 0) {
            terminalSnapshot = terminalSnapshot
                ? {
                      ...terminalSnapshot,
                      dead: message.output.dead,
                      exitCode: message.output.exitCode,
                      ...(message.output.chunk.length > 0
                          ? {
                                screen: appendTerminalScreen(
                                    terminalSnapshot.screen,
                                    message.output.chunk,
                                    message.output.truncated === true,
                                ),
                            }
                          : {}),
                      ...(message.output.truncated ? { truncated: true } : {}),
                  }
                : terminalSnapshot;
            loading = false;
            return;
        }
        terminal.write(message.output.chunk);
        const nextScreen = appendTerminalScreen(
            terminalSnapshot?.screen ?? "",
            message.output.chunk,
            message.output.truncated === true,
        );
        lastRenderedScreen = nextScreen;
        terminalSnapshot = terminalSnapshot
            ? {
                  ...terminalSnapshot,
                  dead: message.output.dead,
                  exitCode: message.output.exitCode,
                  screen: nextScreen,
                  ...(message.output.truncated ? { truncated: true } : {}),
              }
            : terminalSnapshot;
        loading = false;
        error = null;
    }

    async function initializeTerminal(
        target: HTMLDivElement,
        isDisposed: () => boolean,
    ): Promise<void> {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
            import("xterm"),
            import("xterm-addon-fit"),
        ]);

        if (isDisposed()) {
            return;
        }

        terminal = new Terminal({
            convertEol: true,
            cursorBlink: true,
            fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
            fontSize: 13,
            scrollback: 1500,
            theme: {
                background: "#0f172a",
                foreground: "#e2e8f0",
                cursor: "#f8fafc",
                selectionBackground: "#334155",
                black: "#020617",
                red: "#f87171",
                green: "#4ade80",
                yellow: "#facc15",
                blue: "#60a5fa",
                magenta: "#f472b6",
                cyan: "#22d3ee",
                white: "#e2e8f0",
                brightBlack: "#475569",
                brightRed: "#fb7185",
                brightGreen: "#86efac",
                brightYellow: "#fde047",
                brightBlue: "#93c5fd",
                brightMagenta: "#f9a8d4",
                brightCyan: "#67e8f9",
                brightWhite: "#f8fafc",
            },
        });
        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(target);
        fitAddon.fit();
        terminal.onResize(({ cols, rows }) => {
            if (!session || !canAttachTerminal || terminalSnapshot?.dead) {
                return;
            }
            if (
                document.visibilityState !== "visible" ||
                !document.hasFocus()
            ) {
                return;
            }
            pendingResize = { cols, rows };
            void flushPendingResize();
        });
        terminal.onData((data) => {
            if (!session || !canAttachTerminal || terminalSnapshot?.dead) {
                return;
            }
            pendingInput += data;
            if (!sendingInput) {
                void flushPendingInput();
            }
        });

        resizeObserver = new ResizeObserver(() => {
            fitAddon?.fit();
        });
        resizeObserver.observe(target);
    }

    async function flushPendingResize(): Promise<void> {
        if (!session || !canAttachTerminal || !pendingResize) {
            return;
        }
        if (terminalSocket?.readyState !== WebSocket.OPEN) {
            return;
        }
        const resize = pendingResize;
        pendingResize = null;
        try {
            await postTerminalUpdate(resize);
        } catch (sendError) {
            error =
                sendError instanceof Error
                    ? sendError.message
                    : String(sendError);
        }
    }

    async function postTerminalUpdate(input: {
        data?: string;
        cols?: number;
        rows?: number;
    }): Promise<void> {
        if (!session) {
            return;
        }

        if (terminalSocket?.readyState === WebSocket.OPEN) {
            if (input.data !== undefined) {
                terminalSocket.send(
                    JSON.stringify({
                        type: "input",
                        data: input.data,
                    }),
                );
                return;
            }
            if (input.cols !== undefined && input.rows !== undefined) {
                terminalSocket.send(
                    JSON.stringify({
                        type: "resize",
                        cols: input.cols,
                        rows: input.rows,
                    }),
                );
                return;
            }
        }

        return;
    }

    function normalizeScreen(screen: string): string {
        return screen.replace(/\r?\n/g, "\r\n");
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
</script>

<section class="flex h-full min-h-0 flex-col overflow-hidden">
    <header class="px-3 py-2">
        <div class="flex flex-wrap items-start gap-2">
            <div class="min-w-0 flex-1">
                <h2 class="truncate text-sm font-semibold text-foreground">
                    {session?.sessionId ?? "Agent session"}
                </h2>
                <p class="truncate text-xs text-muted-foreground">
                    {session?.currentTurnTitle ??
                        session?.workingDirectory ??
                        "Select a task or session row to pin the runtime console."}
                </p>
            </div>

            <AgentSessionActionbar
                {missionId}
                {repositoryId}
                {refreshNonce}
                {stageId}
                taskId={session?.taskId}
                sessionId={session?.sessionId}
                {onActionExecuted}
            />

            <div class="text-right text-xs text-muted-foreground">
                <p>{terminalStateLabel}</p>
                {#if session}
                    <p class="mt-1">{session.lifecycleState}</p>
                {/if}
            </div>
        </div>
        {#if error}
            <p class="text-sm text-rose-600">{error}</p>
        {/if}
    </header>

    <div class="flex-1 min-h-0">
        {#if !session}
            <div
                class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-muted-foreground"
            >
                No session resolves from the current mission-control selection.
            </div>
        {:else if !canAttachTerminal}
            <div
                class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-muted-foreground"
            >
                This session is not terminal-backed, so Mission Control cannot
                attach an interactive console.
            </div>
        {:else}
            <div class="h-full min-h-[24rem] overflow-hidden">
                <div
                    class="h-full min-h-0 overflow-hidden bg-slate-950 px-2 py-2"
                >
                    <div
                        bind:this={container}
                        class="h-full w-full min-h-0"
                    ></div>
                </div>
            </div>
        {/if}
    </div>
</section>
