<script lang="ts">
    import FolderIcon from "@tabler/icons-svelte/icons/folder";
    import FolderOpenIcon from "@tabler/icons-svelte/icons/folder-open";
    import { Checkbox } from "$lib/components/ui/checkbox/index.js";
    import * as Collapsible from "$lib/components/ui/collapsible/index.js";
    import { cn } from "$lib/utils.js";
    import type { TreeViewFolderProps } from "./types.js";

    let {
        name,
        open = $bindable(true),
        class: className,
        style,
        icon,
        actions,
        checked = false,
        onCheckedChange,
        onclick,
        oncontextmenu,
        ondragenter,
        ondragover,
        ondragleave,
        ondrop,
        children,
    }: TreeViewFolderProps = $props();
</script>

<Collapsible.Root bind:open>
    <div
        class={cn(
            "flex w-full min-w-0 cursor-pointer items-center gap-1 px-1 py-0.5 **:cursor-pointer",
            className,
        )}
        {style}
        role="group"
        {ondragenter}
        {ondragover}
        {ondragleave}
        {ondrop}
    >
        {#if onCheckedChange}
            <div class="flex w-6 shrink-0 items-center justify-center">
                <Checkbox
                    class="border-muted-foreground"
                    {checked}
                    onpointerdown={(event: PointerEvent) =>
                        event.stopPropagation()}
                    onclick={(event: MouseEvent) => event.stopPropagation()}
                    onkeydown={(event: KeyboardEvent) =>
                        event.stopPropagation()}
                    onCheckedChange={(value: boolean | "indeterminate") =>
                        onCheckedChange?.(value === true)}
                    aria-label={`Select folder ${name}`}
                />
            </div>
        {/if}
        <div class="flex min-w-0 flex-1 items-center">
            <Collapsible.Trigger
                {onclick}
                {oncontextmenu}
                class="flex min-w-0 flex-1 cursor-pointer place-items-center gap-2"
            >
                {#if icon}
                    {@render icon({ name, open })}
                {:else if open}
                    <FolderOpenIcon class="size-5 flex-none" />
                {:else}
                    <FolderIcon class="size-5 flex-none" />
                {/if}
                <span class="min-w-0 flex-1 truncate text-left">{name}</span>
            </Collapsible.Trigger>
            {#if actions}
                <div class="ml-auto shrink-0">
                    {@render actions()}
                </div>
            {/if}
        </div>
    </div>
    <Collapsible.Content class="overflow-hidden">
        <div class="relative flex min-w-0 place-items-start">
            <div class="relative w-6 shrink-0">
                <div
                    class="bg-border absolute top-0 left-1/2 h-full w-px -translate-x-1/2"
                ></div>
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-1 pl-1">
                {@render children?.()}
            </div>
        </div>
    </Collapsible.Content>
</Collapsible.Root>
