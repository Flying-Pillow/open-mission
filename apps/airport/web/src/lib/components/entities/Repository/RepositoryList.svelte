<script lang="ts">
    import { page } from "$app/state";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { maybeGetScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

    const appContext = getAppContext();
    const repositoryScope = maybeGetScopedRepositoryContext();
    const mode = $derived.by(() =>
        page.url.pathname.startsWith("/airport") ? "repositories" : "missions",
    );
    const activeRepository = $derived(repositoryScope?.repository);
    const repositories = $derived(appContext.airport.repositories);
    const missions = $derived(activeRepository?.missions ?? []);
    const repositoryId = $derived(activeRepository?.repositoryId ?? "");
    const selectedMissionId = $derived(appContext.airport.activeMissionId);
    const selectedRepositoryRoot = $derived(
        appContext.airport.activeRepositoryRootPath,
    );

    const resolvedHeading = $derived(
        mode === "repositories"
            ? "Repositories registered"
            : "Repository missions",
    );
    const resolvedDescription = $derived(
        mode === "repositories"
            ? "Your saved local repositories, ready to open and work from."
            : "Pick an existing mission in this repository or create a new mission from the issue list or a fresh brief.",
    );
    const resolvedCountLabel = $derived(
        mode === "repositories"
            ? (repositories.length === 1
                ? "1 repository registered"
                : `${repositories.length} repositories registered`)
            : (activeRepository?.missionCountLabel || "0 missions"),
    );
    const resolvedEmptyMessage = $derived(
        mode === "repositories"
            ? "No repositories are registered yet. Add one from the form to start using Airport as a multi-repository control surface."
            : "No missions are available in this repository yet.",
    );
</script>

<section
    class="flex min-h-[24rem] flex-col rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm xl:h-full xl:min-h-0"
>
    <div class="flex items-center justify-between gap-4">
        <div>
            <h2 class="text-lg font-semibold text-foreground">
                {resolvedHeading}
            </h2>
            <p class="mt-1 text-sm text-muted-foreground">
                {resolvedDescription}
            </p>
        </div>
        <Badge variant="secondary">{resolvedCountLabel}</Badge>
    </div>

    <ScrollArea class="mt-4 min-h-0 flex-1 pr-3">
        <div class="grid gap-3">
            {#if mode === "repositories"}
                {#if repositories.length === 0}
                    <div
                        class="rounded-xl border border-dashed bg-background/60 px-4 py-8 text-sm text-muted-foreground"
                    >
                        {resolvedEmptyMessage}
                    </div>
                {:else}
                    {#each repositories as repository (repository.repositoryId)}
                        <article
                            class="rounded-xl border bg-background/70 px-4 py-4"
                        >
                            <div
                                class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
                            >
                                <div>
                                    <div
                                        class="flex flex-wrap items-center gap-2"
                                    >
                                        <h3
                                            class="text-sm font-semibold text-foreground"
                                        >
                                            {repository.label}
                                        </h3>
                                        {#if repository.repositoryRootPath === selectedRepositoryRoot}
                                            <Badge variant="outline"
                                                >Current</Badge
                                            >
                                        {/if}
                                        {#if repository.githubRepository}
                                            <Badge variant="secondary"
                                                >{repository.githubRepository}</Badge
                                            >
                                        {/if}
                                    </div>
                                    <p
                                        class="mt-1 text-sm text-muted-foreground"
                                    >
                                        {repository.description}
                                    </p>
                                    <p
                                        class="mt-2 font-mono text-xs text-muted-foreground"
                                    >
                                        {repository.repositoryRootPath}
                                    </p>
                                </div>
                                <div class="flex items-center gap-2">
                                    <Button
                                        href={`/repository/${encodeURIComponent(repository.repositoryId)}`}
                                        variant="outline"
                                        size="sm"
                                    >
                                        Open repository
                                    </Button>
                                </div>
                            </div>
                        </article>
                    {/each}
                {/if}
            {:else if missions.length === 0}
                <div
                    class="rounded-xl border border-dashed bg-background/60 px-4 py-8 text-sm text-muted-foreground"
                >
                    {resolvedEmptyMessage}
                </div>
            {:else}
                {#each missions as mission (mission.missionId)}
                    <article
                        class="rounded-xl border bg-background/70 px-4 py-4"
                    >
                        <div
                            class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
                        >
                            <div>
                                <div class="flex flex-wrap items-center gap-2">
                                    <h3
                                        class="text-sm font-semibold text-foreground"
                                    >
                                        {mission.title}
                                    </h3>
                                    {#if mission.issueId}
                                        <Badge variant="outline"
                                            >Issue #{mission.issueId}</Badge
                                        >
                                    {/if}
                                    {#if mission.missionId === selectedMissionId}
                                        <Badge variant="secondary"
                                            >Selected</Badge
                                        >
                                    {/if}
                                </div>
                                <p
                                    class="mt-1 font-mono text-xs text-muted-foreground"
                                >
                                    {mission.missionId}
                                </p>
                                <p class="mt-1 text-sm text-muted-foreground">
                                    Branch: {mission.branchRef}
                                </p>
                                <p class="mt-1 text-sm text-muted-foreground">
                                    Created: {mission.createdAt}
                                </p>
                            </div>
                            <div class="flex flex-wrap gap-2">
                                <Button
                                    href={`/repository/${encodeURIComponent(repositoryId)}/missions/${encodeURIComponent(mission.missionId)}`}
                                    variant="default"
                                >
                                    Select mission
                                </Button>
                            </div>
                        </div>
                    </article>
                {/each}
            {/if}
        </div>
    </ScrollArea>
</section>
