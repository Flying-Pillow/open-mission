<script lang="ts">
    import type { Snippet } from "svelte";
    import Icon from "@iconify/svelte";
    import type { AgentExecution as AgentExecutionEntity } from "$lib/components/entities/AgentExecution/AgentExecution.svelte.js";
    import AgentExecutionTerminalPanel from "$lib/components/entities/AgentExecution/AgentExecution.svelte";
    import AgentChatInputBar from "$lib/components/entities/AgentExecution/AgentChatInputBar.svelte";
    import AgentChatMessages from "$lib/components/entities/AgentExecution/AgentChatMessages.svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import {
        ResizableHandle,
        ResizablePane,
        ResizablePaneGroup,
    } from "$lib/components/ui/resizable";
    import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
    import type { AgentExecutionDataType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";

    type TimelineItem =
        AgentExecutionDataType["projection"]["timelineItems"][number];

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
    const timelineItems = $derived.by(() => {
        refreshNonce;
        return agentExecution?.timelineItems ?? [];
    });
    const timelineItemListKey = $derived.by(() => {
        return timelineItems.map((item) => item.id).join("|");
    });

    function itemIcon(item: TimelineItem): string {
        switch (item.primitive) {
            case "activity.progress":
                return "lucide:activity";
            case "attention.input-request":
                return "lucide:message-circle-question";
            case "attention.blocked":
                return "lucide:octagon-alert";
            case "attention.verification-requested":
            case "attention.verification-result":
                return "lucide:badge-check";
            case "runtime.warning":
                return "lucide:circle-x";
            case "activity.status":
            case "workflow.state-changed":
                return "lucide:check-check";
            default:
                return "lucide:message-square";
        }
    }

    function itemTitle(item: TimelineItem): string {
        if (item.payload.title) {
            return item.payload.title;
        }

        if (item.primitive === "conversation.operator-message") {
            return "You";
        }

        if (item.primitive === "conversation.system-message") {
            return "System";
        }

        return "Assistant";
    }

    function itemToneClasses(item: TimelineItem): string {
        if (item.primitive === "conversation.operator-message") {
            return "border-primary/35 bg-[#102017] text-slate-50 shadow-[inset_-3px_0_0_rgb(52_211_153)]";
        }

        switch (item.severity) {
            case "success":
                return "border-emerald-400/30 bg-[#0d1b15] text-emerald-50 shadow-[inset_3px_0_0_rgb(52_211_153)]";
            case "warning":
                return "border-amber-300/35 bg-[#20180b] text-amber-50 shadow-[inset_3px_0_0_rgb(251_191_36)]";
            case "error":
            case "critical":
                return "border-rose-400/35 bg-[#211015] text-rose-50 shadow-[inset_3px_0_0_rgb(251_113_133)]";
        }

        switch (item.primitive) {
            case "activity.progress":
            case "activity.status":
            case "activity.tool":
            case "activity.target":
                return "border-sky-400/30 bg-[#0d1820] text-sky-50 shadow-[inset_3px_0_0_rgb(56_189_248)]";
            case "workflow.state-changed":
            case "workflow.event":
                return "border-slate-500/25 bg-[#12151b] text-slate-300 shadow-[inset_3px_0_0_rgb(100_116_139)]";
            default:
                return "border-white/10 bg-[#12151b] text-slate-100 shadow-[inset_3px_0_0_rgb(148_163_184)]";
        }
    }

    function itemIconClasses(item: TimelineItem): string {
        if (item.primitive === "conversation.operator-message") {
            return "border-primary/30 bg-primary/15 text-emerald-200";
        }

        switch (item.severity) {
            case "success":
                return "border-emerald-300/25 bg-emerald-400/10 text-emerald-200";
            case "warning":
                return "border-amber-300/25 bg-amber-400/10 text-amber-200";
            case "error":
            case "critical":
                return "border-rose-300/25 bg-rose-400/10 text-rose-200";
        }

        switch (item.primitive) {
            case "activity.progress":
            case "activity.status":
            case "activity.tool":
            case "activity.target":
                return "border-sky-300/25 bg-sky-400/10 text-sky-200";
            default:
                return "border-white/10 bg-white/[0.04] text-slate-300";
        }
    }

    function itemAlignClasses(item: TimelineItem): string {
        if (item.primitive === "conversation.operator-message") {
            return "justify-end";
        }

        if (
            item.primitive === "conversation.system-message" ||
            item.zone === "workflow"
        ) {
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

{#snippet chatPanel()}
    {#if showHeader}
        <div class="border-b border-white/10 bg-[#0d0f13] px-4 py-4 md:px-5">
            <div
                class="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
            >
                <div class="flex min-w-0 items-start gap-3">
                    <span
                        class="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-emerald-200"
                    >
                        <Icon icon="lucide:bot-message-square" class="size-5" />
                    </span>
                    <div class="min-w-0">
                        <h2
                            class="min-w-0 truncate text-lg font-semibold leading-6 text-slate-50"
                        >
                            {title}
                        </h2>
                        <p class="mt-1 truncate text-xs text-slate-400">
                            {agentExecution?.adapterLabel ?? "Agent session"}
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
            {:else if timelineItems.length === 0}
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
                            Waiting for the first AgentExecution timeline item.
                        </p>
                    </div>
                </div>
            {:else if messagesViewport}
                {#key timelineItemListKey}
                    <AgentChatMessages
                        items={timelineItems}
                        viewport={messagesViewport}
                        {itemAlignClasses}
                        {itemToneClasses}
                        {itemIconClasses}
                        {itemIcon}
                        {itemTitle}
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
{/snippet}

{#snippet terminalPanel()}
    <div
        class="flex h-[4.5625rem] shrink-0 items-center justify-between border-b border-white/10 bg-[#0d0f13] px-4"
    >
        <div class="min-w-0">
            <h3 class="truncate text-sm font-semibold text-slate-50">
                AgentExecution terminal
            </h3>
            <p class="truncate text-xs text-slate-400">
                {agentExecution?.terminalName ??
                    agentExecution?.agentExecutionId ??
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
            {agentExecution}
            {onCommandExecuted}
            panelMode="terminal"
        />
    </div>
{/snippet}

<section class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#08090b]">
    {#if resolvedShowTerminalPanel}
        <ResizablePaneGroup
            direction="horizontal"
            autoSaveId={`agent-chat:${agentExecution?.agentExecutionId ?? "pending"}`}
            class="min-h-0 flex-1 overflow-hidden"
        >
            <ResizablePane
                defaultSize={58}
                minSize={35}
                class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
            >
                {@render chatPanel()}
            </ResizablePane>

            <ResizableHandle withHandle />

            <ResizablePane
                defaultSize={42}
                minSize={24}
                maxSize={65}
                class="flex h-full min-h-0 min-w-0 flex-col border-l border-white/10 bg-[#08090b]"
            >
                {@render terminalPanel()}
            </ResizablePane>
        </ResizablePaneGroup>
    {:else}
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {@render chatPanel()}
        </div>
    {/if}
</section>
