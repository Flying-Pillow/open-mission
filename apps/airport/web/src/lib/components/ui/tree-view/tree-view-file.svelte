<script lang="ts">
    import Icon from "@iconify/svelte";
    import type { Snippet } from "svelte";
    import type { HTMLButtonAttributes } from "svelte/elements";
    import { cn } from "$lib/utils.js";

    let {
        ref = $bindable(null),
        name,
        icon,
        type = "button",
        class: className,
        ...restProps
    }: HTMLButtonAttributes & {
        ref?: HTMLButtonElement | null;
        name: string;
        icon?: Snippet<[{ name: string }]>;
    } = $props();
</script>

<button
    bind:this={ref}
    {type}
    class={cn(
        "flex min-w-0 items-start justify-start gap-1 text-left",
        className,
    )}
    {...restProps}
>
    {#if icon}
        {@render icon({ name })}
    {:else}
        <Icon icon="lucide:file" class="size-4" />
    {/if}
    <span class="min-w-0 flex-1 break-words text-left">{name}</span>
</button>
