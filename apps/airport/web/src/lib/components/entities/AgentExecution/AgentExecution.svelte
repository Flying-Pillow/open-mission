<script lang="ts">
    import AgentExecutionCommandbar from "$lib/components/entities/AgentExecution/AgentExecutionCommandbar.svelte";
    import AgentExecutionTerminalReplay from "$lib/components/entities/AgentExecution/AgentExecutionTerminalReplay.svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import type { AgentExecution as AgentExecutionEntity } from "$lib/components/entities/AgentExecution/AgentExecution.svelte.js";
    import { maybeGetAgentExecutionSurfaceContext } from "$lib/client/context/agent-execution-surface-context.svelte.js";
    import {
        createAirportTerminalRuntime,
        type AirportTerminal,
        type AirportTerminalRuntime,
    } from "$lib/client/runtime/terminal/GhosttyTerminalRuntime";
    import type {
        AgentExecutionCommandType,
        AgentExecutionTerminalSnapshotType,
    } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";
    import {
        subscribeAgentExecutionTerminalTransport,
        type SharedTerminalTransportSubscription,
    } from "$lib/client/runtime/terminal/TerminalTransportBroker";

    let {
        refreshNonce,
        agentExecution,
        onCommandExecuted,
        panelMode = "full",
    }: {
        refreshNonce: number;
        agentExecution?: AgentExecutionEntity;
        onCommandExecuted: () => Promise<void>;
        panelMode?: "full" | "terminal";
    } = $props();
    const executionSurface = maybeGetAgentExecutionSurfaceContext();

    let container = $state<HTMLDivElement | null>(null);
    let terminalSnapshot = $state<AgentExecutionTerminalSnapshotType | null>(
        null,
    );
    let loading = $state(false);
    let error = $state<string | null>(null);
    let sendingInput = $state(false);
    let activeTransportKey = $state<string | null>(null);

    let terminal: AirportTerminal | null = null;
    let terminalRuntime: AirportTerminalRuntime | null = null;
    let terminalTransport =
        $state<SharedTerminalTransportSubscription<AgentExecutionTerminalSnapshotType> | null>(
            null,
        );
    let pendingInput = "";
    let pendingTerminalResponseFragment = "";
    let lastRenderedScreen = "";
    let pendingResize: { cols: number; rows: number } | null = null;
    let promptText = $state("");
    let selectedCommandType = $state<AgentExecutionCommandType["type"] | "">(
        "",
    );
    let commandReason = $state("");
    let interactionPending = $state<"prompt" | "command" | null>(null);
    let interactionError = $state<string | null>(null);

    const canAttachTerminal = $derived(
        Boolean(agentExecution?.isTerminalBacked()),
    );
    const showFullControls = $derived(panelMode === "full");
    const runtimeMessages = $derived(agentExecution?.runtimeMessages ?? []);
    const canShowStructuredComposer = $derived(
        Boolean(
            agentExecution &&
                agentExecution.interactionMode === "agent-message" &&
                (agentExecution.canSendStructuredPrompt ||
                    agentExecution.canSendStructuredCommand),
        ),
    );
    const interactionModeLabel = $derived.by(() => {
        switch (agentExecution?.interactionMode) {
            case "pty-terminal":
                return "terminal";
            case "agent-message":
                return "Agent message";
            case "read-only":
                return "Read only";
            default:
                return "Unknown";
        }
    });
    const interactionSummary = $derived.by(() => {
        if (!agentExecution) {
            return null;
        }
        if (agentExecution.interactionMode === "pty-terminal") {
            return "Mission is attached to the live PTY terminal for this execution.";
        }
        if (agentExecution.interactionMode === "agent-message") {
            return "Mission can continue this session through structured prompts and commands.";
        }
        return (
            agentExecution.interactionReason ??
            "This session is read-only and cannot accept follow-up input."
        );
    });
    const terminalId = $derived(agentExecution?.agentExecutionId ?? null);
    const ownerId = $derived(agentExecution?.ownerId ?? "");
    const surfaceId = $derived(executionSurface?.surfaceId ?? "");
    const surfacePath = $derived(executionSurface?.surfacePath ?? "");
    const isPersistedTranscriptSnapshot = $derived(
        Boolean(agentExecution && !agentExecution.isRunning()) ||
            Boolean(terminalSnapshot?.dead && !terminalSnapshot?.connected),
    );
    const terminalStateLabel = $derived.by(() => {
        if (!agentExecution) {
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
        if (agentExecution.lifecycleState === "failed") {
            return "Failed";
        }
        return "Connecting";
    });
    $effect(() => {
        if (isPersistedTranscriptSnapshot) {
            terminalRuntime?.dispose();
            terminalRuntime = null;
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
        if (
            !terminalId ||
            !canAttachTerminal ||
            !ownerId ||
            !surfaceId ||
            !surfacePath
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
            ownerId,
            surfaceId,
            surfacePath,
            terminalId,
        ].join(":");

        if (activeTransportKey === nextTransportKey) {
            return;
        }

        activeTransportKey = nextTransportKey;
        terminalTransport?.dispose();
        terminalTransport = subscribeAgentExecutionTerminalTransport(
            {
                ownerId,
                repositoryId: surfaceId,
                repositoryRootPath: surfacePath,
                agentExecutionId: terminalId,
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
        terminalRuntime?.fit();
    });

    $effect(() => {
        const nextCommandType = runtimeMessages[0]?.type;
        if (runtimeMessages.length === 0) {
            selectedCommandType = "";
            return;
        }
        if (
            !runtimeMessages.some(
                (message) => message.type === selectedCommandType,
            )
        ) {
            selectedCommandType =
                (nextCommandType as
                    | AgentExecutionCommandType["type"]
                    | undefined) ?? "";
        }
    });

    $effect(() => {
        refreshNonce;
        interactionError = null;
    });

    async function submitStructuredPrompt(): Promise<void> {
        if (
            !agentExecution ||
            !agentExecution.canSendStructuredPrompt ||
            interactionPending !== null
        ) {
            return;
        }

        const text = promptText.trim();
        if (!text) {
            interactionError = "Prompt text is required.";
            return;
        }

        interactionPending = "prompt";
        interactionError = null;
        try {
            await agentExecution.sendPrompt({
                source: "operator",
                text,
            });
            promptText = "";
            await onCommandExecuted();
        } catch (submitError) {
            interactionError =
                submitError instanceof Error
                    ? submitError.message
                    : String(submitError);
        } finally {
            interactionPending = null;
        }
    }

    async function submitStructuredCommand(): Promise<void> {
        if (
            !agentExecution ||
            !agentExecution.canSendStructuredCommand ||
            interactionPending !== null
        ) {
            return;
        }

        if (!selectedCommandType) {
            interactionError = "Select a command to continue.";
            return;
        }

        interactionPending = "command";
        interactionError = null;
        try {
            await agentExecution.sendCommand({
                type: selectedCommandType,
                ...(commandReason.trim()
                    ? { reason: commandReason.trim() }
                    : {}),
            });
            commandReason = "";
            await onCommandExecuted();
        } catch (submitError) {
            interactionError =
                submitError instanceof Error
                    ? submitError.message
                    : String(submitError);
        } finally {
            interactionPending = null;
        }
    }

    async function flushPendingInput(): Promise<void> {
        if (
            !agentExecution ||
            !canAttachTerminal ||
            pendingInput.length === 0
        ) {
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
                if (
                    !agentExecution ||
                    !canAttachTerminal ||
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
            },
            onData: (data) => {
                if (
                    !agentExecution ||
                    !canAttachTerminal ||
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
            },
        });
        if (!runtime) {
            return;
        }
        terminalRuntime = runtime;
        terminal = runtime.terminal;
    }

    async function flushPendingResize(): Promise<void> {
        if (!agentExecution || !canAttachTerminal || !pendingResize) {
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
    {#if showFullControls}
        <header class="px-3 py-2">
            <div class="flex flex-wrap items-start gap-2">
                <div class="min-w-0 flex-1">
                    <h2 class="truncate text-sm font-semibold text-foreground">
                        {agentExecution?.agentExecutionId ?? "Agent execution"}
                    </h2>
                    <p class="truncate text-xs text-muted-foreground">
                        {agentExecution?.currentTurnTitle ??
                            agentExecution?.workingDirectory ??
                            "Select a task or session row to pin the runtime console."}
                    </p>
                </div>

                <!-- <div class="text-right text-xs text-muted-foreground">
                    <p>{terminalStateLabel}</p>
                    {#if agentExecution}
                        <p class="mt-1">{agentExecution.lifecycleState}</p>
                        <p class="mt-1">{interactionModeLabel}</p>
                    {/if}
                </div> -->

                <AgentExecutionCommandbar
                    {refreshNonce}
                    {agentExecution}
                    {onCommandExecuted}
                />
            </div>
            <!-- {#if interactionSummary}
                <p class="text-xs text-muted-foreground">{interactionSummary}</p>
            {/if} -->
        </header>
    {/if}

    {#if error}
        <div
            class="border-b border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
            {error}
        </div>
    {/if}

    <div class="flex-1 min-h-0">
        {#if !agentExecution}
            <div
                class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-muted-foreground"
            >
                No session resolves from the current mission selection.
            </div>
        {:else if !canAttachTerminal}
            <div
                class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-muted-foreground"
            >
                {#if canShowStructuredComposer}
                    Mission is not attached to a live PTY for this execution.
                    Use the structured input controls below to continue the run.
                {:else}
                    {agentExecution.interactionReason ??
                        "This session is not terminal-backed, so Mission Control cannot attach an interactive console."}
                {/if}
            </div>
        {:else if isPersistedTranscriptSnapshot}
            <AgentExecutionTerminalReplay
                recording={terminalSnapshot?.recording}
            />
        {:else}
            <div class="h-full min-h-[24rem] overflow-hidden">
                <div
                    class="agent-execution-terminal-shell flex h-full min-h-0 overflow-hidden bg-slate-950 p-2"
                >
                    <div
                        bind:this={container}
                        class="h-full min-h-0 flex-1"
                    ></div>
                </div>
            </div>
        {/if}
    </div>

    {#if showFullControls && canShowStructuredComposer}
        <section class="border-t border-border/60 px-3 py-3">
            <div class="grid gap-4 lg:grid-cols-2">
                {#if agentExecution?.canSendStructuredPrompt}
                    <form
                        class="space-y-2"
                        onsubmit={(event) => {
                            event.preventDefault();
                            void submitStructuredPrompt();
                        }}
                    >
                        <div>
                            <h3 class="text-sm font-medium text-foreground">
                                Prompt
                            </h3>
                            <p class="text-xs text-muted-foreground">
                                Send a structured operator reply through Mission
                                runtime APIs.
                            </p>
                        </div>
                        <textarea
                            bind:value={promptText}
                            class="min-h-28 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                            placeholder="Explain what the agent should do next."
                            disabled={interactionPending !== null}
                        ></textarea>
                        <Button
                            type="submit"
                            size="sm"
                            disabled={interactionPending !== null ||
                                promptText.trim().length === 0}
                        >
                            {interactionPending === "prompt"
                                ? "Sending prompt..."
                                : "Send prompt"}
                        </Button>
                    </form>
                {/if}

                {#if agentExecution?.canSendStructuredCommand}
                    <form
                        class="space-y-2"
                        onsubmit={(event) => {
                            event.preventDefault();
                            void submitStructuredCommand();
                        }}
                    >
                        <div>
                            <h3 class="text-sm font-medium text-foreground">
                                Command
                            </h3>
                            <p class="text-xs text-muted-foreground">
                                Use Mission-owned runtime commands instead of
                                terminal keystrokes.
                            </p>
                        </div>
                        <label class="space-y-1 text-sm">
                            <span class="text-xs text-muted-foreground">
                                Command
                            </span>
                            <select
                                bind:value={selectedCommandType}
                                class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                                disabled={interactionPending !== null}
                            >
                                {#each runtimeMessages as message (message.type)}
                                    <option value={message.type}>
                                        {message.label}
                                    </option>
                                {/each}
                            </select>
                        </label>
                        <label class="space-y-1 text-sm">
                            <span class="text-xs text-muted-foreground">
                                Reason
                            </span>
                            <textarea
                                bind:value={commandReason}
                                class="min-h-28 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                                placeholder="Optional context for the selected runtime command."
                                disabled={interactionPending !== null}
                            ></textarea>
                        </label>
                        <Button
                            type="submit"
                            size="sm"
                            disabled={interactionPending !== null ||
                                selectedCommandType.length === 0}
                        >
                            {interactionPending === "command"
                                ? "Sending command..."
                                : "Send command"}
                        </Button>
                    </form>
                {/if}
            </div>

            {#if interactionError}
                <p class="mt-3 text-sm text-rose-600">{interactionError}</p>
            {/if}
        </section>
    {/if}
</section>
