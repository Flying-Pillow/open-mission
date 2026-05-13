<script lang="ts">
    import Icon from "@iconify/svelte";
    import MissionFileTreeNodes from "$lib/components/entities/Mission/MissionFileTreeNodes.svelte";
    import * as TreeView from "$lib/components/ui/tree-view/index.js";
    import { cn } from "$lib/utils.js";
    import type { MissionFileTreeNode } from "$lib/types/mission-file-tree";

    let {
        nodes,
        activePath,
        branchOverrides,
        onSelectPath,
    }: {
        nodes: MissionFileTreeNode[];
        activePath?: string;
        branchOverrides: Record<string, boolean>;
        onSelectPath?: (node: MissionFileTreeNode) => void;
    } = $props();

    function fileItemClass(selected: boolean): string {
        return cn(
            "w-full justify-start rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent/50",
            selected && "bg-accent/70 ring-border/60 ring-1 hover:bg-accent",
        );
    }

    function folderItemClass(selected: boolean): string {
        return cn(
            "rounded-md px-1.5 py-1 text-sm text-foreground transition-colors hover:bg-accent/50",
            selected && "bg-accent/70 ring-border/60 ring-1 hover:bg-accent",
        );
    }

    function isBranchOpen(node: MissionFileTreeNode): boolean {
        const defaultOpen = node.relativePath.split("/").length <= 1;
        return branchOverrides[node.relativePath] ?? defaultOpen;
    }

    function setBranchOpen(node: MissionFileTreeNode, open: boolean): void {
        branchOverrides[node.relativePath] = open;
    }

    function isSelected(node: MissionFileTreeNode): boolean {
        return (
            activePath === node.absolutePath || activePath === node.relativePath
        );
    }

    function selectNode(node: MissionFileTreeNode): void {
        onSelectPath?.(node);
    }
</script>

{#each nodes as node (node.relativePath)}
    {#if node.kind === "directory"}
        <TreeView.Folder
            name={node.name}
            class={folderItemClass(isSelected(node))}
            onclick={() => selectNode(node)}
            bind:open={
                () => isBranchOpen(node), (open) => setBranchOpen(node, open)
            }
        >
            {#snippet icon({ open })}
                {#if open}
                    <Icon
                        icon="lucide:folder-open"
                        class="size-4 shrink-0 text-muted-foreground"
                    />
                {:else}
                    <Icon
                        icon="lucide:folder"
                        class="size-4 shrink-0 text-muted-foreground"
                    />
                {/if}
            {/snippet}
            {#if node.children}
                <MissionFileTreeNodes
                    nodes={node.children}
                    {activePath}
                    {branchOverrides}
                    {onSelectPath}
                />
            {/if}
        </TreeView.Folder>
    {:else}
        <TreeView.File
            name={node.name}
            class={fileItemClass(isSelected(node))}
            onclick={() => selectNode(node)}
        >
            {#snippet icon()}
                <Icon
                    icon="lucide:file"
                    class="size-4 shrink-0 text-muted-foreground"
                />
            {/snippet}
        </TreeView.File>
    {/if}
{/each}
