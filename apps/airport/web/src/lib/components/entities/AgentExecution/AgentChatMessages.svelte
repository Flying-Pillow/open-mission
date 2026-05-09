<script lang="ts">
    import { untrack } from "svelte";
    import Icon from "@iconify/svelte";
    import { createVirtualizer } from "@tanstack/svelte-virtual";
    import { Button } from "$lib/components/ui/button/index.js";
    import type { AgentExecutionDataType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";

    type ChatMessage = AgentExecutionDataType["chatMessages"][number];

    let {
        messages,
        viewport,
        messageAlignClasses,
        messageToneClasses,
        messageIconClasses,
        messageIcon,
        messageTitle,
        useChoice,
    }: {
        messages: ChatMessage[];
        viewport: HTMLElement;
        messageAlignClasses: (message: ChatMessage) => string;
        messageToneClasses: (message: ChatMessage) => string;
        messageIconClasses: (message: ChatMessage) => string;
        messageIcon: (message: ChatMessage) => string;
        messageTitle: (message: ChatMessage) => string;
        useChoice: (value: string) => Promise<void>;
    } = $props();

    const initialMessageCount = untrack(() => messages.length);
    const messageVirtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
        count: initialMessageCount,
        getScrollElement: () => viewport,
        estimateSize: () => 128,
        getItemKey: (index) => messages[index]?.id ?? index,
        overscan: 6,
    });

    function measureMessageElement(node: HTMLDivElement): {
        update: () => void;
    } {
        $messageVirtualizer.measureElement(node);

        return {
            update: () => {
                $messageVirtualizer.measureElement(node);
            },
        };
    }
</script>

<div
    class="relative w-full"
    style={`height: ${$messageVirtualizer.getTotalSize()}px;`}
>
    {#each $messageVirtualizer.getVirtualItems() as virtualMessage (virtualMessage.key)}
        {@const message = messages[virtualMessage.index]}
        <div
            data-index={virtualMessage.index}
            class="absolute left-0 top-0 w-full pb-4"
            style={`transform: translateY(${virtualMessage.start}px);`}
            use:measureMessageElement
        >
            {#if message}
                <div class={`flex ${messageAlignClasses(message)}`}>
                    <article
                        class={`w-4/5 rounded-lg border px-4 py-3 ${messageToneClasses(message)}`}
                    >
                        <div
                            class="flex items-center gap-2 text-sm font-semibold"
                        >
                            <span
                                class={`inline-flex size-7 shrink-0 items-center justify-center rounded-md border ${messageIconClasses(message)}`}
                            >
                                <Icon
                                    icon={messageIcon(message)}
                                    class="size-4"
                                />
                            </span>
                            <span>
                                {messageTitle(message)}
                            </span>
                        </div>
                        <p
                            class="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-100"
                        >
                            {message.text}
                        </p>
                        {#if message.detail}
                            <p
                                class="mt-3 whitespace-pre-wrap border-t border-white/10 pt-3 text-xs leading-5 text-slate-300"
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
                                        class="rounded-md border-white/15 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]"
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
            {/if}
        </div>
    {/each}
</div>
