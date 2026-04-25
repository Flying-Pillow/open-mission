<script lang="ts">
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import GithubRepository from "$lib/components/entities/Repository/GithubRepository.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

    const appContext = getAppContext();
    const repositories = $derived(
        appContext.application.githubRepositoriesState,
    );
    const githubStatusTone = $derived(appContext.githubStatus);
    const githubRepositoriesLoading = $derived(
        appContext.application.githubRepositoriesLoading,
    );
    const githubRepositoriesError = $derived(
        appContext.application.githubRepositoriesError,
    );

    const repositoryCountLabel = $derived(
        repositories.length === 1
            ? "1 GitHub repository"
            : `${repositories.length} GitHub repositories`,
    );

    const emptyMessage = $derived(
        githubStatusTone === "connected"
            ? "No GitHub repositories were returned for this account yet."
            : "Connect GitHub to browse your user and organization repositories here.",
    );
</script>

<section
    class="flex h-full min-h-0 flex-1 flex-col rounded-2xl border bg-background/50 p-4"
>
    <div class="flex items-center justify-between gap-4">
        <div>
            <h3 class="text-base font-semibold text-foreground">
                GitHub repository browser
            </h3>
            <p class="mt-1 text-sm text-muted-foreground">
                Browse accessible repositories and open the clone dialog for the
                one you want to use.
            </p>
        </div>
        <Badge variant="secondary">{repositoryCountLabel}</Badge>
    </div>

    {#if githubRepositoriesError}
        <p class="mt-3 text-sm text-rose-600">{githubRepositoriesError}</p>
    {/if}

    <ScrollArea class="mt-4 min-h-0 flex-1 pr-3">
        <div class="grid gap-3">
            {#if githubRepositoriesLoading && repositories.length === 0}
                <div
                    class="rounded-2xl border border-dashed bg-muted/20 px-4 py-8 text-sm text-muted-foreground"
                >
                    Loading GitHub repositories...
                </div>
            {:else if repositories.length === 0}
                <div
                    class="rounded-2xl border border-dashed bg-muted/20 px-4 py-8 text-sm text-muted-foreground"
                >
                    {emptyMessage}
                </div>
            {:else}
                {#each repositories as repository (repository.fullName)}
                    <GithubRepository {repository} />
                {/each}
            {/if}
        </div>
    </ScrollArea>
</section>
