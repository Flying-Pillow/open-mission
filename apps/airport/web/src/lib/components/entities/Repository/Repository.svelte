<script lang="ts">
    import { page } from "$app/state";
    import { onMount, type Component } from "svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { setScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
    import type { Repository as RepositoryEntity } from "$lib/components/entities/Repository/Repository.svelte.js";
    import BriefForm from "$lib/components/entities/Brief/BriefForm.svelte";
    import IssueList from "$lib/components/entities/Issue/IssueList.svelte";
    import IssuePreview from "$lib/components/entities/Issue/IssuePreview.svelte";
    import MissionSummary from "$lib/components/entities/Mission/MissionSummary.svelte";
    import RepositoryList from "$lib/components/entities/Repository/RepositoryList.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import type { SelectedIssueSummary } from "$lib/components/entities/types";

    const appContext = getAppContext();
    const repositoryId = page.params.repositoryId?.trim() ?? "";
    const repositoryScopeState = $state<{
        repositoryId?: string;
        repository?: RepositoryEntity;
        loading: boolean;
        error?: string | null;
    }>({
        repositoryId: repositoryId || undefined,
        loading: true,
    });
    const repositoryScope = setScopedRepositoryContext(repositoryScopeState);

    let selectedIssue = $state<SelectedIssueSummary | null>(null);
    let issueError = $state<string | null>(null);
    let issueLoadingNumber = $state<number | null>(null);
    let MarkdownViewer = $state<Component<{ source: string }> | null>(null);

    const activeRepository = $derived(repositoryScope.repository);
    const repositoryLoading = $derived(repositoryScope.loading);
    const repositoryError = $derived(repositoryScope.error);
    const selectedMission = $derived(activeRepository?.selectedMission);
    const repositorySummary = $derived(activeRepository?.summary);
    const repositoryOperationalMode = $derived(activeRepository?.operationalMode);
    const repositoryControlRoot = $derived(
        activeRepository?.controlRoot ?? repositorySummary?.repositoryRootPath,
    );
    const repositoryCurrentBranch = $derived(activeRepository?.currentBranch);
    const repositoryGithubRepository = $derived(
        activeRepository?.githubRepository ?? repositorySummary?.githubRepository,
    );
    const repositorySettingsComplete = $derived(
        activeRepository?.settingsComplete,
    );
    const resolvedMissionCountLabel = $derived(
        activeRepository?.missionCountLabel ?? "0 missions",
    );

    onMount(() => {
        const initialSummary = appContext.airport.repositories.find(
            (repository) => repository.repositoryId === repositoryId,
        );

        if (initialSummary) {
            repositoryScope.repository =
                appContext.application.seedRepositoryFromSummary(initialSummary);
            repositoryScope.error = null;
        }

        void loadRepositorySurface();
        void loadMarkdownViewer();
    });

    async function loadRepositorySurface(): Promise<void> {
        try {
            const repository = await appContext.application.openRepositoryRoute(repositoryId);
            repositoryScope.repository = repository;
            repositoryScope.error = null;
        } catch (error) {
            if (!repositoryScope.repository) {
                repositoryScope.repository = undefined;
            }
            repositoryScope.error = error instanceof Error ? error.message : String(error);
        } finally {
            repositoryScope.loading = false;
        }
    }

    async function loadMarkdownViewer(): Promise<void> {
        MarkdownViewer = (
            await import("$lib/components/viewers/markdown.svelte")
        ).default;
    }

    function closeIssuePreview(): void {
        selectedIssue = null;
        issueError = null;
    }
</script>

<div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
    {#if repositoryLoading && !activeRepository}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 text-sm text-muted-foreground backdrop-blur-sm"
        >
            Loading repository surface...
        </section>
    {:else if repositoryError || !activeRepository || !repositorySummary}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
        >
            <h2 class="text-lg font-semibold text-foreground">Repository</h2>
            <p class="mt-3 text-sm text-rose-600">
                {repositoryError ?? "Repository snapshot could not be loaded."}
            </p>
        </section>
    {:else}
        <section class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm">
            <div class="flex items-start justify-between gap-4">
                <div>
                    <p
                        class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                    >
                        Repository
                    </p>
                    <h1 class="mt-2 text-2xl font-semibold text-foreground">
                        {repositorySummary.label}
                    </h1>
                    <p class="mt-1 text-sm text-muted-foreground">
                        {repositorySummary.description}
                    </p>
                    <p class="mt-2 font-mono text-xs text-muted-foreground">
                        {repositorySummary.repositoryRootPath}
                    </p>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                    <Badge variant="secondary">{resolvedMissionCountLabel}</Badge>
                    {#if repositoryOperationalMode}
                        <Badge variant="outline">{repositoryOperationalMode}</Badge>
                    {/if}
                </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div class="rounded-xl border bg-background/70 px-4 py-3">
                    <p
                        class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                    >
                        Control root
                    </p>
                    <p class="mt-2 text-sm font-medium text-foreground">
                        {repositoryControlRoot}
                    </p>
                </div>
                <div class="rounded-xl border bg-background/70 px-4 py-3">
                    <p
                        class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                    >
                        Branch
                    </p>
                    <p class="mt-2 text-sm font-medium text-foreground">
                        {repositoryCurrentBranch ?? "Unavailable"}
                    </p>
                </div>
                <div class="rounded-xl border bg-background/70 px-4 py-3">
                    <p
                        class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                    >
                        Tracking
                    </p>
                    <p class="mt-2 text-sm font-medium text-foreground">
                        {repositoryGithubRepository ?? "Not configured"}
                    </p>
                </div>
                <div class="rounded-xl border bg-background/70 px-4 py-3">
                    <p
                        class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                    >
                        Setup
                    </p>
                    <p class="mt-2 text-sm font-medium text-foreground">
                        {repositorySettingsComplete === false ? "Incomplete" : "Ready"}
                    </p>
                </div>
            </div>
        </section>

        {#key activeRepository.repositoryId}
            <div
                class="mt-4 grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-2"
            >
                <section
                    class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden"
                >
                    <RepositoryList />

                    <IssueList
                        bind:selectedIssue
                        bind:issueError
                        bind:issueLoadingNumber
                    />
                </section>

                <section
                    class="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden"
                >
                    {#if selectedIssue}
                        <IssuePreview
                            {selectedIssue}
                            {MarkdownViewer}
                            onClose={closeIssuePreview}
                        />
                    {:else}
                        <div class="flex min-h-0 h-full flex-col">
                            {#if issueError}
                                <section
                                    class="mb-4 rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
                                >
                                    <h2
                                        class="text-lg font-semibold text-foreground"
                                    >
                                        Issue viewer
                                    </h2>
                                    <p class="mt-3 text-sm text-rose-600">
                                        {issueError}
                                    </p>
                                </section>
                            {/if}

                            {#if selectedMission}
                                <MissionSummary />
                            {:else}
                                <BriefForm />
                            {/if}
                        </div>
                    {/if}
                </section>
            </div>
        {/key}
    {/if}
</div>
