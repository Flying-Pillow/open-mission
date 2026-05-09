<script lang="ts">
    import type { Snippet } from "svelte";
    import Icon from "@iconify/svelte";
    import type { AgentExecution as AgentExecutionEntity } from "$lib/components/entities/AgentExecution/AgentExecution.svelte.js";
    import AgentExecutionTerminalPanel from "$lib/components/entities/AgentExecution/AgentExecution.svelte";
    import AgentChatInputBar from "$lib/components/entities/AgentExecution/AgentChatInputBar.svelte";
    import AgentChatMessages from "$lib/components/entities/AgentExecution/AgentChatMessages.svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
    import type { AgentExecutionDataType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";

    type ChatMessage = AgentExecutionDataType["chatMessages"][number];

    let {
        agentExecution,
        refreshNonce,
        onCommandExecuted,
        showHeader = true,
        showTerminalPanel = $bindable(false),
        title = "Agent chat",
        loadingTitle = "Starting agent chat",
        loadingPlaceholder = "Starting agent chat",
        headerActions,
    }: {
        agentExecution?: AgentExecutionEntity;
        refreshNonce: number;
        onCommandExecuted: () => Promise<void>;
        showHeader?: boolean;
        showTerminalPanel?: boolean;
        title?: string;
        loadingTitle?: string;
        loadingPlaceholder?: string;
        headerActions?: Snippet<
            [
                {
                    agentExecution?: AgentExecutionEntity;
                    showTerminalPanel: boolean;
                    canShowTerminalPanel: boolean;
                    toggleTerminalPanel: () => void;
                },
            ]
        >;
    } = $props();

    let draft = $state("");
    let promptPending = $state(false);
    let promptError = $state<string | null>(null);
    let messagesViewport = $state<HTMLElement | null>(null);

    const canSendPrompt = $derived(
        Boolean(agentExecution?.canSendStructuredPrompt),
    );
    const canShowTerminalPanel = $derived(
        Boolean(agentExecution?.isTerminalBacked()),
    );
    const resolvedShowTerminalPanel = $derived(
        showTerminalPanel && canShowTerminalPanel,
    );
    const chatMessages = $derived.by(() => {
        refreshNonce;
        return agentExecution?.chatMessages ?? [];
    });
    const chatMessageListKey = $derived.by(() => {
        return chatMessages.map((message) => message.id).join("|");
    });

    function messageIcon(message: ChatMessage): string {
        switch (message.kind) {
            case "progress":
                return "lucide:activity";
            case "needs-input":
                return "lucide:message-circle-question";
            case "blocked":
                return "lucide:octagon-alert";
            case "claim":
                return "lucide:badge-check";
            case "failure":
                return "lucide:circle-x";
            case "status":
                return "lucide:check-check";
            default:
                return "lucide:message-square";
        }
    }

    function messageTitle(message: ChatMessage): string {
        if (message.role === "operator") {
            return "You";
        }

        if (message.role === "system") {
            return message.title ?? "System";
        }

        return message.title ?? "Assistant";
    }

    function messageToneClasses(message: ChatMessage): string {
        if (message.role === "operator") {
            return "border-primary/35 bg-[#102017] text-slate-50 shadow-[inset_-3px_0_0_rgb(52_211_153)]";
        }

        switch (message.tone) {
            case "progress":
                return "border-sky-400/30 bg-[#0d1820] text-sky-50 shadow-[inset_3px_0_0_rgb(56_189_248)]";
            case "attention":
                return "border-amber-300/35 bg-[#20180b] text-amber-50 shadow-[inset_3px_0_0_rgb(251_191_36)]";
            case "success":
                return "border-emerald-400/30 bg-[#0d1b15] text-emerald-50 shadow-[inset_3px_0_0_rgb(52_211_153)]";
            case "danger":
                return "border-rose-400/35 bg-[#211015] text-rose-50 shadow-[inset_3px_0_0_rgb(251_113_133)]";
            case "muted":
                return "border-slate-500/25 bg-[#12151b] text-slate-300 shadow-[inset_3px_0_0_rgb(100_116_139)]";
            default:
                return "border-white/10 bg-[#12151b] text-slate-100 shadow-[inset_3px_0_0_rgb(148_163_184)]";
        }
    }

    function messageIconClasses(message: ChatMessage): string {
        if (message.role === "operator") {
            return "border-primary/30 bg-primary/15 text-emerald-200";
        }

        switch (message.tone) {
            case "progress":
                return "border-sky-300/25 bg-sky-400/10 text-sky-200";
            case "attention":
                return "border-amber-300/25 bg-amber-400/10 text-amber-200";
            case "success":
                return "border-emerald-300/25 bg-emerald-400/10 text-emerald-200";
            case "danger":
                return "border-rose-300/25 bg-rose-400/10 text-rose-200";
            default:
                return "border-white/10 bg-white/[0.04] text-slate-300";
        }
    }

    function messageAlignClasses(message: ChatMessage): string {
        if (message.role === "operator") {
            return "justify-end";
        }

        if (message.role === "system" || message.kind === "status") {
            return "justify-center";
        }

        return "justify-start";
    }

    function providerIcon(agentId: string | undefined): string {
        const normalized = (agentId ?? "").toLowerCase();
        if (normalized.includes("copilot")) {
            return "simple-icons:githubcopilot";
        }
        if (normalized.includes("openai") || normalized.includes("codex")) {
            return "simple-icons:openai";
        }
        if (normalized.includes("claude") || normalized.includes("anthropic")) {
            return "simple-icons:anthropic";
        }
        if (normalized.includes("opencode")) {
            return "lucide:code-2";
        }
        if (normalized.includes("pi")) {
            return "lucide:message-circle";
        }

        return "lucide:bot";
    }

    function toggleTerminalPanel(): void {
        if (!canShowTerminalPanel) {
            return;
        }

        showTerminalPanel = !showTerminalPanel;
    }

    async function submitPrompt(event: SubmitEvent): Promise<void> {
        event.preventDefault();

        if (!agentExecution || !agentExecution.canSendStructuredPrompt) {
            return;
        }

        const text = draft.trim();
        if (!text) {
            promptError = "Prompt text is required.";
            return;
        }

        promptPending = true;
        promptError = null;
        try {
            await agentExecution.sendPrompt({
                source: "operator",
                text,
            });
            draft = "";
            await onCommandExecuted();
        } catch (submitError) {
            promptError =
                submitError instanceof Error
                    ? submitError.message
                    : String(submitError);
        } finally {
            promptPending = false;
        }
    }

    async function useChoice(value: string): Promise<void> {
        draft = value;
        await submitPrompt(new SubmitEvent("submit"));
    }
</script>

<section
    class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#08090b] lg:flex-row"
>
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        {#if showHeader}
            <div
                class="border-b border-white/10 bg-[#0d0f13] px-4 py-4 md:px-5"
            >
                <div
                    class="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
                >
                    <div class="flex min-w-0 items-start gap-3">
                        <span
                            class="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-emerald-200"
                        >
                            <Icon
                                icon="lucide:bot-message-square"
                                class="size-5"
                            />
                        </span>
                        <div class="min-w-0">
                            <h2
                                class="min-w-0 truncate text-lg font-semibold leading-6 text-slate-50"
                            >
                                {title}
                            </h2>
                            <p class="mt-1 truncate text-xs text-slate-400">
                                {agentExecution?.adapterLabel ??
                                    "Agent session"}
                            </p>
                        </div>
                    </div>
                    <div
                        class="flex shrink-0 flex-wrap items-center justify-end gap-2"
                    >
                        {@render headerActions?.({
                            agentExecution,
                            showTerminalPanel: resolvedShowTerminalPanel,
                            canShowTerminalPanel,
                            toggleTerminalPanel,
                        })}
                    </div>
                </div>
            </div>
        {/if}

        <ScrollArea.Root
            bind:viewportRef={messagesViewport}
            class="min-h-0 flex-1"
            scrollbarYClasses="py-2"
        >
            <div class="mx-auto w-full max-w-4xl px-4 py-5 md:px-6">
                {#if !agentExecution}
                    <div
                        class="rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-5 py-8 text-center"
                    >
                        <Icon
                            icon="lucide:messages-square"
                            class="mx-auto size-8 text-slate-500"
                        />
                        <h3 class="mt-3 text-sm font-medium text-slate-200">
                            {loadingTitle}
                        </h3>
                    </div>
                {:else if chatMessages.length === 0}
                    <div class="flex justify-start">
                        <div
                            class="max-w-[min(44rem,100%)] rounded-lg border border-white/10 bg-[#12151b] px-4 py-3 text-slate-100 shadow-[inset_3px_0_0_rgb(148_163_184)]"
                        >
                            <div
                                class="flex items-center gap-2 text-sm font-medium text-slate-200"
                            >
                                <Icon icon="lucide:sparkles" class="size-4" />
                                Assistant
                            </div>
                            <p class="mt-2 text-sm leading-6 text-slate-400">
                                Waiting for the first AgentExecution signal.
                            </p>
                        </div>
                    </div>
                {:else if messagesViewport}
                    {#key chatMessageListKey}
                        <AgentChatMessages
                            messages={chatMessages}
                            viewport={messagesViewport}
                            {messageAlignClasses}
                            {messageToneClasses}
                            {messageIconClasses}
                            {messageIcon}
                            {messageTitle}
                            {useChoice}
                        />
                    {/key}
                {/if}
            </div>
        </ScrollArea.Root>

        <AgentChatInputBar
            bind:value={draft}
            placeholder={agentExecution
                ? "Message the assistant"
                : loadingPlaceholder}
            disabled={!agentExecution || !canSendPrompt || promptPending}
            pending={promptPending}
            error={promptError}
            onSubmit={submitPrompt}
        />
    </div>

    {#if resolvedShowTerminalPanel}
        <aside
            class="flex min-h-80 min-w-0 flex-1 flex-col border-t border-white/10 bg-[#08090b] lg:min-h-0 lg:border-l lg:border-t-0"
        >
            <div
                class="flex h-[4.5625rem] shrink-0 items-center justify-between border-b border-white/10 bg-[#0d0f13] px-4"
            >
                <div class="min-w-0">
                    <h3 class="truncate text-sm font-semibold text-slate-50">
                        AgentExecution terminal
                    </h3>
                    <p class="truncate text-xs text-slate-400">
                        {agentExecution?.terminalName ??
                            agentExecution?.sessionId ??
                            "Terminal"}
                    </p>
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Close AgentExecution terminal"
                    title="Close AgentExecution terminal"
                    onclick={() => {
                        showTerminalPanel = false;
                    }}
                >
                    <Icon icon="lucide:x" class="size-4" />
                </Button>
            </div>
            <div class="min-h-0 flex-1">
                <AgentExecutionTerminalPanel
                    {refreshNonce}
                    session={agentExecution}
                    {onCommandExecuted}
                    panelMode="terminal"
                />
            </div>
        </aside>
    {/if}
</section>
