<script lang="ts">
    import { page } from "$app/state";
    import ArrowRightIcon from "@tabler/icons-svelte/icons/arrow-right";
    import BrandGithubIcon from "@tabler/icons-svelte/icons/brand-github";
    import FolderIcon from "@tabler/icons-svelte/icons/folder";
    import GitBranchIcon from "@tabler/icons-svelte/icons/git-branch";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { maybeGetScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

    const appContext = getAppContext();
    const repositoryScope = maybeGetScopedRepositoryContext();
    let {
        mode: modeOverride,
        heading,
        description,
    }: {
        mode?: "repositories" | "missions";
        heading?: string;
        description?: string;
    } = $props();
    const mode = $derived(
        modeOverride ??
            (page.url.pathname.startsWith("/airport")
                ? "repositories"
                : "missions"),
    );
    const activeRepository = $derived(repositoryScope?.repository);
    const repositories = $derived(appContext.airport.repositories);
    const missions = $derived(activeRepository?.missions ?? []);
    const repositoryId = $derived(activeRepository?.repositoryId ?? "");
    const selectedMissionId = $derived(appContext.airport.activeMissionId);

    const resolvedHeading = $derived(
        heading ??
            (mode === "repositories"
                ? "Repositories registered"
                : "Repository missions"),
    );
    const resolvedDescription = $derived(
        description ??
            (mode === "repositories"
                ? "Your saved local repositories, ready to open and work from."
                : "Pick an existing mission in this repository or create a new mission from the issue list or a fresh brief."),
    );
    const resolvedCountLabel = $derived(
        mode === "repositories"
            ? repositories.length === 1
                ? "1 repository registered"
                : `${repositories.length} repositories registered`
            : activeRepository?.missionCountLabel || "0 missions",
    );
    const resolvedEmptyMessage = $derived(
        mode === "repositories"
            ? "No repositories are registered yet. Add one from the form to start using Airport as a multi-repository control surface."
            : "No missions are available in this repository yet.",
    );

    function getGitHubRepositoryUrl(
        githubRepository: string | undefined,
    ): string | undefined {
        const normalizedRepository = githubRepository?.trim();
        return normalizedRepository
            ? `https://github.com/${normalizedRepository}`
            : undefined;
    }
</script>

<section
    class="flex min-h-[24rem] flex-col overflow-hidden rounded-lg border bg-card shadow-sm xl:h-full xl:min-h-0"
>
    <div
        class="flex items-start justify-between gap-4 border-b bg-muted/25 px-5 py-4"
    >
        <div class="min-w-0 space-y-1">
            <div class="flex items-center gap-2 text-muted-foreground">
                {#if mode === "repositories"}
                    <FolderIcon class="size-4" />
                {:else}
                    <GitBranchIcon class="size-4" />
                {/if}
                <p class="text-xs font-medium uppercase tracking-[0.16em]">
                    {mode === "repositories" ? "Local" : "Workflow"}
                </p>
            </div>
            <h2 class="text-lg font-semibold text-foreground">
                {resolvedHeading}
            </h2>
            <p class="text-sm leading-6 text-muted-foreground">
                {resolvedDescription}
            </p>
        </div>
        <Badge variant="secondary">{resolvedCountLabel}</Badge>
    </div>

    <ScrollArea class="min-h-0 flex-1">
        <div class="grid gap-3 p-4">
            {#if mode === "repositories"}
                {#if repositories.length === 0}
                    <div
                        class="rounded-lg border border-dashed bg-background px-4 py-8 text-sm text-muted-foreground"
                    >
                        {resolvedEmptyMessage}
                    </div>
                {:else}
                    {#each repositories as repository (repository.repositoryId)}
                        {@const githubRepositoryUrl = getGitHubRepositoryUrl(
                            repository.githubRepository,
                        )}
                        <article
                            class="rounded-lg border bg-background px-4 py-4 shadow-xs transition-colors hover:bg-muted/20"
                        >
                            <div
                                class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
                            >
                                <div class="min-w-0">
                                    <div
                                        class="flex flex-wrap items-center gap-2"
                                    >
                                        <h3
                                            class="text-sm font-semibold text-foreground"
                                        >
                                            {repository.label}
                                        </h3>
                                    </div>
                                    <p
                                        class="mt-1 text-sm text-muted-foreground"
                                    >
                                        {repository.description}
                                    </p>
                                    <p
                                        class="mt-2 break-all font-mono text-xs text-muted-foreground"
                                    >
                                        {repository.repositoryRootPath}
                                    </p>
                                </div>
                                <div class="flex items-center gap-2">
                                    {#if githubRepositoryUrl}
                                        <Button
                                            href={githubRepositoryUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            variant="outline"
                                            size="icon-sm"
                                            aria-label={`Open ${repository.label} on GitHub`}
                                            title="Open on GitHub"
                                        >
                                            <BrandGithubIcon class="size-4" />
                                        </Button>
                                    {/if}
                                    <Button
                                        href={`/repository/${encodeURIComponent(repository.repositoryId)}`}
                                        size="sm"
                                    >
                                        Open repository
                                        <ArrowRightIcon class="size-4" />
                                    </Button>
                                </div>
                            </div>
                        </article>
                    {/each}
                {/if}
            {:else if missions.length === 0}
                <div
                    class="rounded-lg border border-dashed bg-background px-4 py-8 text-sm text-muted-foreground"
                >
                    {resolvedEmptyMessage}
                </div>
            {:else}
                {#each missions as mission (mission.missionId)}
                    <article
                        class="rounded-lg border bg-background px-4 py-4 shadow-xs transition-colors hover:bg-muted/20"
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
                                    <ArrowRightIcon class="size-4" />
                                </Button>
                            </div>
                        </div>
                    </article>
                {/each}
            {/if}
        </div>
    </ScrollArea>
</section>
