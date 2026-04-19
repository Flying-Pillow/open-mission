<!-- /apps/airport/web/src/routes/repository/[repositoryId]/+page.svelte: Repository-scoped Airport route for selecting missions and creating new missions. -->
<script lang="ts">
    import { getRepositoryIssue, getRepositoryIssues } from "./issue.remote";
    import { startMissionFromIssue } from "./mission.remote";
    import { onMount, type Component } from "svelte";
    import AirportHeader from "$lib/components/airport/airport-header.svelte";
    import AirportSidebar from "$lib/components/airport/airport-sidebar.svelte";
    import { Repository as RepositoryEntity } from "$lib/client/entities/Repository";
    import BriefForm from "$lib/components/entities/Brief/BriefForm.svelte";
    import IssueList from "$lib/components/entities/Issue/IssueList.svelte";
    import IssuePreview from "$lib/components/entities/Issue/IssuePreview.svelte";
    import SelectedMission from "$lib/components/entities/Mission/SelectedMission.svelte";
    import RepositoryList from "$lib/components/entities/Repository/RepositoryList.svelte";
    import RepositoryCard from "$lib/components/entities/Repository/Repository.svelte";
    import type { SelectedIssueSummary } from "$lib/components/entities/types";
    import {
        SidebarInset,
        SidebarProvider,
    } from "$lib/components/ui/sidebar/index.js";

    type Props = {
        data: {
            repositorySurface: import("@flying-pillow/mission-core").RepositorySurfaceSnapshotDto;
        };
    };

    let { data }: Props = $props();
    const repository = $derived(
        new RepositoryEntity(data.repositorySurface, {
            listIssues: (input) => getRepositoryIssues(input),
            getIssue: (input) => getRepositoryIssue(input),
            startMissionFromIssue: async (input) =>
                await startMissionFromIssue(input),
        }),
    );
    const missionCountLabel = $derived(repository.missionCountLabel);
    const selectedMission = $derived(repository.selectedMission);

    let selectedIssue = $state<SelectedIssueSummary | null>(null);
    let issueError = $state<string | null>(null);
    let issueLoadingNumber = $state<number | null>(null);
    let MarkdownViewer = $state<Component<{ source: string }> | null>(null);

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

<svelte:head>
    <title>{repository.label} · Airport Repository</title>
    <meta
        name="description"
        content="Repository-scoped Airport route for selecting missions and creating new missions from issues or briefs."
    />
</svelte:head>

<SidebarProvider>
    <AirportSidebar variant="inset" />

    <SidebarInset
        class="min-h-0 overflow-hidden h-svh md:peer-data-[variant=inset]:my-0"
    >
        <AirportHeader />
        <div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
            <RepositoryCard
                repository={repository.summary}
                operationalMode={repository.operationalMode}
                controlRoot={repository.controlRoot}
                currentBranch={repository.currentBranch}
                settingsComplete={repository.settingsComplete}
                githubRepository={repository.githubRepository}
                {missionCountLabel}
            />

            {#key repository.repositoryId}
                <div
                    class="mt-4 grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-2"
                >
                    <section
                        class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden"
                    >
                        <RepositoryList
                            missions={repository.missions}
                            {missionCountLabel}
                            selectedMissionId={repository.selectedMissionId}
                        />

                        <IssueList
                            {repository}
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
                                    <SelectedMission
                                        selectedMissionId={repository.selectedMissionId}
                                        {selectedMission}
                                    />
                                {:else}
                                    <BriefForm />
                                {/if}
                            </div>
                        {/if}
                    </section>
                </div>
            {/key}
        </div>
    </SidebarInset>
</SidebarProvider>
