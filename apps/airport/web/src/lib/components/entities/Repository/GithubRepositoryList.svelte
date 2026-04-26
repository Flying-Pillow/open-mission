<script lang="ts">
    import BrandGithubIcon from "@tabler/icons-svelte/icons/brand-github";
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
    class="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background"
>
    <div class="flex items-start justify-between gap-4 border-b px-4 py-3">
        <div class="min-w-0">
            <div class="mb-1 flex items-center gap-2 text-muted-foreground">
                <BrandGithubIcon class="size-4" />
                <p class="text-xs font-medium uppercase tracking-[0.16em]">
                    Browser
                </p>
            </div>
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

    <ScrollArea class="min-h-0 flex-1">
        <div class="grid gap-3 p-3">
            {#if githubRepositoriesLoading && repositories.length === 0}
                <div
                    class="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-sm text-muted-foreground"
                >
                    Loading GitHub repositories...
                </div>
            {:else if repositories.length === 0}
                <div
                    class="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-sm text-muted-foreground"
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
