<script lang="ts">
    import Icon from "@iconify/svelte";
    import type { AgentExecution as AgentExecutionEntity } from "$lib/components/entities/AgentExecution/AgentExecution.svelte.js";
    import AgentExecutionTerminalPanel from "$lib/components/entities/AgentExecution/AgentExecution.svelte";
    import AgentExecutionCommandbar from "$lib/components/entities/AgentExecution/AgentExecutionCommandbar.svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
    import { Textarea } from "$lib/components/ui/textarea/index.js";

    let {
        agentExecution,
        refreshNonce,
        onCommandExecuted,
    }: {
        agentExecution?: AgentExecutionEntity;
        refreshNonce: number;
        onCommandExecuted: () => Promise<void>;
    } = $props();

    let draft = $state("");
    let promptPending = $state(false);
    let promptError = $state<string | null>(null);
    let showTerminalPanel = $state(false);

    const canSendPrompt = $derived(
        Boolean(agentExecution?.canSendStructuredPrompt),
    );
    const canShowTerminalPanel = $derived(
        Boolean(agentExecution?.isTerminalBacked()),
    );
    const chatMessages = $derived.by(() => {
        refreshNonce;
        return agentExecution?.chatMessages ?? [];
    });

    $effect(() => {
        if (!canShowTerminalPanel) {
            showTerminalPanel = false;
        }
    });

    async function submitPrompt(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        const text = draft.trim();
        if (!text || !agentExecution || !canSendPrompt || promptPending) {
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
        } catch {
            promptError = "Your message could not be sent. Please try again.";
        } finally {
            promptPending = false;
        }
    }

    function useChoice(value: string): void {
        draft = value;
    }

    function messageIcon(kind: string): string {
        switch (kind) {
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

    function messageToneClasses(tone: string): string {
        switch (tone) {
            case "progress":
                return "border-sky-200 bg-sky-50 text-sky-950";
            case "attention":
                return "border-amber-200 bg-amber-50 text-amber-950";
            case "success":
                return "border-emerald-200 bg-emerald-50 text-emerald-950";
            case "danger":
                return "border-rose-200 bg-rose-50 text-rose-950";
            case "muted":
                return "border-muted bg-muted/40 text-muted-foreground";
            default:
                return "border-border bg-card text-card-foreground";
        }
    }

    function messageAlignClasses(role: string): string {
        return role === "operator" ? "justify-end" : "justify-start";
    }

    function messageBubbleClasses(role: string, tone: string): string {
        if (role === "operator") {
            return "border-primary/20 bg-primary text-primary-foreground";
        }
        return messageToneClasses(tone);
    }
</script>

<section
    class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:flex-row"
>
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div class="border-b bg-muted/15 px-4 py-4 md:px-5">
            <div class="flex min-w-0 items-start justify-between gap-4">
                <div class="flex min-w-0 items-start gap-3">
                    <span
                        class="inline-flex size-10 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground"
                    >
                        <Icon icon="lucide:bot-message-square" class="size-5" />
                    </span>
                    <div class="min-w-0">
                        <h2
                            class="min-w-0 truncate text-lg font-semibold leading-6 text-foreground"
                        >
                            Setup chat
                        </h2>
                    </div>
                </div>
                <Button
                    type="button"
                    variant={showTerminalPanel ? "secondary" : "outline"}
                    size="icon"
                    disabled={!canShowTerminalPanel}
                    aria-label={showTerminalPanel
                        ? "Hide AgentExecution terminal"
                        : "Show AgentExecution terminal"}
                    title={showTerminalPanel
                        ? "Hide AgentExecution terminal"
                        : canShowTerminalPanel
                          ? "Show AgentExecution terminal"
                          : "AgentExecution terminal is not available"}
                    onclick={() => {
                        showTerminalPanel = !showTerminalPanel;
                    }}
                >
                    <Icon
                        icon={showTerminalPanel
                            ? "lucide:panel-right-close"
                            : "lucide:square-terminal"}
                        class="size-4"
                    />
                </Button>
            </div>
        </div>

        <ScrollArea.Root class="min-h-0 flex-1" scrollbarYClasses="py-2">
            <div class="mx-auto grid w-full max-w-4xl gap-4 px-4 py-5 md:px-6">
                {#if !agentExecution}
                    <div
                        class="rounded-lg border border-dashed bg-muted/20 px-5 py-8 text-center"
                    >
                        <Icon
                            icon="lucide:messages-square"
                            class="mx-auto size-8 text-muted-foreground"
                        />
                        <h3 class="mt-3 text-sm font-medium text-foreground">
                            Starting setup chat
                        </h3>
                    </div>
                {:else if chatMessages.length === 0}
                    <div class="flex justify-start">
                        <div
                            class="max-w-[min(44rem,92%)] rounded-lg border bg-card px-4 py-3 text-card-foreground shadow-sm"
                        >
                            <div
                                class="flex items-center gap-2 text-sm font-medium"
                            >
                                <Icon icon="lucide:sparkles" class="size-4" />
                                Assistant
                            </div>
                            <p
                                class="mt-2 text-sm leading-6 text-muted-foreground"
                            >
                                Waiting for the first AgentExecution signal.
                            </p>
                        </div>
                    </div>
                {:else}
                    {#each chatMessages as message (message.id)}
                        <div
                            class={`flex ${messageAlignClasses(message.role)}`}
                        >
                            <article
                                class={`max-w-[min(44rem,92%)] rounded-lg border px-4 py-3 shadow-sm ${messageBubbleClasses(message.role, message.tone)}`}
                            >
                                <div
                                    class="flex items-center gap-2 text-sm font-medium"
                                >
                                    <Icon
                                        icon={messageIcon(message.kind)}
                                        class="size-4"
                                    />
                                    <span>
                                        {message.role === "operator"
                                            ? "You"
                                            : (message.title ?? "Assistant")}
                                    </span>
                                </div>
                                <p
                                    class="mt-2 whitespace-pre-wrap text-sm leading-6"
                                >
                                    {message.text}
                                </p>
                                {#if message.detail}
                                    <p
                                        class="mt-2 whitespace-pre-wrap text-xs leading-5 opacity-80"
                                    >
                                        {message.detail}
                                    </p>
                                {/if}
                                {#if message.choices?.length}
                                    <div class="mt-3 flex flex-wrap gap-2">
                                        {#each message.choices as choice (`${message.id}:${choice.kind}:${choice.label}`)}
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                class="bg-background/70"
                                                onclick={() =>
                                                    useChoice(
                                                        choice.kind === "fixed"
                                                            ? choice.value
                                                            : "",
                                                    )}
                                            >
                                                {choice.label}
                                            </Button>
                                        {/each}
                                    </div>
                                {/if}
                            </article>
                        </div>
                    {/each}
                {/if}
            </div>
        </ScrollArea.Root>

        <div class="border-t bg-background/95 px-4 py-3 md:px-5">
            <AgentExecutionCommandbar
                {refreshNonce}
                session={agentExecution}
                {onCommandExecuted}
            />
        </div>

        <form class="px-4 py-4 md:px-5" onsubmit={submitPrompt}>
            <div
                class="mx-auto flex max-w-4xl items-end gap-2 rounded-lg border bg-card p-2 shadow-sm"
            >
                <Textarea
                    bind:value={draft}
                    rows={2}
                    class="max-h-32 min-h-12 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
                    placeholder={agentExecution
                        ? "Message the assistant"
                        : "Starting setup chat"}
                    disabled={!agentExecution ||
                        !canSendPrompt ||
                        promptPending}
                />
                <Button
                    type="submit"
                    size="icon"
                    class="mb-0.5 shrink-0"
                    disabled={!draft.trim() ||
                        !agentExecution ||
                        !canSendPrompt ||
                        promptPending}
                    aria-label="Send message"
                    title="Send message"
                >
                    <Icon icon="lucide:send-horizontal" class="size-4" />
                </Button>
            </div>
            {#if promptError}
                <p class="mx-auto mt-2 max-w-4xl text-sm text-rose-600">
                    {promptError}
                </p>
            {/if}
        </form>
    </div>

    {#if showTerminalPanel}
        <aside
            class="flex min-h-80 min-w-0 flex-1 flex-col border-t bg-background lg:min-h-0 lg:border-l lg:border-t-0"
        >
            <div
                class="flex h-[4.5625rem] shrink-0 items-center justify-between border-b bg-muted/15 px-4"
            >
                <div class="min-w-0">
                    <h3 class="truncate text-sm font-semibold text-foreground">
                        AgentExecution terminal
                    </h3>
                    <p class="truncate text-xs text-muted-foreground">
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
