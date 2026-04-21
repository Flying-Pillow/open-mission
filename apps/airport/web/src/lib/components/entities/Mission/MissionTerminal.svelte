<script lang="ts">
    import { type MissionSessionTerminalHandleDto } from "@flying-pillow/mission-core";
    import "xterm/css/xterm.css";

    type MissionTerminalSnapshotDto = {
        missionId: string;
        connected: boolean;
        dead: boolean;
        exitCode: number | null;
        screen: string;
        truncated?: boolean;
        terminalHandle?: MissionSessionTerminalHandleDto;
    };

    type MissionTerminalOutputDto = {
        missionId: string;
        chunk: string;
        dead: boolean;
        exitCode: number | null;
        truncated?: boolean;
        terminalHandle?: MissionSessionTerminalHandleDto;
    };

    type MissionTerminalSocketServerMessageDto =
        | {
              type: "snapshot" | "disconnected";
              snapshot: MissionTerminalSnapshotDto;
          }
        | {
              type: "output";
              output: MissionTerminalOutputDto;
          }
        | {
              type: "error";
              message: string;
          };

    type MissionTerminalRouteErrorDto = {
        message?: string;
    };

    let {
        missionId,
        repositoryId,
        repositoryRootPath,
    }: {
        missionId: string;
        repositoryId: string;
        repositoryRootPath: string;
    } = $props();

    let container = $state<HTMLDivElement | null>(null);
    let terminalSnapshot = $state<MissionTerminalSnapshotDto | null>(null);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let sendingInput = $state(false);
    let activeMissionId = $state<string | null>(null);
    let transportRunToken = 0;

    let terminal: import("xterm").Terminal | null = null;
    let fitAddon: import("xterm-addon-fit").FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let terminalSocket: WebSocket | null = null;
    let pendingInput = "";
    let pendingTerminalResponseFragment = "";
    let lastRenderedScreen = "";
    let pendingResize: { cols: number; rows: number } | null = null;

    const MAX_TERMINAL_SNAPSHOT_LENGTH = 40_000;
    const TERMINAL_SOCKET_INIT_TIMEOUT_MS = 5000;

    const terminalStateLabel = $derived.by(() => {
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
        return () => {
            transportRunToken += 1;
            closeTerminalSocket();
        };
    });

    $effect(() => {
        const normalizedMissionId = missionId?.trim();
        if (!normalizedMissionId) {
            transportRunToken += 1;
            activeMissionId = null;
            terminalSnapshot = null;
            error = null;
            loading = false;
            closeTerminalSocket();
            return;
        }

        if (activeMissionId === normalizedMissionId) {
            return;
        }

        transportRunToken += 1;
        const runToken = transportRunToken;
        activeMissionId = normalizedMissionId;
        loading = true;
        error = null;
        closeTerminalSocket();

        void bootstrapTerminalTransport(
            normalizedMissionId,
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
        if (pendingInput.length === 0) {
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

    function applyTerminalSnapshot(snapshot: MissionTerminalSnapshotDto): void {
        terminalSnapshot = snapshot;
        error = null;
        loading = false;
    }

    function closeTerminalSocket(): void {
        terminalSocket?.close();
        terminalSocket = null;
        pendingTerminalResponseFragment = "";
    }

    async function bootstrapTerminalTransport(
        nextMissionId: string,
        isCancelled: () => boolean,
    ): Promise<void> {
        const initialSnapshot = await loadTerminalSnapshot(nextMissionId);
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

        await openTerminalTransport(nextMissionId, isCancelled);
    }

    async function loadTerminalSnapshot(
        nextMissionId: string,
    ): Promise<MissionTerminalSnapshotDto | null> {
        try {
            const response = await fetch(
                `/api/runtime/missions/${encodeURIComponent(nextMissionId)}/terminal?repositoryId=${encodeURIComponent(repositoryId)}&repositoryRootPath=${encodeURIComponent(repositoryRootPath)}`,
            );
            if (!response.ok) {
                const errorBody = (await response
                    .json()
                    .catch(() => null)) as MissionTerminalRouteErrorDto | null;
                throw new Error(
                    errorBody?.message?.trim() ||
                        `Terminal snapshot request failed (${response.status}).`,
                );
            }

            return (await response.json()) as MissionTerminalSnapshotDto;
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
        nextMissionId: string,
        isCancelled: () => boolean,
    ): Promise<void> {
        const wsProtocol =
            window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = new URL(
            `/api/runtime/missions/${encodeURIComponent(nextMissionId)}/terminal/ws?repositoryId=${encodeURIComponent(repositoryId)}&repositoryRootPath=${encodeURIComponent(repositoryRootPath)}`,
            `${wsProtocol}//${window.location.host}`,
        );
        const socket = new WebSocket(wsUrl);
        terminalSocket = socket;

        let receivedSnapshot = false;
        let receivedInitializationSignal = false;
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
            const message = JSON.parse(
                event.data,
            ) as MissionTerminalSocketServerMessageDto;
            handleTerminalSocketMessage(message);
            if (
                message.type === "snapshot" ||
                message.type === "disconnected"
            ) {
                receivedSnapshot = true;
                receivedInitializationSignal = true;
                window.clearTimeout(connectionTimer);
                return;
            }
            if (message.type === "error") {
                receivedInitializationSignal = true;
                window.clearTimeout(connectionTimer);
            }
        });

        socket.addEventListener("error", () => {
            if (terminalSocket !== socket) {
                return;
            }
            window.clearTimeout(connectionTimer);
            if (!error) {
                error =
                    receivedInitializationSignal || receivedSnapshot
                        ? "Terminal socket failed."
                        : "Terminal socket could not connect.";
            }
            loading = false;
        });

        socket.addEventListener("close", () => {
            window.clearTimeout(connectionTimer);
            if (isCancelled() || terminalSocket !== socket) {
                return;
            }
            terminalSocket = null;
            if (error) {
                loading = false;
                return;
            }
            if (!receivedInitializationSignal) {
                error = "Terminal socket disconnected before initialization.";
            } else if (!terminalSnapshot?.dead) {
                error = "Terminal socket disconnected.";
            }
            loading = false;
        });
    }

    function handleTerminalSocketMessage(
        message: MissionTerminalSocketServerMessageDto,
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
        if (message.type !== "output") {
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
                background: "#000000",
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
            if (terminalSnapshot?.dead) {
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
            if (terminalSnapshot?.dead) {
                return;
            }
            const sanitizedData = sanitizeTerminalInputData(data);
            if (sanitizedData.length === 0) {
                return;
            }
            pendingInput += sanitizedData;
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
        if (!pendingResize) {
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
            }
        }
    }

    function normalizeScreen(screen: string): string {
        return screen.replace(/\r?\n/g, "\r\n");
    }

    function sanitizeTerminalInputData(data: string): string {
        const combinedData = `${pendingTerminalResponseFragment}${data}`;
        pendingTerminalResponseFragment = "";

        let sanitizedData = "";
        let cursor = 0;

        while (cursor < combinedData.length) {
            const sequenceStart = combinedData.indexOf("\u001b]", cursor);
            if (sequenceStart === -1) {
                sanitizedData += combinedData.slice(cursor);
                break;
            }

            sanitizedData += combinedData.slice(cursor, sequenceStart);
            if (
                !combinedData.startsWith("\u001b]10;", sequenceStart) &&
                !combinedData.startsWith("\u001b]11;", sequenceStart)
            ) {
                sanitizedData += combinedData[sequenceStart] ?? "";
                cursor = sequenceStart + 1;
                continue;
            }

            const bellTerminator = combinedData.indexOf(
                "\u0007",
                sequenceStart + 1,
            );
            const stringTerminator = combinedData.indexOf(
                "\u001b\\",
                sequenceStart + 1,
            );

            let sequenceEnd = -1;
            if (
                bellTerminator !== -1 &&
                (stringTerminator === -1 || bellTerminator < stringTerminator)
            ) {
                sequenceEnd = bellTerminator + 1;
            } else if (stringTerminator !== -1) {
                sequenceEnd = stringTerminator + 2;
            }

            if (sequenceEnd === -1) {
                pendingTerminalResponseFragment =
                    combinedData.slice(sequenceStart);
                break;
            }

            cursor = sequenceEnd;
        }

        return sanitizedData;
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
                    Mission terminal
                </h2>
                <p class="truncate text-xs text-muted-foreground">
                    Persistent shell rooted at this mission worktree.
                </p>
            </div>

            <div class="text-right text-xs text-muted-foreground">
                <p>{terminalStateLabel}</p>
                <p class="mt-1">{missionId}</p>
            </div>
        </div>
        {#if error}
            <p class="text-sm text-rose-600">{error}</p>
        {/if}
    </header>

    <div class="flex-1 min-h-0">
        <div class="h-full min-h-[24rem] overflow-hidden">
            <div class="h-full min-h-0 overflow-hidden bg-slate-950 px-2 py-2">
                <div bind:this={container} class="h-full w-full min-h-0"></div>
            </div>
        </div>
    </div>
</section>
