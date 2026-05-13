<script lang="ts">
    import Icon from "@iconify/svelte";
    import { app } from "$lib/client/Application.svelte.js";
    import GithubRepository from "$lib/components/entities/Repository/GithubRepository.svelte";
    import RepositoryPanel from "$lib/components/entities/Repository/RepositoryPanel.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

    let {
        heading,
        description,
        repositoryFilter = "all",
        eyebrow,
        presentation = "panel",
    }: {
        heading?: string;
        description?: string;
        repositoryFilter?: "all" | "local" | "external";
        eyebrow?: string;
        presentation?: "panel" | "rail";
    } = $props();
    const repositories = $derived(app.repositoryListItems);
    const checkedOutRepositories = $derived(
        repositories.filter((repository) => repository.isLocal),
    );
    const availableGitHubRepositories = $derived(
        repositories.filter((repository) => !repository.isLocal),
    );
    const visibleRepositories = $derived.by(() => {
        if (repositoryFilter === "local") {
            return checkedOutRepositories;
        }

        if (repositoryFilter === "external") {
            return availableGitHubRepositories;
        }

        return repositories;
    });
    const resolvedHeading = $derived(
        heading ??
            (repositoryFilter === "local"
                ? "Checked out repositories"
                : repositoryFilter === "external"
                  ? "External GitHub repositories"
                  : "Repositories available"),
    );
    const resolvedEyebrow = $derived(
        eyebrow ?? (repositoryFilter === "external" ? "GitHub" : "Local"),
    );
    const resolvedDescription = $derived(
        description ??
            (repositoryFilter === "local"
                ? "Repositories already available as local working copies."
                : repositoryFilter === "external"
                  ? "Repositories available to clone from GitHub."
                  : "Available repositories to work on."),
    );
    const resolvedCountLabel = $derived(
        repositoryFilter === "local"
            ? visibleRepositories.length === 1
                ? "1 checked out"
                : `${visibleRepositories.length} checked out`
            : repositoryFilter === "external"
              ? visibleRepositories.length === 1
                  ? "1 external repository"
                  : `${visibleRepositories.length} external repositories`
              : checkedOutRepositories.length > 0
                ? `${checkedOutRepositories.length} checked out / ${availableGitHubRepositories.length} available`
                : repositories.length === 1
                  ? "1 repository available"
                  : `${repositories.length} repositories available`,
    );
    const resolvedEmptyMessage = $derived(
        repositoryFilter === "local"
            ? "No repositories are checked out locally yet."
            : repositoryFilter === "external"
              ? "No external GitHub repositories are available right now."
              : "No repositories are available yet. Add one from the form to start using Open Mission as a multi-repository control surface.",
    );

    async function refreshRepositories(): Promise<void> {
        await app.loadRepositories({ force: true });
    }
</script>

<section
    class={presentation === "rail"
        ? "flex h-full min-h-0 w-full flex-col overflow-hidden"
        : "flex h-full min-h-[24rem] w-full flex-col overflow-hidden rounded-lg border bg-card shadow-sm"}
>
    <div
        class={presentation === "rail"
            ? "px-1 pb-3"
            : "border-b bg-muted/25 px-4 py-3 sm:px-5"}
    >
        <div class="min-w-0 space-y-2">
            <div class="flex items-center gap-2 text-muted-foreground">
                {#if repositoryFilter === "external"}
                    <Icon icon="lucide:github" class="size-4" />
                {:else}
                    <Icon icon="lucide:folder-git-2" class="size-4" />
                {/if}
                <p class="text-xs font-medium uppercase tracking-[0.16em]">
                    {resolvedEyebrow}
                </p>
            </div>
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <h2
                        class={presentation === "rail"
                            ? "text-xs font-semibold uppercase tracking-[0.2em] text-foreground"
                            : "text-lg font-semibold text-foreground"}
                    >
                        {resolvedHeading}
                    </h2>
                    <p
                        class={presentation === "rail"
                            ? "mt-2 text-xs leading-5 text-muted-foreground"
                            : "mt-2 max-w-4xl text-sm leading-6 text-muted-foreground"}
                    >
                        {resolvedDescription}
                    </p>
                </div>
                {#if presentation === "rail"}
                    <span
                        class="shrink-0 text-[0.7rem] uppercase tracking-[0.16em] text-muted-foreground"
                    >
                        {visibleRepositories.length}
                    </span>
                {:else}
                    <Badge variant="secondary" class="w-fit shrink-0">
                        {resolvedCountLabel}
                    </Badge>
                {/if}
            </div>
        </div>
    </div>

    <ScrollArea class="min-h-0 flex-1">
        <div
            class={presentation === "rail"
                ? "grid gap-3 pr-2"
                : "grid gap-3 p-4"}
        >
            {#if visibleRepositories.length === 0}
                <div
                    class={presentation === "rail"
                        ? "border border-dashed border-border/60 bg-card px-4 py-6 text-sm text-muted-foreground dark:bg-[#111317]"
                        : "rounded-lg border border-dashed bg-background px-4 py-8 text-sm text-muted-foreground"}
                >
                    {resolvedEmptyMessage}
                </div>
            {:else}
                {#if repositoryFilter === "all" && checkedOutRepositories.length > 0}
                    <div class="px-1 pb-1 pt-2">
                        <h3
                            class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                        >
                            Checked out locally
                        </h3>
                    </div>
                {/if}

                {#each repositoryFilter === "external" ? [] : checkedOutRepositories as repository (repository.key)}
                    {#if repository.local}
                        {@const localRepository = app.resolveRepository(
                            repository.key,
                        )}
                        <RepositoryPanel
                            {repository}
                            {localRepository}
                            onCommandExecuted={refreshRepositories}
                            interactive
                            compact={presentation === "rail"}
                        />
                    {/if}
                {/each}

                {#if repositoryFilter === "all" && availableGitHubRepositories.length > 0}
                    <div class="px-1 pb-1 pt-4">
                        <h3
                            class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                        >
                            Available to clone
                        </h3>
                    </div>
                {/if}

                {#each repositoryFilter === "local" ? [] : availableGitHubRepositories as repository (repository.key)}
                    {#if repository.github}
                        <GithubRepository
                            repository={repository.github}
                            compact={presentation === "rail"}
                        />
                    {/if}
                {/each}
            {/if}
        </div>
    </ScrollArea>
</section>
