<script lang="ts">
    import { page } from "$app/state";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { onMount, type Component } from "svelte";
    import BriefForm from "$lib/components/entities/Brief/BriefForm.svelte";
    import IssueList from "$lib/components/entities/Issue/IssueList.svelte";
    import IssuePreview from "$lib/components/entities/Issue/IssuePreview.svelte";
    import MissionSummary from "$lib/components/entities/Mission/MissionSummary.svelte";
    import RepositoryList from "$lib/components/entities/Repository/RepositoryList.svelte";
    import RepositoryCard from "$lib/components/entities/Repository/Repository.svelte";
    import type { SelectedIssueSummary } from "$lib/components/entities/types";

    const appContext = getAppContext();
    const repositoryId = $derived(page.params.repositoryId?.trim() ?? "");
    const repository = $derived.by(() => {
        const activeRepository = appContext.airport.activeRepository;
        if (!activeRepository || activeRepository.repositoryId !== repositoryId) {
            return null;
        }

        return activeRepository;
    });
    const selectedMission = $derived(repository?.selectedMission);

    let pageLoadError = $state<string | null>(null);
    let pageLoading = $state(true);
    let loadedRepositoryId = $state<string | null>(null);

    let selectedIssue = $state<SelectedIssueSummary | null>(null);
    let issueError = $state<string | null>(null);
    let issueLoadingNumber = $state<number | null>(null);
    let MarkdownViewer = $state<Component<{ source: string }> | null>(null);

    $effect(() => {
        if (!repositoryId || loadedRepositoryId === repositoryId) {
            return;
        }

        loadedRepositoryId = repositoryId;
        pageLoading = true;
        pageLoadError = null;
        selectedIssue = null;
        issueError = null;

        void (async () => {
            try {
                await appContext.application.openRepositoryRoute(repositoryId);
            } catch (error) {
                pageLoadError = error instanceof Error ? error.message : String(error);
            } finally {
                pageLoading = false;
            }
        })();
    });

    onMount(async () => {
        MarkdownViewer = (
            await import("$lib/components/viewers/markdown.svelte")
        ).default;
    });

    function closeIssuePreview(): void {
        selectedIssue = null;
        issueError = null;
    }
</script>

<div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
    {#if pageLoading && !repository}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 text-sm text-muted-foreground backdrop-blur-sm"
        >
            Loading repository surface...
        </section>
    {:else if pageLoadError || !repository}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
        >
            <h2 class="text-lg font-semibold text-foreground">Repository</h2>
            <p class="mt-3 text-sm text-rose-600">
                {pageLoadError ?? "Repository surface could not be loaded."}
            </p>
        </section>
    {:else}
        <RepositoryCard />

        {#key repository.repositoryId}
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