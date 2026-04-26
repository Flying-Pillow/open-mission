<script lang="ts">
    import type { AgentSession } from "$lib/components/entities/AgentSession/AgentSession.svelte.js";
    import Anser from "anser/lib/index.js";
    import { getScopedMissionContext } from "$lib/client/context/scoped-mission-context.svelte.js";
    import AgentSessionActionbar from "$lib/components/entities/AgentSession/AgentSessionActionbar.svelte";
    import type { MissionStageIdData as MissionStageId } from "../types";
    import { FitAddon } from "@xterm/addon-fit";
    import * as XtermModule from "@xterm/xterm";
    import sanitizeHtml from "sanitize-html";
    import type { MissionSessionTerminalSnapshotData as MissionSessionTerminalSnapshot } from "../types";
    import {
        subscribeMissionSessionTerminalTransport,
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
        refreshNonce,
        stageId,
        session,
        onActionExecuted,
    }: {
        refreshNonce: number;
        stageId?: MissionStageId;
        session?: AgentSession;
        onActionExecuted: () => Promise<void>;
    } = $props();
    const missionScope = getScopedMissionContext();

    let container = $state<HTMLDivElement | null>(null);
    let terminalSnapshot = $state<MissionSessionTerminalSnapshot | null>(null);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let sendingInput = $state(false);
    let activeTransportKey = $state<string | null>(null);

    let terminal: XtermTerminal | null = null;
    let fitAddon: XtermFitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let terminalTransport =
        $state<SharedTerminalTransportSubscription<MissionSessionTerminalSnapshot> | null>(null);
    let pendingInput = "";
    let pendingTerminalResponseFragment = "";
    let lastRenderedScreen = "";
    let pendingResize: { cols: number; rows: number } | null = null;

    const MAX_TERMINAL_SNAPSHOT_LENGTH = 40_000;
    type TerminalResizeEvent = { cols: number; rows: number };

    const canAttachTerminal = $derived(Boolean(session?.isTerminalBacked()));
    const terminalSessionId = $derived(session?.sessionId ?? null);
    const mission = $derived(missionScope.mission);
    const activeRepository = $derived(missionScope.repository);
    const missionId = $derived(mission?.missionId ?? "");
    const repositoryId = $derived(activeRepository?.repositoryId ?? "");
    const repositoryRootPath = $derived(
        mission?.missionWorktreePath ?? activeRepository?.repositoryRootPath ?? "",
    );
    const isPersistedTranscriptSnapshot = $derived(
        Boolean(terminalSnapshot?.dead && !terminalSnapshot?.connected),
    );
    const persistedTranscriptHtml = $derived.by(() =>
        renderPersistedTranscriptHtml(terminalSnapshot?.screen ?? ""),
    );
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
        if (isPersistedTranscriptSnapshot) {
            resizeObserver?.disconnect();
            terminal?.dispose();
            resizeObserver = null;
            fitAddon = null;
            terminal = null;
            lastRenderedScreen = "";
            return;
        }

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
            terminalTransport?.dispose();
            terminalTransport = null;
        };
    });

    $effect(() => {
        if (
            !terminalSessionId ||
            !canAttachTerminal ||
            !missionId ||
            !repositoryId ||
            !repositoryRootPath
        ) {
            activeTransportKey = null;
            terminalSnapshot = null;
            error = null;
            loading = false;
            terminalTransport?.dispose();
            terminalTransport = null;
            return;
        }

        const nextTransportKey = [
            missionId,
            repositoryId,
            repositoryRootPath,
            terminalSessionId,
        ].join(":");

        if (activeTransportKey === nextTransportKey) {
            return;
        }

        activeTransportKey = nextTransportKey;
        terminalTransport?.dispose();
        terminalTransport = subscribeMissionSessionTerminalTransport({
            missionId,
            repositoryId,
            repositoryRootPath,
            sessionId: terminalSessionId,
        }, (state) => {
            terminalSnapshot = state.snapshot;
            loading = state.loading;
            error = state.error;
        });
    });

    $effect(() => {
        const screen = terminalSnapshot?.screen ?? "";
        const chunk = terminalSnapshot?.chunk;
        if (
            !terminal ||
            typeof screen !== "string" ||
            isPersistedTranscriptSnapshot
        ) {
            return;
        }

        const preparedScreen = prepareScreenForTerminal(
            screen,
            isPersistedTranscriptSnapshot,
        );

        if (
            (!chunk || chunk.length === 0) &&
            preparedScreen === lastRenderedScreen
        ) {
            return;
        }

        if (typeof chunk === "string" && chunk.length > 0) {
            lastRenderedScreen = preparedScreen;
            terminal.write(chunk);
            return;
        }

        const nextRender = normalizeScreen(preparedScreen);
        const previousRender = normalizeScreen(lastRenderedScreen);
        if (nextRender.startsWith(previousRender)) {
            const appendedOutput = nextRender.slice(previousRender.length);
            lastRenderedScreen = preparedScreen;
            terminal.write(appendedOutput);
            return;
        }

        lastRenderedScreen = preparedScreen;
        terminal.reset();
        terminal.write(nextRender);
    });

    $effect(() => {
        if (!terminal) {
            return;
        }
        fitAddon?.fit();
    });

    async function flushPendingInput(): Promise<void> {
        if (!session || !canAttachTerminal || pendingInput.length === 0) {
            return;
        }
        if (!terminalTransport) {
            return;
        }

        sendingInput = true;
        try {
            while (pendingInput.length > 0) {
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
        terminal.onData((data: string) => {
            if (!session || !canAttachTerminal || terminalSnapshot?.dead) {
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
        if (!session || !canAttachTerminal || !pendingResize) {
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

    function prepareScreenForTerminal(
        screen: string,
        stripAlternateScreen: boolean,
    ): string {
        if (!stripAlternateScreen) {
            return screen;
        }

        return screen.replace(/\u001b\[\?(?:47|1047|1048|1049)[hl]/g, "");
    }

    function renderPersistedTranscriptHtml(screen: string): string {
        if (!screen) {
            return "No transcript output captured.";
        }

        const normalizedTranscript = screen
            .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
            .replace(
                /\u001b\[\?(?:47|1047|1048|1049|1002|1004|1006|2004|2026)[hl]/g,
                "\n",
            )
            .replace(/\u001b\[(?:\d+;)*\d*[Hf]/g, "\n")
            .replace(/\u001b\[2K/g, "")
            .replace(/\u001b\[(?:\d+;)*\d*[ABCDGJKSTsu]/g, "\n")
            .replace(/\u001b(?:\(|\))[A-Za-z0-9]/g, "")
            .replace(/\u001b[A-Z\\]/g, "")
            .replace(/\r/g, "\n")
            .replace(/\u0007/g, "")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        return sanitizeHtml(
            Anser.ansiToHtml(Anser.escapeForHtml(normalizedTranscript), {
                use_classes: false,
            }),
            {
                allowedTags: sanitizeHtml.defaults.allowedTags.concat([
                    "span",
                    "br",
                ]),
                allowedAttributes: {
                    ...sanitizeHtml.defaults.allowedAttributes,
                    span: ["style"],
                },
                allowedStyles: {
                    span: {
                        color: [/^.*$/],
                        "background-color": [/^.*$/],
                        "font-weight": [/^.*$/],
                        "font-style": [/^.*$/],
                        "text-decoration": [/^.*$/],
                    },
                },
            },
        );
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
                    {session?.sessionId ?? "Agent session"}
                </h2>
                <p class="truncate text-xs text-muted-foreground">
                    {session?.currentTurnTitle ??
                        session?.workingDirectory ??
                        "Select a task or session row to pin the runtime console."}
                </p>
            </div>

            <AgentSessionActionbar
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
        {:else if isPersistedTranscriptSnapshot}
            <div
                class="h-full min-h-[24rem] overflow-auto bg-slate-950 px-3 py-2"
            >
                <div class="agent-session-transcript">
                    {@html persistedTranscriptHtml}
                </div>
            </div>
        {:else}
            <div class="h-full min-h-[24rem] overflow-hidden">
                <div
                    class="agent-session-terminal-shell flex h-full min-h-0 overflow-hidden bg-slate-950 p-2"
                >
                    <div
                        bind:this={container}
                        class="h-full min-h-0 flex-1"
                    ></div>
                </div>
            </div>
        {/if}
    </div>
</section>

<style>
    .agent-session-transcript {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family:
            ui-monospace,
            SFMono-Regular,
            Menlo,
            Monaco,
            Consolas,
            Liberation Mono,
            monospace;
        font-size: 0.8125rem;
        line-height: 1.35;
        color: #e2e8f0;
    }
</style>
