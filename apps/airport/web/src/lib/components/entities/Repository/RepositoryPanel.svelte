<script lang="ts">
    import type { Snippet } from "svelte";
    import { goto } from "$app/navigation";
    import Icon from "@iconify/svelte";
    import type { AirportRepositoryListItem } from "$lib/components/entities/types";
    import type { Repository } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import RepositoryCommandbar from "$lib/components/entities/Repository/RepositoryCommandbar.svelte";
    import { cn } from "$lib/utils.js";

    let {
        repository,
        localRepository,
        onCommandExecuted,
        interactive = false,
        compact = false,
        class: className,
        leadingAction,
    }: {
        repository: AirportRepositoryListItem;
        localRepository?: Repository;
        onCommandExecuted: () => Promise<void>;
        interactive?: boolean;
        compact?: boolean;
        class?: string;
        leadingAction?: Snippet;
    } = $props();

    const repositoryRef = $derived(
        repository.platformRepositoryRef ?? repository.displayName,
    );
    const repositoryName = $derived(repositoryRef.trim() || "Repository");
    const requiresSetup = $derived(
        Boolean(localRepository && !localRepository.data.isInitialized),
    );
    const invalidState = $derived(localRepository?.data.invalidState);
    const branchLabel = $derived(
        localRepository?.syncStatus?.branchRef ??
            localRepository?.data.currentBranch ??
            repository.github?.defaultBranch ??
            "Unavailable",
    );

    async function openRepository(): Promise<void> {
        if (!interactive || !repository.isLocal) {
            return;
        }

        await goto(`/airport/${encodeURIComponent(repository.key)}`);
    }

    function isInteractiveTarget(event: Event): boolean {
        const target = event.target;
        return (
            target instanceof Element &&
            Boolean(
                target.closest(
                    "a,button,input,textarea,select,[data-repository-row-action]",
                ),
            )
        );
    }

    function handleClick(event: MouseEvent): void {
        if (isInteractiveTarget(event)) {
            return;
        }

        void openRepository();
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (isInteractiveTarget(event)) {
            return;
        }

        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }

        event.preventDefault();
        void openRepository();
    }
</script>

{#snippet panelContent()}
    <div
        class={compact
            ? "flex min-h-0 flex-col gap-3 px-4 py-4"
            : "flex min-h-14 flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"}
        role="group"
        aria-label={`${repository.displayName} commands`}
        data-repository-row-action
    >
        <div
            class={compact
                ? "flex min-w-0 items-start gap-3"
                : "flex min-w-0 items-start gap-3 md:items-center"}
        >
            <span
                class={compact
                    ? "inline-flex size-8 shrink-0 items-center justify-center border bg-background text-muted-foreground dark:bg-[#171a20]"
                    : "inline-flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground"}
            >
                <Icon icon="lucide:folder-git-2" class="size-4" />
            </span>
            <div class="min-w-0 flex-1">
                <h2
                    class={compact
                        ? "min-w-0 truncate text-sm font-semibold text-foreground"
                        : "min-w-0 truncate text-lg font-semibold text-foreground"}
                >
                    {repositoryName}
                </h2>
                <p class="mt-1 text-xs text-muted-foreground">
                    {branchLabel}
                </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                {#if invalidState}
                    <Badge variant="destructive" class="shrink-0">
                        Invalid
                    </Badge>
                {:else if requiresSetup}
                    <Badge variant="secondary" class="shrink-0">
                        Initialization required
                    </Badge>
                {/if}
            </div>
        </div>
        <RepositoryCommandbar
            repository={localRepository}
            {onCommandExecuted}
            {leadingAction}
        />
    </div>
{/snippet}

{#if interactive && repository.isLocal}
    <div
        class={cn(
            compact
                ? "overflow-hidden border bg-card shadow-xs cursor-pointer outline-none transition-colors hover:border-primary/40 hover:bg-muted/25 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-[#111317]"
                : "overflow-hidden rounded-lg border bg-background shadow-xs cursor-pointer outline-none transition-colors hover:border-primary/40 hover:bg-muted/25 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
            className,
        )}
        role="link"
        tabindex="0"
        aria-label={`Open local repository ${repository.displayName}`}
        title={`Open local repository ${repository.displayName}`}
        onclick={handleClick}
        onkeydown={handleKeydown}
    >
        {@render panelContent()}
    </div>
{:else}
    <div
        class={cn(
            compact
                ? "overflow-hidden border bg-card shadow-xs dark:bg-[#111317]"
                : "overflow-hidden rounded-lg border bg-background shadow-xs",
            className,
        )}
    >
        {@render panelContent()}
    </div>
{/if}
