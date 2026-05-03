<script lang="ts">
    import Icon from "@iconify/svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { maybeGetScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

    const appContext = getAppContext();
    const repositoryScope = maybeGetScopedRepositoryContext();
    const activeRepository = $derived(repositoryScope?.repository);
    const missions = $derived(activeRepository?.missions ?? []);
    const repositoryId = $derived(activeRepository?.id ?? "");
    const selectedMissionId = $derived(appContext.airport.activeMissionId);
    const countLabel = $derived(
        activeRepository
            ? activeRepository.missions.length === 1
                ? "1 mission"
                : `${activeRepository.missions.length} missions`
            : "0 missions",
    );
</script>

<section
    class="flex h-full min-h-[24rem] w-full flex-col overflow-hidden rounded-lg border bg-card shadow-sm"
>
    <div class="border-b bg-muted/25 px-4 py-3 sm:px-5">
        <div class="min-w-0 space-y-2">
            <div class="flex items-center gap-2 text-muted-foreground">
                <Icon icon="lucide:git-branch" class="size-4" />
                <p class="text-xs font-medium uppercase tracking-[0.16em]">
                    Workflow
                </p>
            </div>
            <h2 class="text-lg font-semibold text-foreground">
                Repository missions
            </h2>
            <div
                class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
                <p
                    class="min-w-0 max-w-4xl text-sm leading-6 text-muted-foreground"
                >
                    Pick an existing mission in this repository or create a new
                    mission from the issue list or a fresh brief.
                </p>
                <Badge variant="secondary" class="w-fit shrink-0">
                    {countLabel}
                </Badge>
            </div>
        </div>
    </div>

    <ScrollArea class="min-h-0 flex-1">
        <div class="grid gap-3 p-4">
            {#if missions.length === 0}
                <div
                    class="rounded-lg border border-dashed bg-background px-4 py-8 text-sm text-muted-foreground"
                >
                    No missions are available in this repository yet.
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
                                        <Badge variant="outline">
                                            Issue #{mission.issueId}
                                        </Badge>
                                    {/if}
                                    {#if mission.missionId === selectedMissionId}
                                        <Badge variant="secondary">
                                            Selected
                                        </Badge>
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
                                    href={`/airport/${encodeURIComponent(repositoryId)}/${encodeURIComponent(mission.missionId)}`}
                                    variant="default"
                                >
                                    Select mission
                                    <Icon
                                        icon="lucide:arrow-right"
                                        class="size-4"
                                    />
                                </Button>
                            </div>
                        </div>
                    </article>
                {/each}
            {/if}
        </div>
    </ScrollArea>
</section>
