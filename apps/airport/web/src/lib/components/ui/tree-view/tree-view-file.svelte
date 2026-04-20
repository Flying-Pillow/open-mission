<script lang="ts">
    import FileIcon from "@tabler/icons-svelte/icons/file";
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
    class={cn("flex place-items-center gap-1", className)}
    {...restProps}
>
    {#if icon}
        {@render icon({ name })}
    {:else}
        <FileIcon class="size-4" />
    {/if}
    <span>{name}</span>
</button>
