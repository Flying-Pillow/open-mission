<script lang="ts">
    import { Badge } from "$lib/components/ui/badge/index.js";
    import type { Repository } from "$lib/components/entities/Repository/Repository.svelte.js";

    let {
        repository,
    }: {
        repository?: Repository;
    } = $props();

    const status = $derived(repository?.syncStatus);
    const hasLocalChanges = $derived(
        (status?.worktree.stagedCount ?? 0) > 0 ||
            (status?.worktree.unstagedCount ?? 0) > 0 ||
            (status?.worktree.untrackedCount ?? 0) > 0,
    );
    const externalLabel = $derived.by(() => {
        if (!status) {
            return "Sync unknown";
        }
        switch (status.external.status) {
            case "up-to-date":
                return "Up to date";
            case "behind":
                return `${status.external.behindCount} behind`;
            case "ahead":
                return `${status.external.aheadCount} ahead`;
            case "diverged":
                return `${status.external.aheadCount} ahead / ${status.external.behindCount} behind`;
            case "untracked":
                return "No tracking branch";
            case "unavailable":
                return "External unavailable";
        }
    });
    const externalBadgeVariant = $derived(
        status?.external.status === "up-to-date" ? "secondary" : "destructive",
    );
    const externalBadgeClass = $derived(
        status?.external.status === "behind"
            ? "border-amber-500/70 bg-amber-500/15 text-amber-700 dark:text-amber-300"
            : undefined,
    );
</script>

<div class="mt-2 flex flex-wrap gap-2">
    <Badge variant={externalBadgeVariant} class={externalBadgeClass}
        >{externalLabel}</Badge
    >
    {#if hasLocalChanges}
        <Badge variant="destructive">Local changes</Badge>
    {:else if status}
        <Badge variant="secondary">Clean</Badge>
    {/if}
</div>
