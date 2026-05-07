<script lang="ts">
    import Icon from "@iconify/svelte";
    import { Checkbox } from "$lib/components/ui/checkbox/index.js";
    import { cn } from "$lib/utils.js";
    import type { TreeViewFileProps } from "./types.js";

    let {
        ref = $bindable(null),
        name,
        icon,
        checked = false,
        onCheckedChange,
        type = "button",
        class: className,
        ...restProps
    }: TreeViewFileProps = $props();
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
    {#if onCheckedChange}
        <div class="flex w-6 shrink-0 items-start justify-center pt-0.5">
            <Checkbox
                class="border-muted-foreground"
                {checked}
                onpointerdown={(event: PointerEvent) => event.stopPropagation()}
                onclick={(event: MouseEvent) => event.stopPropagation()}
                onkeydown={(event: KeyboardEvent) => event.stopPropagation()}
                onCheckedChange={(value: boolean | "indeterminate") =>
                    onCheckedChange?.(value === true)}
                aria-label={`Select file ${name}`}
            />
        </div>
    {/if}
    {#if icon}
        {@render icon({ name })}
    {:else}
        <Icon icon="lucide:file" class="size-4" />
    {/if}
    <span class="min-w-0 flex-1 break-words text-left">{name}</span>
</button>
