<script lang="ts">
    import { getScopedMissionContext } from "$lib/client/context/scoped-mission-context.svelte.js";
    import MissionFileTreeNodes from "$lib/components/entities/Mission/MissionFileTreeNodes.svelte";
    import * as TreeView from "$lib/components/ui/tree-view/index.js";
    import { cn } from "$lib/utils.js";
    import type {
        MissionFileTreeNode,
        MissionFileTreeResponse,
    } from "$lib/types/mission-file-tree";

    let {
        activePath,
        refreshNonce = 0,
        title = "Worktree files",
        class: className,
        onSelectPath,
    }: {
        activePath?: string;
        refreshNonce?: number;
        title?: string;
        class?: string;
        onSelectPath?: (node: MissionFileTreeNode) => void;
    } = $props();
    const missionScope = getScopedMissionContext();

    let branchOverrides = $state<Record<string, boolean>>({});
    let tree = $state<MissionFileTreeNode[]>([]);
    let rootPath = $state<string | undefined>(undefined);
    let error = $state<string | null>(null);
    let loading = $state(true);
    let requestVersion = 0;
    const mission = $derived(missionScope.mission);
    const missionId = $derived(mission?.missionId ?? "");
    const repositoryRootPath = $derived(mission?.missionWorktreePath ?? "");

    $effect(() => {
        const normalizedMissionId = missionId?.trim();
        const normalizedRepositoryRootPath = repositoryRootPath?.trim();
        refreshNonce;

        if (!normalizedMissionId || !normalizedRepositoryRootPath) {
            tree = [];
            rootPath = undefined;
            error = null;
            loading = false;
            return;
        }

        const currentVersion = ++requestVersion;
        loading = true;
        error = null;

        void (async () => {
            try {
                if (!mission) {
                    throw new Error(
                        "Mission worktree is unavailable until the app context is synchronized.",
                    );
                }

                const payload: MissionFileTreeResponse =
                    await mission.getWorktree();
                if (currentVersion !== requestVersion) {
                    return;
                }

                tree = payload.tree;
                rootPath = payload.rootPath;
            } catch (loadError) {
                if (currentVersion !== requestVersion) {
                    return;
                }

                error =
                    loadError instanceof Error
                        ? loadError.message
                        : String(loadError);
                tree = [];
                rootPath = undefined;
            } finally {
                if (currentVersion === requestVersion) {
                    loading = false;
                }
            }
        })();
    });
</script>

<section
    class={cn(
        "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border bg-card/70 backdrop-blur-sm",
        className,
    )}
>
    <header class="space-y-1 border-b px-3 py-2">
        <h2 class="text-sm font-semibold text-foreground">{title}</h2>
        <p class="truncate text-xs text-muted-foreground">
            {rootPath ?? repositoryRootPath}
        </p>
    </header>

    <div class="min-h-0 overflow-auto p-2">
        {#if loading}
            <div
                class="rounded-xl border border-dashed bg-background/60 px-4 py-8 text-sm text-muted-foreground"
            >
                Loading worktree files...
            </div>
        {:else if error}
            <div
                class="rounded-xl border border-dashed bg-background/60 px-4 py-8 text-sm text-rose-600"
            >
                {error}
            </div>
        {:else if tree.length === 0}
            <div
                class="rounded-xl border border-dashed bg-background/60 px-4 py-8 text-sm text-muted-foreground"
            >
                No files found in this mission worktree.
            </div>
        {:else}
            <TreeView.Root class="gap-1">
                <MissionFileTreeNodes
                    nodes={tree}
                    {activePath}
                    {branchOverrides}
                    {onSelectPath}
                />
            </TreeView.Root>
        {/if}
    </div>
</section>
