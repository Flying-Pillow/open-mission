<script lang="ts">
    import {
        missionTerminalSnapshotSchema,
        missionTerminalSocketServerMessageSchema,
        type MissionTerminalSnapshot,
    } from "@flying-pillow/mission-core/airport/runtime";
    import { getScopedMissionContext } from "$lib/client/context/scoped-mission-context.svelte.js";
    import { FitAddon } from "@xterm/addon-fit";
    import * as XtermModule from "@xterm/xterm";
    import {
        subscribeMissionTerminalTransport,
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

    type TerminalResizeEvent = { cols: number; rows: number };
    const missionScope = getScopedMissionContext();
    const mission = $derived(missionScope.mission);
    const activeRepository = $derived(missionScope.repository);
    const missionId = $derived(mission?.missionId ?? "");
    const repositoryId = $derived(activeRepository?.repositoryId ?? "");
    const repositoryRootPath = $derived(
        mission?.missionWorktreePath ?? activeRepository?.repositoryRootPath ?? "",
    );

    let container = $state<HTMLDivElement | null>(null);
    let terminalSnapshot = $state<MissionTerminalSnapshot | null>(null);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let sendingInput = $state(false);
    let activeTransportKey = $state<string | null>(null);

    let terminal: XtermTerminal | null = null;
    let fitAddon: XtermFitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let terminalTransport =
        $state<SharedTerminalTransportSubscription<MissionTerminalSnapshot> | null>(null);
    let pendingInput = "";
    let pendingTerminalResponseFragment = "";
    let lastRenderedScreen = "";
    let pendingResize: { cols: number; rows: number } | null = null;

    const MAX_TERMINAL_SNAPSHOT_LENGTH = 40_000;

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
            terminalTransport?.dispose();
            terminalTransport = null;
        };
    });

    $effect(() => {
        const normalizedMissionId = missionId?.trim();
        const normalizedRepositoryId = repositoryId?.trim();
        const normalizedRepositoryRootPath = repositoryRootPath?.trim();

        if (
            !normalizedMissionId ||
            !normalizedRepositoryId ||
            !normalizedRepositoryRootPath
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
            normalizedMissionId,
            normalizedRepositoryId,
            normalizedRepositoryRootPath,
        ].join(":");

        if (activeTransportKey === nextTransportKey) {
            return;
        }

        activeTransportKey = nextTransportKey;
        terminalTransport?.dispose();
        terminalTransport = subscribeMissionTerminalTransport({
            missionId: normalizedMissionId,
            repositoryId: normalizedRepositoryId,
            repositoryRootPath: normalizedRepositoryRootPath,
        }, (state) => {
            terminalSnapshot = state.snapshot;
            loading = state.loading;
            error = state.error;
        });
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
        terminal.onData((data: string) => {
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
