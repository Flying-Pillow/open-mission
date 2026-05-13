<script lang="ts">
    import type { RepositoryCodeIntelligenceIndexType } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import Icon from "@iconify/svelte";
    import CodeIntelligenceGraph from "$lib/components/entities/CodeIntelligence/CodeIntelligenceGraph.svelte";
    import { Button } from "$lib/components/ui/button/index.js";

    type CodeIntelligenceRepository = {
        codeIntelligenceIndex: RepositoryCodeIntelligenceIndexType;
        codeIntelligenceIndexLoading: boolean;
        codeIntelligenceIndexError?: string;
        refreshCodeIntelligenceIndex: () => Promise<unknown>;
    };

    let { repository }: { repository?: CodeIntelligenceRepository } = $props();

    const index = $derived<RepositoryCodeIntelligenceIndexType>(
        repository?.codeIntelligenceIndex ?? null,
    );
    const loading = $derived(Boolean(repository?.codeIntelligenceIndexLoading));
    const error = $derived(repository?.codeIntelligenceIndexError);

    async function refreshIndex(): Promise<void> {
        if (!repository) {
            return;
        }
        await repository.refreshCodeIntelligenceIndex().catch(() => undefined);
    }
</script>

<aside class="flex h-full min-h-0 w-full flex-col overflow-hidden bg-card">
    <header class="border-b bg-muted/20 px-4 py-3">
        <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
                <div class="flex items-center gap-2 text-muted-foreground">
                    <Icon icon="lucide:database" class="size-4" />
                    <p class="text-xs font-medium uppercase tracking-[0.16em]">
                        Code Intelligence
                    </p>
                </div>
                <h2 class="mt-2 truncate text-sm font-semibold text-foreground">
                    Knowledge graph
                </h2>
            </div>
            <Button
                variant="ghost"
                size="icon-sm"
                title="Refresh code intelligence index"
                aria-label="Refresh code intelligence index"
                disabled={loading || !repository}
                onclick={() => void refreshIndex()}
            >
                <Icon
                    icon="lucide:refresh-cw"
                    class={loading ? "size-4 animate-spin" : "size-4"}
                />
            </Button>
        </div>
    </header>

    {#if loading && !index}
        <div class="px-4 py-6 text-sm text-muted-foreground">
            Loading code intelligence index...
        </div>
    {:else if error}
        <div class="px-4 py-6 text-sm text-destructive">
            {error}
        </div>
    {:else if !index}
        <div class="px-4 py-6 text-sm leading-6 text-muted-foreground">
            No active code intelligence index is available for this repository.
        </div>
    {:else}
        <div class="min-h-0 min-w-1 flex-1 overflow-hidden">
            <CodeIntelligenceGraph {index} />
        </div>
    {/if}
</aside>
