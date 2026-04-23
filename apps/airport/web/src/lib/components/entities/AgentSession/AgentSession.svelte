<script lang="ts">
    import type { AgentSession } from "$lib/client/entities/AgentSession";
    import AgentSessionActionbar from "$lib/components/entities/AgentSession/AgentSessionActionbar.svelte";
    import type { MissionStageId } from "@flying-pillow/mission-core/types.js";
    import { FitAddon } from "@xterm/addon-fit";
    import * as XtermModule from "@xterm/xterm";
    import {
        missionSessionTerminalSnapshotDtoSchema,
        missionSessionTerminalSocketServerMessageSchema,
        type MissionSessionTerminalSnapshotDto,
        type MissionSessionTerminalSocketServerMessageDto,
    } from "@flying-pillow/mission-core/airport/runtime";
    import {
        subscribeSharedTerminalTransport,
        type SharedTerminalTransportSubscription,
    } from "$lib/client/runtime/terminal/TerminalTransportBroker";
    import "@xterm/xterm/css/xterm.css";

    const Terminal = resolveConstructorExport<
        typeof import("@xterm/xterm").Terminal
    >(
        XtermModule as unknown as Record<string, unknown>,
        "Terminal",
        "@xterm/xterm",
    );
    type XtermTerminal = InstanceType<typeof Terminal>;
    type XtermFitAddon = InstanceType<typeof FitAddon>;

    function resolveConstructorExport<T>(
        moduleRecord: Record<string, unknown>,
        exportName: string,
        moduleName: string,
    ): T {
        const direct = moduleRecord[exportName];
        const defaultRecord = moduleRecord.default as
            | Record<string, unknown>
            | undefined;
        const resolved = direct ?? defaultRecord?.[exportName];
        if (!resolved) {
            throw new Error(
                `${moduleName} does not expose '${exportName}' in this runtime build.`,
            );
        }
        return resolved as T;
    }

    let {
        missionId,
        repositoryId,
        repositoryRootPath,
        refreshNonce,
        stageId,
        session,
        active = true,
        onActionExecuted,
    }: {
        missionId: string;
        repositoryId: string;
        repositoryRootPath: string;
        refreshNonce: number;
        stageId?: MissionStageId;
        session?: AgentSession;
        active?: boolean;
        onActionExecuted: () => Promise<void>;
    } = $props();

    let container = $state<HTMLDivElement | null>(null);
    let terminalSnapshot = $state<MissionSessionTerminalSnapshotDto | null>(
        null,
    );
    let loading = $state(false);
    let error = $state<string | null>(null);
    let sendingInput = $state(false);
    let activeTransportKey: string | null = null;

    let terminal: XtermTerminal | null = null;
    let fitAddon: XtermFitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let terminalTransport: SharedTerminalTransportSubscription<MissionSessionTerminalSnapshotDto> | null =
        null;
    let pendingInput = "";
    let pendingTerminalResponseFragment = "";
    let lastRenderedScreen = "";
    let pendingResize: { cols: number; rows: number } | null = null;
    let renderWriteToken = 0;

    type TerminalResizeEvent = { cols: number; rows: number };

    const canAttachTerminal = $derived(
        Boolean(
            session?.isTerminalBacked() ||
                (session?.isRunning() && session?.hasPersistedTerminalLog()),
        ),
    );
    const canShowTerminal = $derived(
        Boolean(
            session?.isTerminalBacked() || session?.hasPersistedTerminalLog(),
        ),
    );
    const canSendTerminalInput = $derived(
        Boolean(active && session?.isRunning() && canAttachTerminal),
    );
    const terminalSessionId = $derived(session?.sessionId ?? null);
    const terminalStateLabel = $derived.by(() => {
        if (!session) {
            return "No session";
        }
        if (!canShowTerminal) {
            return "Not terminal-backed";
        }
        if (
            !session.isRunning() &&
            !canAttachTerminal &&
            session.hasPersistedTerminalLog()
        ) {
            return "Transcript";
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
        const transportKey =
            terminalSessionId && canShowTerminal
                ? `session:${terminalSessionId}:${missionId}:${repositoryRootPath}:${repositoryId}`
                : null;

        if (activeTransportKey === transportKey) {
            return;
        }

        terminalTransport?.dispose();
        terminalTransport = null;

        if (!terminalSessionId || !canShowTerminal) {
            activeTransportKey = null;
            terminalSnapshot = null;
            error = null;
            loading = false;
            return;
        }

        if (!transportKey) {
            return;
        }

        const resolvedTransportKey: string = transportKey;
        activeTransportKey = resolvedTransportKey;
        terminalTransport = subscribeSharedTerminalTransport(
            {
                key: resolvedTransportKey,
                loadSnapshot: async () => {
                    const response = await fetch(
                        `/api/runtime/sessions/${encodeURIComponent(terminalSessionId)}/terminal?missionId=${encodeURIComponent(missionId)}&repositoryId=${encodeURIComponent(repositoryId)}&repositoryRootPath=${encodeURIComponent(repositoryRootPath)}`,
                    );
                    if (!response.ok) {
                        throw new Error(
                            `Terminal snapshot request failed (${response.status}).`,
                        );
                    }

                    return missionSessionTerminalSnapshotDtoSchema.parse(
                        await response.json(),
                    );
                },
                createSocket: () => {
                    const wsProtocol =
                        window.location.protocol === "https:" ? "wss:" : "ws:";
                    const wsUrl = new URL(
                        `/api/runtime/sessions/${encodeURIComponent(terminalSessionId)}/terminal/ws?missionId=${encodeURIComponent(missionId)}&repositoryId=${encodeURIComponent(repositoryId)}&repositoryRootPath=${encodeURIComponent(repositoryRootPath)}`,
                        `${wsProtocol}//${window.location.host}`,
                    );
                    return new WebSocket(wsUrl);
                },
                parseMessage: (value: unknown) =>
                    missionSessionTerminalSocketServerMessageSchema.parse(
                        value,
                    ),
            },
            (state) => {
                terminalSnapshot = state.snapshot;
                loading = state.loading;
                error = state.error;
            },
        );

        return () => {
            if (activeTransportKey === transportKey) {
                activeTransportKey = null;
            }
            terminalTransport?.dispose();
            terminalTransport = null;
        };
    });

    $effect(() => {
        const screen = terminalSnapshot?.screen ?? "";
        const chunk = terminalSnapshot?.chunk;
        if (!terminal || !active || typeof screen !== "string") {
            return;
        }

        if ((!chunk || chunk.length === 0) && screen === lastRenderedScreen) {
            return;
        }

        const writeToken = ++renderWriteToken;

        if (typeof chunk === "string" && chunk.length > 0) {
            lastRenderedScreen = screen;
            terminal.write(chunk, () => {
                if (renderWriteToken !== writeToken) {
                    return;
                }
            });
            return;
        }

        const nextRender = normalizeScreen(screen);
        const previousRender = normalizeScreen(lastRenderedScreen);
        if (nextRender.startsWith(previousRender)) {
            const appendedOutput = nextRender.slice(previousRender.length);
            lastRenderedScreen = screen;
            terminal.write(appendedOutput, () => {
                if (renderWriteToken !== writeToken) {
                    return;
                }
            });
            return;
        }

        lastRenderedScreen = screen;
        terminal.reset();
        terminal.write(nextRender, () => {
            if (renderWriteToken !== writeToken) {
                return;
            }
        });
    });

    $effect(() => {
        if (!terminal || !active) {
            return;
        }

        fitAddon?.fit();
    });

    async function flushPendingInput(): Promise<void> {
        if (!session || !canSendTerminalInput || pendingInput.length === 0) {
            return;
        }
        if (!terminalTransport) {
            return;
        }

        sendingInput = true;
        try {
            while (pendingInput.length > 0 && terminalTransport) {
                const data = pendingInput;
                pendingInput = "";
                await terminalTransport.sendInput(data);
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

    function initializeTerminal(
        target: HTMLDivElement,
        isDisposed: () => boolean,
    ): void {
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
        terminal.onResize(({ cols, rows }: TerminalResizeEvent) => {
            if (
                !session ||
                !canSendTerminalInput ||
                !active ||
                terminalSnapshot?.dead
            ) {
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
        terminal.onData((data: string) => {
            if (
                !session ||
                !canSendTerminalInput ||
                !active ||
                terminalSnapshot?.dead
            ) {
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
        if (!session || !canSendTerminalInput || !pendingResize) {
            return;
        }
        if (!terminalTransport) {
            return;
        }
        const resize = pendingResize;
        pendingResize = null;
        try {
            await terminalTransport.sendResize(resize.cols, resize.rows);
        } catch (sendError) {
            error =
                sendError instanceof Error
                    ? sendError.message
                    : String(sendError);
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
                {repositoryRootPath}
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
        {:else if !canShowTerminal}
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
