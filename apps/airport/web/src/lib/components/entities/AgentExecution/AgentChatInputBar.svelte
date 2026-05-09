<script lang="ts">
    import Icon from "@iconify/svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Textarea } from "$lib/components/ui/textarea/index.js";

    let {
        value = $bindable(""),
        placeholder,
        disabled = false,
        pending = false,
        error = null,
        onSubmit,
    }: {
        value: string;
        placeholder: string;
        disabled?: boolean;
        pending?: boolean;
        error?: string | null;
        onSubmit: (event: SubmitEvent) => void | Promise<void>;
    } = $props();

    let formElement = $state<HTMLFormElement | null>(null);

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
</script>

<form
    bind:this={formElement}
    class="border-t border-white/10 bg-[#08090b]/95 px-4 py-3 backdrop-blur md:px-5"
    onsubmit={onSubmit}
>
    <div class="mx-auto max-w-4xl">
        <div
            class="flex items-end gap-2 rounded-lg border border-white/12 bg-[#111318] p-2 shadow-[0_18px_50px_rgba(0,0,0,0.28)] transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20"
        >
            <div
                class="mb-1.5 hidden size-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-slate-400 sm:inline-flex"
            >
                <Icon icon="lucide:sparkles" class="size-4" />
            </div>
            <Textarea
                bind:value
                rows={2}
                class="max-h-36 min-h-12 resize-none border-0 bg-transparent px-2 py-2 text-sm leading-6 text-slate-100 shadow-none placeholder:text-slate-500 focus-visible:ring-0 disabled:opacity-60"
                {placeholder}
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
        {#if error}
            <p class="mt-2 text-sm text-rose-300">{error}</p>
        {/if}
    </div>
</form>
