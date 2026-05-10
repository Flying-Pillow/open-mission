<script lang="ts">
    import type { Snippet } from "svelte";
    import Icon from "@iconify/svelte";
    import { shimmerThinking } from "$lib/actions/shimmer";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import type { AgentExecution as AgentExecutionEntity } from "$lib/components/entities/AgentExecution/AgentExecution.svelte.js";
    import AgentExecutionTerminalPanel from "$lib/components/entities/AgentExecution/AgentExecution.svelte";
    import AgentChatInputBar from "$lib/components/entities/AgentExecution/AgentChatInputBar.svelte";
    import AgentChatJournalTable from "$lib/components/entities/AgentExecution/AgentChatJournalTable.svelte";
    import AgentChatMessages from "$lib/components/entities/AgentExecution/AgentChatMessages.svelte";
    import Artifacts from "$lib/components/entities/Artifact/Artifacts.svelte";
    import type { Artifact as ArtifactEntity } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import {
        agentChatShowsWorkingShine,
        resolveAgentChatHeaderDetail,
        resolveAgentChatHeaderTitle,
        type AgentChatHeaderExecution,
    } from "$lib/components/entities/AgentExecution/agentChatHeader";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import {
        ResizableHandle,
        ResizablePane,
        ResizablePaneGroup,
    } from "$lib/components/ui/resizable";
    import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
    import * as Tabs from "$lib/components/ui/tabs/index.js";
    import type { AgentExecutionDataType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";

    type TimelineItem =
        AgentExecutionDataType["projection"]["timelineItems"][number];
    type AttentionProjection =
        AgentExecutionDataType["projection"]["currentAttention"];

    let {
        agentExecution,
        refreshNonce,
        onCommandExecuted,
        showHeader = true,
        title = "Agent chat",
        loadingTitle = "Starting agent chat",
        loadingPlaceholder = "Starting agent chat",
    }: {
        agentExecution?: AgentExecutionEntity;
        refreshNonce: number;
        onCommandExecuted: () => Promise<void>;
        showHeader?: boolean;
        title?: string;
        loadingTitle?: string;
        loadingPlaceholder?: string;
    } = $props();

    let draft = $state("");
    let promptPending = $state(false);
    let promptError = $state<string | null>(null);
    let messagesViewport = $state<HTMLElement | null>(null);
    let openArtifacts = $state<ArtifactEntity[]>([]);
    let activeArtifactId = $state<string | undefined>(undefined);
    let activePanel = $state<"messages" | "journal" | "terminal">("messages");

    const appContext = getAppContext();

    const canSendPrompt = $derived(
        Boolean(agentExecution?.canSendStructuredPrompt) &&
            isExecutionTransportCommandable(agentExecution),
    );
    const canShowTerminalPanel = $derived(
        Boolean(agentExecution?.isTerminalBacked()),
    );
    const timelineItems = $derived.by(() => {
        refreshNonce;
        return agentExecution?.timelineItems ?? [];
    });
    const journalRecords = $derived.by(() => {
        refreshNonce;
        return agentExecution?.journalRecords ?? [];
    });
    const currentActivity = $derived.by(() => {
        refreshNonce;
        return agentExecution?.currentActivity;
    });
    const currentInputRequest = $derived.by<AttentionProjection>(() => {
        refreshNonce;
        const attention = agentExecution?.projection.currentAttention;
        if (
            attention?.primitive !== "attention.input-request" ||
            !attention.currentInputRequestId
        ) {
            return undefined;
        }

        return attention;
    });
    const headerExecution = $derived.by<AgentChatHeaderExecution | undefined>(
        () => {
            refreshNonce;
            if (!agentExecution) {
                return undefined;
            }

            return {
                ownerId: agentExecution.ownerId,
                scope: agentExecution.scope,
                taskId: agentExecution.taskId,
                assignmentLabel: agentExecution.assignmentLabel,
                currentTurnTitle: agentExecution.currentTurnTitle,
                lifecycleState: agentExecution.lifecycleState,
                currentActivity: agentExecution.currentActivity,
            };
        },
    );
    const headerTitleText = $derived(
        resolveAgentChatHeaderTitle(headerExecution, title),
    );
    const headerDetailText = $derived(
        resolveAgentChatHeaderDetail(headerExecution),
    );
    const headerShowsWorkingShine = $derived(
        agentChatShowsWorkingShine(headerExecution),
    );
    const selectedArtifact = $derived.by(() => {
        if (!activeArtifactId) {
            return undefined;
        }

        return openArtifacts.find(
            (artifact) => artifact.id === activeArtifactId,
        );
    });
    const openArtifactIds = $derived.by(() =>
        openArtifacts.map((artifact) => artifact.id),
    );
    const currentActionTimelineItemId = $derived.by(() => {
        const lastItem = timelineItems.at(-1);
        if (
            !agentExecution ||
            !lastItem ||
            formatExecutionStatus(agentExecution).toLowerCase() === "idle" ||
            lastItem.behavior.class !== "live-activity"
        ) {
            return undefined;
        }

        return lastItem.id;
    });

    function formatActivityLabel(
        activity:
            | AgentExecutionDataType["projection"]["currentActivity"]
            | undefined,
    ): string | undefined {
        switch (activity?.activity) {
            case "awaiting-agent-response":
                return "Waiting for agent response";
            case "communicating":
                return "Waiting for input";
            case "planning":
                return "Initializing";
            case "executing":
                return "Working";
            case "idle":
                return "Idle";
            default:
                return undefined;
        }
    }

    function formatTransportStatus(
        execution: AgentExecutionEntity | undefined,
    ): string | undefined {
        const transportState = execution?.transportState;
        if (!transportState) {
            return undefined;
        }

        switch (transportState.health) {
            case "reconciling":
                return "Recovering";
            case "protocol-incompatible":
            case "detached":
            case "degraded":
            case "orphaned":
                return "Disconnected";
            default:
                break;
        }

        if (
            transportState.degraded ||
            transportState.commandable === false ||
            transportState.signalCompatible === false ||
            transportState.terminalAttached === false ||
            transportState.leaseAttached === false ||
            transportState.ownerMatched === false
        ) {
            return "Disconnected";
        }

        return undefined;
    }

    function formatExecutionStatus(
        execution: AgentExecutionEntity | undefined,
    ): string {
        const transportLabel = formatTransportStatus(execution);
        if (transportLabel) {
            return transportLabel;
        }

        const activityLabel = formatActivityLabel(execution?.currentActivity);
        if (activityLabel) {
            return activityLabel;
        }
        return formatLifecycleLabel(execution?.lifecycleState);
    }

    function executionStatusSummary(
        execution: AgentExecutionEntity | undefined,
    ): string | undefined {
        const transportState = execution?.transportState;
        if (formatTransportStatus(execution)) {
            return (
                transportState?.reason ??
                (transportState?.health === "reconciling"
                    ? "Mission daemon is reconciling this agent execution."
                    : "The runtime connection is no longer healthy. Refresh to launch a new agent execution.")
            );
        }

        return execution?.currentActivity?.summary;
    }

    function activityLineText(
        execution: AgentExecutionEntity | undefined,
    ): string | undefined {
        return (
            executionStatusSummary(execution) ??
            formatExecutionStatus(execution)
        );
    }

    function statusBadgeClasses(
        execution: AgentExecutionEntity | undefined,
    ): string {
        const status = formatExecutionStatus(execution).toLowerCase();

        if (status === "working") {
            return "border-sky-300/25 bg-sky-300/10 text-sky-100";
        }

        if (status === "idle") {
            return "border-white/10 bg-white/[0.05] text-slate-200";
        }

        if (status === "recovering") {
            return "border-amber-300/25 bg-amber-300/10 text-amber-100";
        }

        if (status === "starting" || status === "initializing") {
            return "border-amber-300/25 bg-amber-300/10 text-amber-100";
        }

        if (status === "completed") {
            return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
        }

        if (
            status === "failed" ||
            status === "disconnected" ||
            status === "cancelled" ||
            status === "terminated"
        ) {
            return "border-rose-300/25 bg-rose-300/10 text-rose-100";
        }

        return "border-white/10 bg-white/[0.05] text-slate-200";
    }

    function formatLifecycleLabel(
        lifecycleState: AgentExecutionEntity["lifecycleState"] | undefined,
    ): string {
        switch (lifecycleState) {
            case "starting":
                return "Starting";
            case "running":
                return "Running";
            case "completed":
                return "Completed";
            case "failed":
                return "Failed";
            case "cancelled":
                return "Cancelled";
            case "terminated":
                return "Terminated";
            default:
                return "Pending";
        }
    }

    function itemIcon(item: TimelineItem): string {
        switch (item.primitive) {
            case "conversation.operator-message":
                return "lucide:user-round";
            case "activity.progress":
                if (item.id === currentActionTimelineItemId) {
                    switch (currentActivity?.activity) {
                        case "awaiting-agent-response":
                            return "lucide:radio-tower";
                        case "communicating":
                            return "lucide:message-circle-question";
                        case "planning":
                            return "lucide:sparkles";
                        case "executing":
                            return "lucide:orbit";
                    }
                }

                return "lucide:activity";
            case "artifact.created":
                return "lucide:file-plus-2";
            case "artifact.updated":
                return "lucide:file-pen-line";
            case "artifact.diff":
                return "lucide:file-diff";
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
            return "border-fuchsia-300/25 bg-[linear-gradient(135deg,rgba(255,150,227,0.98),rgba(217,188,255,0.94))] text-slate-950";
        }

        switch (item.severity) {
            case "success":
                return "border-emerald-300/15 bg-emerald-300/[0.08] text-slate-100";
            case "warning":
                return "border-amber-300/18 bg-amber-300/[0.08] text-slate-100";
            case "error":
            case "critical":
                return "border-rose-300/18 bg-rose-300/[0.08] text-slate-100";
        }

        switch (item.primitive) {
            case "activity.progress":
            case "activity.status":
            case "activity.tool":
            case "activity.target":
                return "border-sky-300/15 bg-sky-300/[0.08] text-slate-100";
            case "artifact.created":
            case "artifact.updated":
            case "artifact.diff":
                return "border-amber-300/18 bg-amber-300/[0.08] text-slate-100";
            case "workflow.state-changed":
            case "workflow.event":
                return "border-white/10 bg-white/[0.035] text-slate-100";
            default:
                return "border-white/10 bg-white/[0.035] text-slate-100";
        }
    }

    function itemIconClasses(item: TimelineItem): string {
        if (item.primitive === "conversation.operator-message") {
            return "border border-slate-950/35 bg-slate-950/10 text-slate-950 shadow-[0_0_0_1px_rgba(15,23,42,0.08)]";
        }

        switch (item.severity) {
            case "success":
                return "border border-emerald-300/55 bg-emerald-300/12 text-emerald-100 shadow-[0_0_0_1px_rgba(110,231,183,0.12)]";
            case "warning":
                return "border border-amber-300/55 bg-amber-300/12 text-amber-100 shadow-[0_0_0_1px_rgba(252,211,77,0.12)]";
            case "error":
            case "critical":
                return "border border-rose-300/55 bg-rose-300/12 text-rose-100 shadow-[0_0_0_1px_rgba(253,164,175,0.12)]";
        }

        switch (item.primitive) {
            case "activity.progress":
            case "activity.status":
            case "activity.tool":
            case "activity.target":
                return "border border-sky-300/55 bg-sky-300/12 text-sky-100 shadow-[0_0_0_1px_rgba(125,211,252,0.12)]";
            case "artifact.created":
            case "artifact.updated":
            case "artifact.diff":
                return "border border-amber-300/55 bg-amber-300/12 text-amber-100 shadow-[0_0_0_1px_rgba(252,211,77,0.12)]";
            default:
                return "border border-white/30 bg-white/[0.05] text-slate-200 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]";
        }
    }

    function itemAlignClasses(item: TimelineItem): string {
        if (item.primitive === "conversation.operator-message") {
            return "justify-end";
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

    function handleArtifactSelected(artifact: ArtifactEntity): void {
        if (!openArtifacts.some((candidate) => candidate.id === artifact.id)) {
            openArtifacts = [...openArtifacts, artifact];
        }

        activeArtifactId = artifact.id;
    }

    function handleArtifactClosed(artifactId: string): void {
        const closedArtifactIndex = openArtifacts.findIndex(
            (artifact) => artifact.id === artifactId,
        );
        if (closedArtifactIndex === -1) {
            return;
        }

        const remainingArtifacts = openArtifacts.filter(
            (artifact) => artifact.id !== artifactId,
        );
        openArtifacts = remainingArtifacts;

        if (activeArtifactId !== artifactId) {
            return;
        }

        if (remainingArtifacts.length === 0) {
            activeArtifactId = undefined;
            return;
        }

        const nextArtifactIndex = Math.min(
            closedArtifactIndex,
            remainingArtifacts.length - 1,
        );
        activeArtifactId = remainingArtifacts[nextArtifactIndex]?.id;
    }

    function handleActiveArtifactChanged(artifactId?: string): void {
        activeArtifactId = artifactId?.trim() || undefined;
    }

    async function submitPrompt(event: SubmitEvent): Promise<void> {
        event.preventDefault();

        if (
            !agentExecution ||
            !agentExecution.canSendStructuredPrompt ||
            !isExecutionTransportCommandable(agentExecution)
        ) {
            promptError =
                executionStatusSummary(agentExecution) ??
                "Refresh to launch a new agent execution before sending another prompt.";
            return;
        }

        const text = draft.trim();
        if (!text) {
            promptError = currentInputRequest
                ? "An answer is required."
                : "Prompt text is required.";
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

    function isExecutionTransportCommandable(
        execution: AgentExecutionEntity | undefined,
    ): boolean {
        const transportState = execution?.transportState;
        if (!transportState) {
            return true;
        }

        return !(
            transportState.degraded ||
            transportState.commandable === false ||
            transportState.signalCompatible === false ||
            transportState.terminalAttached === false ||
            transportState.leaseAttached === false ||
            transportState.ownerMatched === false ||
            (transportState.health !== undefined &&
                transportState.health !== "attached")
        );
    }
</script>

{#snippet chatPanel()}
    <div class="flex min-h-0 flex-1 flex-col">
        <Tabs.Root
            bind:value={
                () => activePanel,
                (nextPanel) => {
                    activePanel =
                        nextPanel === "terminal" && !canShowTerminalPanel
                            ? "messages"
                            : nextPanel;
                }
            }
            class="flex min-h-0 flex-1 flex-col overflow-hidden gap-0"
        >
            <div class="w-full">
                <div class="mx-auto w-full max-w-5xl">
                    <Tabs.List
                        class="w-full justify-start overflow-x-auto overflow-y-hidden"
                        variant="line"
                    >
                        <Tabs.Trigger value="messages" class="flex-none">
                            Chat
                        </Tabs.Trigger>

                        <Tabs.Trigger value="journal" class="flex-none">
                            <span>Journal</span>
                            <span class="ml-2 text-xs text-slate-400"
                                >{journalRecords.length}</span
                            >
                        </Tabs.Trigger>

                        {#if canShowTerminalPanel}
                            <Tabs.Trigger
                                value="terminal"
                                class="max-w-48 flex-none"
                                aria-label={`${agentExecution?.adapterLabel ?? "Agent"} terminal`}
                                title={agentExecution?.adapterLabel ?? "Agent"}
                            >
                                <Icon
                                    icon={providerIcon(agentExecution?.agentId)}
                                    class="size-4 shrink-0"
                                />
                                <span class="min-w-0 truncate">
                                    {agentExecution?.adapterLabel ?? "Agent"}
                                </span>
                            </Tabs.Trigger>
                        {/if}
                    </Tabs.List>
                </div>
            </div>

            <Tabs.Content
                value="messages"
                class="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
                <ScrollArea.Root
                    bind:viewportRef={messagesViewport}
                    class="min-h-0 flex-1"
                    scrollbarYClasses="py-2"
                >
                    <div class="min-h-full w-full">
                        <div class="mx-auto min-h-full w-full max-w-5xl">
                            {#if !agentExecution}
                                <div
                                    class="m-4 rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-5 py-8 text-center md:m-6"
                                >
                                    <Icon
                                        icon="lucide:messages-square"
                                        class="mx-auto size-8 text-slate-500"
                                    />
                                    <h3
                                        class="mt-3 text-sm font-medium text-slate-200"
                                    >
                                        {loadingTitle}
                                    </h3>
                                </div>
                            {:else if timelineItems.length === 0}
                                <div
                                    class="flex justify-start px-4 py-4 md:px-6"
                                >
                                    <div
                                        class="max-w-[min(44rem,100%)] rounded-lg border border-white/10 bg-[#12151b] px-4 py-3 text-slate-100 shadow-[inset_3px_0_0_rgb(148_163_184)]"
                                    >
                                        <div
                                            class="flex items-center gap-2 text-sm font-medium text-slate-200"
                                        >
                                            <Icon
                                                icon="lucide:sparkles"
                                                class="size-4"
                                            />
                                            Assistant
                                        </div>
                                        <p
                                            class="mt-2 text-sm leading-6 text-slate-400"
                                        >
                                            {#if currentActivity?.activity === "awaiting-agent-response"}
                                                Waiting for the agent to answer
                                                the current turn.
                                            {:else}
                                                Waiting for the first
                                                AgentExecution timeline item.
                                            {/if}
                                        </p>
                                    </div>
                                </div>
                            {:else if messagesViewport}
                                <div class="space-y-6 px-4 py-4 md:px-6">
                                    <AgentChatMessages
                                        items={timelineItems}
                                        viewport={messagesViewport}
                                        {refreshNonce}
                                        {currentActionTimelineItemId}
                                        {selectedArtifact}
                                        {openArtifactIds}
                                        onSelectArtifact={handleArtifactSelected}
                                        {itemAlignClasses}
                                        {itemToneClasses}
                                        {itemIconClasses}
                                        {itemIcon}
                                        {itemTitle}
                                        {useChoice}
                                    />
                                </div>
                            {/if}
                        </div>
                    </div>
                </ScrollArea.Root>
            </Tabs.Content>

            <Tabs.Content
                value="journal"
                class="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
                <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
                    {#if !agentExecution}
                        <div
                            class="m-4 rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-5 py-8 text-center md:m-6"
                        >
                            <Icon
                                icon="lucide:messages-square"
                                class="mx-auto size-8 text-slate-500"
                            />
                            <h3 class="mt-3 text-sm font-medium text-slate-200">
                                {loadingTitle}
                            </h3>
                        </div>
                    {:else}
                        <AgentChatJournalTable records={journalRecords} />
                    {/if}
                </div>
            </Tabs.Content>

            {#if canShowTerminalPanel}
                <Tabs.Content
                    value="terminal"
                    class="flex min-h-0 flex-1 flex-col overflow-hidden"
                >
                    <div class="flex min-h-0 w-full flex-1 flex-col">
                        <div
                            class="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col"
                        >
                            <AgentExecutionTerminalPanel
                                {refreshNonce}
                                {agentExecution}
                                {onCommandExecuted}
                                panelMode="terminal"
                            />
                        </div>
                    </div>
                </Tabs.Content>
            {/if}
        </Tabs.Root>

        <AgentChatInputBar
            bind:value={draft}
            placeholder={agentExecution
                ? "Message the assistant"
                : loadingPlaceholder}
            activeInputRequest={currentInputRequest}
            disabled={!agentExecution || !canSendPrompt || promptPending}
            pending={promptPending}
            error={promptError}
            onChoiceSelect={useChoice}
            onSubmit={submitPrompt}
        />
    </div>
{/snippet}

<section class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#08090b]">
    {#if showHeader}
        <div
            class="z-20 shrink-0 border-b border-white/10 bg-[#08090b]/95 px-4 pb-3 pt-3 shadow-[0_14px_30px_rgba(0,0,0,0.35)] backdrop-blur md:px-5"
        >
            <div
                class="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
            >
                <div class="flex min-w-0 items-start gap-3">
                    <span
                        class="inline-flex size-10 shrink-0 items-center justify-center text-emerald-200"
                    >
                        <Icon icon="lucide:bot-message-square" class="size-5" />
                    </span>
                    <div class="min-w-0">
                        <h2
                            class="min-w-0 truncate text-xs font-medium leading-5 text-muted-foreground"
                        >
                            {headerTitleText}
                        </h2>
                        {#if headerDetailText}
                            <p class="mt-1 truncate text-xs text-slate-300">
                                {headerDetailText}
                            </p>
                        {/if}
                        {#if activityLineText(agentExecution)}
                            <p
                                class={`mt-1 truncate text-lg font-medium leading-6 ${headerShowsWorkingShine ? "text-muted-foreground" : "text-foreground"}`}
                            >
                                <span
                                    use:shimmerThinking={{
                                        disabled: !headerShowsWorkingShine,
                                        speed: 2.5,
                                    }}
                                >
                                    {activityLineText(agentExecution)}
                                </span>
                            </p>
                        {/if}
                    </div>
                </div>
                <div
                    class="flex shrink-0 flex-wrap items-center justify-end gap-2"
                >
                    {#if agentExecution}
                        <Badge
                            variant="outline"
                            class={`rounded-full px-2.5 py-1 text-[0.65rem] font-medium uppercase tracking-[0.14em] ${statusBadgeClasses(agentExecution)}`}
                        >
                            {formatExecutionStatus(agentExecution)}
                        </Badge>
                    {/if}
                </div>
            </div>
        </div>
    {/if}

    {#if openArtifacts.length > 0}
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
                <Artifacts
                    {refreshNonce}
                    artifacts={openArtifacts}
                    {activeArtifactId}
                    onActiveArtifactChange={handleActiveArtifactChanged}
                    onCloseArtifact={handleArtifactClosed}
                />
            </ResizablePane>
        </ResizablePaneGroup>
    {:else}
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {@render chatPanel()}
        </div>
    {/if}
</section>
