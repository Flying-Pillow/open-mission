<script lang="ts">
    import { goto } from "$app/navigation";
    import Icon from "@iconify/svelte";
    import type { AirportRepositoryListItem } from "$lib/components/entities/types";
    import type { Repository } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import RepositoryCommandbar from "$lib/components/entities/Repository/RepositoryCommandbar.svelte";
    import RepositorySyncStatus from "$lib/components/entities/Repository/RepositorySyncStatus.svelte";
    import { cn } from "$lib/utils.js";

    let {
        repository,
        localRepository,
        onCommandExecuted,
        interactive = false,
        class: className,
    }: {
        repository: AirportRepositoryListItem;
        localRepository?: Repository;
        onCommandExecuted: () => Promise<void>;
        interactive?: boolean;
        class?: string;
    } = $props();

    const repositoryRef = $derived(
        repository.platformRepositoryRef ?? repository.displayName,
    );
    const repositoryName = $derived(repositoryRef.trim() || "Repository");
    const requiresPreparation = $derived(
        Boolean(localRepository && !localRepository.data.isInitialized),
    );
    const platformRepositoryUrl = $derived(
        repository.platformRepositoryRef?.trim()
            ? `https://github.com/${repository.platformRepositoryRef.trim()}`
            : undefined,
    );
    const branchLabel = $derived(
        localRepository?.syncStatus?.branchRef ??
            localRepository?.data.currentBranch ??
            repository.github?.defaultBranch ??
            "Unavailable",
    );
    const displayDescription = $derived.by(() => {
        const description = repository.displayDescription.trim();
        if (!description || description === repositoryName) {
            return undefined;
        }
        if (description === repository.platformRepositoryRef?.trim()) {
            return undefined;
        }
        return description;
    });

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
        class="flex min-h-12 flex-col gap-3 border-b bg-muted/15 px-4 py-3 md:flex-row md:items-center md:justify-between"
        role="group"
        aria-label={`${repository.displayName} commands`}
        data-repository-row-action
    >
        <div class="flex min-w-0 items-start gap-3 md:items-center">
            <span
                class="inline-flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground"
            >
                <Icon icon="lucide:folder-git-2" class="size-4" />
            </span>
            <div class="min-w-0">
                <h3
                    class="min-w-0 truncate text-lg font-semibold leading-6 text-foreground"
                >
                    {repositoryName}
                </h3>
                {#if requiresPreparation}
                    <Badge variant="secondary" class="shrink-0">
                        Setup required
                    </Badge>
                {/if}
            </div>
        </div>
        <RepositoryCommandbar
            repository={localRepository}
            {onCommandExecuted}
        />
    </div>

    <div
        class="grid gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-[minmax(18rem,1.5fr)_minmax(9rem,0.55fr)_minmax(13rem,0.9fr)_minmax(13rem,0.8fr)] xl:items-start"
    >
        <div class="min-w-0">
            {#if displayDescription}
                <p class="line-clamp-2 text-sm leading-5 text-muted-foreground">
                    {displayDescription}
                </p>
            {/if}
            {#if repository.repositoryRootPath}
                <p
                    class={cn(
                        "break-all font-mono text-xs text-muted-foreground",
                        displayDescription ? "mt-2" : undefined,
                    )}
                >
                    {repository.repositoryRootPath}
                </p>
            {/if}
        </div>

        <div class="grid gap-1">
            <p
                class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
            >
                Branch
            </p>
            <p class="min-w-0 truncate text-sm font-medium text-foreground">
                {branchLabel}
            </p>
            {#if repository.github?.defaultBranch}
                <p class="text-xs text-muted-foreground">
                    Default: {repository.github.defaultBranch}
                </p>
            {/if}
        </div>

        <div class="grid gap-1">
            <p
                class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
            >
                Remote
            </p>
            {#if platformRepositoryUrl && repository.platformRepositoryRef}
                <a
                    href={platformRepositoryUrl}
                    target="_blank"
                    rel="noreferrer"
                    class="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Open ${repository.platformRepositoryRef} on GitHub`}
                    title={`Open ${repository.platformRepositoryRef} on GitHub`}
                >
                    <Icon
                        icon="lucide:github"
                        class="size-4 shrink-0 text-muted-foreground"
                    />
                    <span class="min-w-0 truncate">
                        {repository.platformRepositoryRef}
                    </span>
                </a>
            {:else}
                <p class="min-w-0 truncate text-sm font-medium text-foreground">
                    Not configured
                </p>
            {/if}
        </div>

        <div class="grid gap-1">
            <p
                class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
            >
                State
            </p>
            <RepositorySyncStatus repository={localRepository} />
        </div>
    </div>

    {#if requiresPreparation}
        <div
            class="border-t border-dashed bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"
        >
            <div class="flex min-w-0 items-start gap-2">
                <Icon
                    icon="lucide:route"
                    class="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
                />
                <p class="min-w-0 leading-5">
                    This Repository needs a preparation Mission before regular
                    SPEC-driven work can start.
                </p>
            </div>
        </div>
    {/if}
{/snippet}

{#if interactive && repository.isLocal}
    <div
        class={cn(
            "overflow-hidden rounded-lg border bg-background shadow-xs cursor-pointer outline-none transition-colors hover:border-primary/40 hover:bg-muted/25 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
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
            "overflow-hidden rounded-lg border bg-background shadow-xs",
            className,
        )}
    >
        {@render panelContent()}
    </div>
{/if}
