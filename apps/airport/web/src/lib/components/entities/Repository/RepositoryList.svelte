<script lang="ts">
    import Icon from "@iconify/svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import GithubRepository from "$lib/components/entities/Repository/GithubRepository.svelte";
    import RepositoryPanel from "$lib/components/entities/Repository/RepositoryPanel.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

    const appContext = getAppContext();
    let {
        heading,
        description,
        repositoryFilter = "all",
        eyebrow,
    }: {
        heading?: string;
        description?: string;
        repositoryFilter?: "all" | "local" | "external";
        eyebrow?: string;
    } = $props();
    const repositories = $derived(appContext.application.repositoryListItems);
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
              : "No repositories are available yet. Add one from the form to start using Airport as a multi-repository control surface.",
    );

    async function refreshRepositories(): Promise<void> {
        await appContext.application.loadRepositories({ force: true });
    }
</script>

<section
    class="flex h-full min-h-[24rem] w-full flex-col overflow-hidden rounded-lg border bg-card shadow-sm"
>
    <div class="border-b bg-muted/25 px-4 py-3 sm:px-5">
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
            <h2 class="text-lg font-semibold text-foreground">
                {resolvedHeading}
            </h2>
            <div
                class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
                <div
                    class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center"
                >
                    <p
                        class="min-w-0 max-w-4xl text-sm leading-6 text-muted-foreground"
                    >
                        {resolvedDescription}
                    </p>
                </div>
                <Badge variant="secondary" class="w-fit shrink-0"
                    >{resolvedCountLabel}</Badge
                >
            </div>
        </div>
    </div>

    <ScrollArea class="min-h-0 flex-1">
        <div class="grid gap-3 p-4">
            {#if visibleRepositories.length === 0}
                <div
                    class="rounded-lg border border-dashed bg-background px-4 py-8 text-sm text-muted-foreground"
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
                        {@const localRepository =
                            appContext.application.resolveRepository(
                                repository.key,
                            )}
                        <RepositoryPanel
                            {repository}
                            {localRepository}
                            onCommandExecuted={refreshRepositories}
                            interactive
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
                        <GithubRepository repository={repository.github} />
                    {/if}
                {/each}
            {/if}
        </div>
    </ScrollArea>
</section>
