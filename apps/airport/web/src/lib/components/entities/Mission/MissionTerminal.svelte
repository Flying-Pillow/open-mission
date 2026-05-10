<script lang="ts">
    import type { MissionTerminalSnapshotType } from "@flying-pillow/mission-core/entities/Mission/MissionSchema";
    import { getScopedMissionContext } from "$lib/client/context/scoped-mission-context.svelte.js";
    import {
        createAirportTerminalRuntime,
        type AirportTerminal,
        type AirportTerminalRuntime,
    } from "$lib/client/runtime/terminal/GhosttyTerminalRuntime";
    import {
        subscribeMissionTerminalTransport,
        type SharedTerminalTransportSubscription,
    } from "$lib/client/runtime/terminal/TerminalTransportBroker";
    const missionScope = getScopedMissionContext();
    const mission = $derived(missionScope.mission);
    const activeRepository = $derived(missionScope.repository);
    const missionId = $derived(mission?.missionId ?? "");
    const repositoryId = $derived(activeRepository?.id ?? "");
    const repositoryRootPath = $derived(
        mission?.missionWorktreePath ??
            activeRepository?.data.repositoryRootPath ??
            "",
    );

    let container = $state<HTMLDivElement | null>(null);
    let terminalSnapshot = $state<MissionTerminalSnapshotType | null>(null);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let sendingInput = $state(false);
    let activeTransportKey = $state<string | null>(null);

    let terminal: AirportTerminal | null = null;
    let terminalRuntime: AirportTerminalRuntime | null = null;
    let terminalTransport =
        $state<SharedTerminalTransportSubscription<MissionTerminalSnapshotType> | null>(
            null,
        );
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
            terminalRuntime?.dispose();
            terminalRuntime = null;
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
        terminalTransport = subscribeMissionTerminalTransport(
            {
                missionId: normalizedMissionId,
                repositoryId: normalizedRepositoryId,
                repositoryRootPath: normalizedRepositoryRootPath,
            },
            (state) => {
                terminalSnapshot = state.snapshot;
                loading = state.loading;
                error = state.error;
            },
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

        if (
            lastRenderedScreen.length > 0 &&
            screen.startsWith(lastRenderedScreen)
        ) {
            const appendedScreen = screen.slice(lastRenderedScreen.length);
            lastRenderedScreen = screen;
            if (appendedScreen.length > 0) {
                terminal.write(normalizeScreen(appendedScreen));
            }
            return;
        }

        lastRenderedScreen = screen;
        terminal.reset();
        terminal.write(normalizeScreen(screen));
        terminalRuntime?.fit();
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

    async function initializeTerminal(
        target: HTMLDivElement,
        isDisposed: () => boolean,
    ): Promise<void> {
        if (isDisposed()) {
            return;
        }

        const runtime = await createAirportTerminalRuntime({
            target,
            isDisposed,
            onResize: ({ cols, rows }) => {
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
            },
            onData: (data) => {
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
            },
        });
        if (!runtime) {
            return;
        }
        terminalRuntime = runtime;
        terminal = runtime.terminal;
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
        <div class="h-full min-h-0 overflow-hidden">
            <div class="h-full min-h-0 overflow-hidden bg-slate-950 px-2 py-2">
                <div bind:this={container} class="h-full w-full min-h-0"></div>
            </div>
        </div>
    </div>
</section>
