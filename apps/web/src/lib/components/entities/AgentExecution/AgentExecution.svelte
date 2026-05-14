<script lang="ts">
    import AgentExecutionCommandbar from "$lib/components/entities/AgentExecution/AgentExecutionCommandbar.svelte";
    import AgentExecutionTerminalReplay from "$lib/components/entities/AgentExecution/AgentExecutionTerminalReplay.svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import { AgentExecution as AgentExecutionEntity } from "$lib/components/entities/AgentExecution/AgentExecution.svelte.js";
    import { app } from "$lib/client/Application.svelte.js";
    import {
        createAppTerminalRuntime,
        type AppTerminal,
        type AppTerminalRuntime,
    } from "$lib/client/runtime/terminal/GhosttyTerminalRuntime";
    import type {
        AgentExecutionCommandType,
        AgentExecutionTerminalType,
    } from "@flying-pillow/open-mission-core/entities/AgentExecution/AgentExecutionSchema";
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
    let container = $state<HTMLDivElement | null>(null);
    let terminalState = $state<AgentExecutionTerminalType | null>(null);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let sendingInput = $state(false);
    let activeTransportKey = $state<string | null>(null);

    let terminal: AppTerminal | null = null;
    let terminalRuntime: AppTerminalRuntime | null = null;
    let terminalTransport =
        $state<SharedTerminalTransportSubscription<AgentExecutionTerminalType> | null>(
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
    const supportedMessages = $derived(agentExecution?.supportedMessages ?? []);
    const missionNativeMessages = $derived(
        agentExecution?.missionNativeMessages ?? [],
    );
    const structuredSupportedMessages = $derived(
        supportedMessages.filter(
            (message) =>
                message.portability !== "terminal-only" &&
                message.portability !== "mission-native",
        ),
    );
    const selectedCommandDescriptor = $derived(
        structuredSupportedMessages.find(
            (message) => message.type === selectedCommandType,
        ),
    );
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
    const surfaceId = $derived(app.repository?.id ?? "");
    const surfacePath = $derived(
        app.mission?.missionWorktreePath ??
            app.repository?.data.repositoryRootPath ??
            "",
    );
    const isPersistedTerminalRecording = $derived(
        Boolean(agentExecution && !agentExecution.isRunning()) ||
            Boolean(terminalState?.dead && !terminalState?.connected),
    );
    const terminalStateLabel = $derived.by(() => {
        if (!agentExecution) {
            return "No session";
        }
        if (!canAttachTerminal) {
            return "Not terminal-backed";
        }
        if (loading && !terminalState) {
            return "Connecting";
        }
        if (terminalState?.dead) {
            return terminalState.exitCode === null
                ? "Exited"
                : `Exited (${terminalState.exitCode})`;
        }
        if (terminalState?.connected) {
            return "Attached";
        }
        if (agentExecution.lifecycleState === "failed") {
            return "Failed";
        }
        return "Connecting";
    });
    $effect(() => {
        if (isPersistedTerminalRecording) {
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
            terminalState = null;
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
        terminalState = null;
        loading = true;
        error = null;
        pendingInput = "";
        pendingTerminalResponseFragment = "";
        lastRenderedScreen = "";
        terminal?.reset();
        terminalTransport?.dispose();
        terminalTransport = subscribeAgentExecutionTerminalTransport(
            {
                ownerId,
                repositoryId: surfaceId,
                repositoryRootPath: surfacePath,
                agentExecutionId: terminalId,
            },
            (state) => {
                terminalState = state.snapshot;
                loading = state.loading;
                error = state.error;
            },
        );
    });

    $effect(() => {
        const screen = terminalState?.screen ?? "";
        if (
            !terminal ||
            typeof screen !== "string" ||
            isPersistedTerminalRecording
        ) {
            return;
        }

        const preparedScreen = prepareScreenForTerminal(
            screen,
            isPersistedTerminalRecording,
        );

        if (preparedScreen === lastRenderedScreen) {
            return;
        }

        lastRenderedScreen = preparedScreen;
        const nextRender = normalizeScreen(preparedScreen);
        terminal.reset();
        writeToTerminalSafely(nextRender, nextRender);
    });

    $effect(() => {
        if (!terminal) {
            return;
        }
        terminalRuntime?.fit();
    });

    $effect(() => {
        const nextCommandType = structuredSupportedMessages[0]?.type;
        if (structuredSupportedMessages.length === 0) {
            selectedCommandType = "";
            return;
        }
        if (
            !structuredSupportedMessages.some(
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
            await agentExecution.sendMessageText(text);
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

    function insertMissionNativeCommand(
        message: AgentExecutionEntity["missionNativeMessages"][number],
    ): void {
        const slashCommand = `/${message.type} `;
        const currentText = promptText.trimStart();
        promptText = currentText.startsWith(slashCommand)
            ? promptText
            : `${slashCommand}${promptText}`.trimEnd();
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
            if (!selectedCommandDescriptor) {
                interactionError = "Select an available command to continue.";
                return;
            }

            await agentExecution.sendCommand(
                agentExecution.createSupportedMessageCommand({
                    descriptor: selectedCommandDescriptor,
                    reason: commandReason,
                }),
            );
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

        const runtime = await createAppTerminalRuntime({
            target,
            isDisposed,
            onResize: ({ cols, rows }) => {
                if (
                    !agentExecution ||
                    !canAttachTerminal ||
                    terminalState?.dead
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
                    terminalState?.dead
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

    function commandPortabilityBadgeClass(portability: string): string {
        switch (portability) {
            case "mission-native":
                return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
            case "adapter-scoped":
                return "border-amber-500/25 bg-amber-500/10 text-amber-200";
            case "terminal-only":
                return "border-slate-500/25 bg-slate-500/10 text-slate-300";
            case "cross-agent":
            default:
                return "border-sky-500/25 bg-sky-500/10 text-sky-200";
        }
    }

    function writeToTerminalSafely(data: string, fallbackScreen: string): void {
        if (!terminal || data.length === 0) {
            return;
        }

        try {
            terminal.write(data);
        } catch (writeError) {
            terminal.reset();
            const normalizedFallback = normalizeScreen(fallbackScreen);
            if (normalizedFallback.length > 0) {
                terminal.write(normalizedFallback);
            }
            error =
                writeError instanceof Error
                    ? writeError.message
                    : String(writeError);
        }
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
        {:else if isPersistedTerminalRecording}
            <AgentExecutionTerminalReplay
                recording={terminalState?.recording}
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
                                Send a message to the agent.
                            </p>
                        </div>
                        <textarea
                            bind:value={promptText}
                            class="min-h-28 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                            placeholder="Explain what the agent should do next."
                            disabled={interactionPending !== null}
                        ></textarea>
                        {#if missionNativeMessages.length > 0}
                            <div class="flex flex-wrap gap-2">
                                {#each missionNativeMessages as message (message.type)}
                                    <button
                                        type="button"
                                        class={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium transition hover:bg-muted/70 ${commandPortabilityBadgeClass(message.portability)}`}
                                        disabled={interactionPending !== null}
                                        onclick={() =>
                                            insertMissionNativeCommand(message)}
                                        title={message.description ??
                                            message.label}
                                    >
                                        /{message.type}
                                    </button>
                                {/each}
                            </div>
                        {/if}
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

                {#if agentExecution?.canSendStructuredCommand && structuredSupportedMessages.length > 0}
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
                                {#each structuredSupportedMessages as message (message.type)}
                                    <option value={message.type}>
                                        {message.label} - {AgentExecutionEntity.commandPortabilityLabel(
                                            message.portability,
                                        )}
                                    </option>
                                {/each}
                            </select>
                        </label>
                        {#if selectedCommandDescriptor}
                            <div
                                class="flex flex-wrap items-center gap-2 text-xs"
                            >
                                <span
                                    class={`inline-flex items-center rounded-md border px-2 py-1 font-medium ${commandPortabilityBadgeClass(selectedCommandDescriptor.portability)}`}
                                >
                                    {AgentExecutionEntity.commandPortabilityLabel(
                                        selectedCommandDescriptor.portability,
                                    )}
                                </span>
                                {#if selectedCommandDescriptor.adapterId}
                                    <span
                                        class="inline-flex items-center rounded-md border border-border bg-muted/30 px-2 py-1 text-muted-foreground"
                                    >
                                        {selectedCommandDescriptor.adapterId}
                                    </span>
                                {/if}
                            </div>
                        {/if}
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
