<script lang="ts">
    import Icon from "@iconify/svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Input } from "$lib/components/ui/input/index.js";
    import { Textarea } from "$lib/components/ui/textarea/index.js";
    import type { AgentExecutionDataType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";

    type AttentionProjection =
        AgentExecutionDataType["projection"]["currentAttention"];
    type InputChoice = NonNullable<
        NonNullable<AttentionProjection>["choices"]
    >[number];

    let {
        value = $bindable(""),
        placeholder,
        activeInputRequest,
        disabled = false,
        pending = false,
        error = null,
        onChoiceSelect,
        onSubmit,
    }: {
        value: string;
        placeholder: string;
        activeInputRequest?: AttentionProjection;
        disabled?: boolean;
        pending?: boolean;
        error?: string | null;
        onChoiceSelect?: (value: string) => void | Promise<void>;
        onSubmit: (event: SubmitEvent) => void | Promise<void>;
    } = $props();

    let formElement = $state<HTMLFormElement | null>(null);

    const fixedChoices = $derived.by(() =>
        (activeInputRequest?.choices ?? []).filter(
            (choice): choice is Extract<InputChoice, { kind: "fixed" }> =>
                choice.kind === "fixed",
        ),
    );
    const manualChoice = $derived.by(() =>
        (activeInputRequest?.choices ?? []).find(
            (choice): choice is Extract<InputChoice, { kind: "manual" }> =>
                choice.kind === "manual",
        ),
    );
    const question = $derived(
        activeInputRequest?.text ?? activeInputRequest?.title ?? "",
    );
    const detail = $derived(activeInputRequest?.detail);
    const isInputRequest = $derived(
        activeInputRequest?.primitive === "attention.input-request",
    );
    const resolvedPlaceholder = $derived(
        isInputRequest
            ? (manualChoice?.placeholder ?? "Type your answer")
            : placeholder,
    );
    const trimmedValue = $derived(value.trim());
    const canSubmit = $derived(Boolean(trimmedValue) && !disabled && !pending);

    function handleKeydown(event: KeyboardEvent): void {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
            return;
        }

        event.preventDefault();
        if (canSubmit) {
            formElement?.requestSubmit();
        }
    }

    async function handleChoiceSelect(value: string): Promise<void> {
        await onChoiceSelect?.(value);
    }
</script>

<form
    bind:this={formElement}
    class="border-t border-white/10 bg-[#08090b]/95 px-4 py-3 backdrop-blur md:px-5"
    onsubmit={onSubmit}
>
    <div class="mx-auto w-full max-w-5xl">
        <div
            class={`border p-2 shadow-[0_18px_50px_rgba(0,0,0,0.28)] transition-colors ${
                isInputRequest
                    ? "border-primary/30 bg-primary/10"
                    : "border-white/12 bg-[#111318] focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20"
            }`}
        >
            {#if isInputRequest}
                <div class="space-y-3 p-1">
                    <div
                        class="flex items-start gap-3 border border-primary/20 bg-black/20 px-3 py-3"
                    >
                        <span
                            class="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center border border-primary/25 bg-primary/10 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]"
                        >
                            <Icon
                                icon="lucide:message-circle-question"
                                class="size-4.5"
                            />
                        </span>
                        <div class="min-w-0 flex-1">
                            <p
                                class="text-primary/70 text-[0.68rem] font-semibold uppercase tracking-[0.18em]"
                            >
                                Awaiting your input
                            </p>
                            <p
                                class="mt-1 text-base font-semibold leading-6 text-slate-50"
                            >
                                {question}
                            </p>
                            {#if detail}
                                <p
                                    class="mt-1 text-sm leading-6 text-slate-400"
                                >
                                    {detail}
                                </p>
                            {/if}
                        </div>
                    </div>

                    {#if fixedChoices.length}
                        <div class="space-y-2">
                            {#each fixedChoices as choice (`fixed:${choice.value}`)}
                                <Button
                                    type="button"
                                    variant="secondary"
                                    class="h-auto w-full justify-start rounded-none border border-primary/20 bg-black/20 px-4 py-3 text-left text-slate-100 hover:bg-primary/10"
                                    disabled={disabled || pending}
                                    onclick={() =>
                                        handleChoiceSelect(choice.value)}
                                >
                                    <span
                                        class="flex min-w-0 flex-col items-start gap-1"
                                    >
                                        <span
                                            class="text-sm font-medium leading-5"
                                        >
                                            {choice.label}
                                        </span>
                                        <span
                                            class="text-xs leading-4 text-slate-400"
                                        >
                                            Choose this response
                                        </span>
                                    </span>
                                </Button>
                            {/each}
                        </div>
                    {/if}

                    <div class="border border-primary/20 bg-black/20 p-2">
                        <div
                            class="mb-2 flex items-center justify-between px-2"
                        >
                            <p
                                class="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-slate-400"
                            >
                                {manualChoice?.label ?? "Custom answer"}
                            </p>
                            <p class="text-[0.7rem] text-slate-500">
                                Enter to send
                            </p>
                        </div>
                        <div
                            class="flex flex-col gap-2 sm:flex-row sm:items-center"
                        >
                            <Input
                                bind:value
                                class="h-11 rounded-none border-primary/20 bg-white/[0.04] px-4 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:border-primary/40 focus-visible:ring-primary/15"
                                placeholder={resolvedPlaceholder}
                                {disabled}
                                onkeydown={handleKeydown}
                            />
                            <Button
                                type="submit"
                                size="sm"
                                class="h-11 rounded-none bg-primary px-4 text-primary-foreground hover:bg-primary/85"
                                disabled={!canSubmit}
                                aria-label="Send answer"
                                title="Send answer"
                            >
                                <Icon
                                    icon={pending
                                        ? "lucide:loader-circle"
                                        : "lucide:send-horizontal"}
                                    class={`mr-2 size-4 ${pending ? "animate-spin" : ""}`}
                                />
                                Send answer
                            </Button>
                        </div>
                    </div>
                </div>
            {:else}
                <div class="flex items-end gap-2">
                    <div
                        class="mb-1.5 hidden size-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-slate-400 sm:inline-flex"
                    >
                        <Icon icon="lucide:sparkles" class="size-4" />
                    </div>
                    <Textarea
                        bind:value
                        rows={2}
                        class="max-h-36 min-h-12 resize-none border-0 bg-transparent px-2 py-2 text-sm leading-6 text-slate-100 shadow-none placeholder:text-slate-500 focus-visible:ring-0 disabled:opacity-60"
                        placeholder={resolvedPlaceholder}
                        {disabled}
                        onkeydown={handleKeydown}
                    />
                    <Button
                        type="submit"
                        size="icon"
                        class="mb-1 size-9 shrink-0 rounded-md bg-primary text-primary-foreground shadow-none hover:bg-primary/85"
                        disabled={!canSubmit}
                        aria-label="Send message"
                        title="Send message"
                    >
                        <Icon
                            icon={pending
                                ? "lucide:loader-circle"
                                : "lucide:send-horizontal"}
                            class={`size-4 ${pending ? "animate-spin" : ""}`}
                        />
                    </Button>
                </div>
            {/if}
        </div>
        {#if error}
            <p class="mt-2 text-sm text-rose-300">{error}</p>
        {/if}
    </div>
</form>
