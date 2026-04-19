<script lang="ts">
    import { Badge } from "$lib/components/ui/badge/index.js";
    import type { Repository } from "$lib/client/entities/Repository";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import Issue from "$lib/components/entities/Issue/Issue.svelte";
    import type { SelectedIssueSummary } from "$lib/components/entities/types";

    let {
        repository,
        selectedIssue = $bindable<SelectedIssueSummary | null>(null),
        issueError = $bindable<string | null>(null),
        issueLoadingNumber = $bindable<number | null>(null),
    }: {
        repository: Repository;
        selectedIssue?: SelectedIssueSummary | null;
        issueError?: string | null;
        issueLoadingNumber?: number | null;
    } = $props();

    let remoteStartFromIssueError = $state<string | null>(null);

    const repositoryIssues = $derived(repository.listIssues());

    async function viewIssue(issueNumber: number): Promise<void> {
        issueLoadingNumber = issueNumber;
        issueError = null;

        try {
            selectedIssue = await repository.getIssue(issueNumber);
        } catch (error) {
            issueError = error instanceof Error ? error.message : String(error);
        } finally {
            issueLoadingNumber = null;
        }
    }
</script>

<section
    class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
>
    <div class="flex items-center justify-between gap-4">
        <div>
            <h2 class="text-lg font-semibold text-foreground">
                Start from issue
            </h2>
            <p class="mt-1 text-sm text-muted-foreground">
                Turn a tracked repository issue into a new mission with one
                step.
            </p>
        </div>
        <Badge variant="outline">
            {#await repositoryIssues}
                Loading issues...
            {:then issues}
                {issues.length === 1
                    ? "1 open issue"
                    : `${issues.length} open issues`}
            {:catch}
                Issue list unavailable
            {/await}
        </Badge>
    </div>

    {#if issueError || remoteStartFromIssueError}
        <p class="mt-3 text-sm text-rose-600">
            {issueError ?? remoteStartFromIssueError}
        </p>
    {/if}

    <ScrollArea class="mt-4 min-h-0 flex-1 pr-3">
        <div class="grid gap-3">
            {#await repositoryIssues}
                <div
                    class="rounded-xl border border-dashed bg-background/60 px-4 py-6 text-sm text-muted-foreground"
                >
                    Loading tracked issues for this repository...
                </div>
            {:then issues}
                {#if issues.length === 0}
                    <div
                        class="rounded-xl border border-dashed bg-background/60 px-4 py-6 text-sm text-muted-foreground"
                    >
                        No tracked issues are available for this repository.
                    </div>
                {:else}
                    {#each issues as issue (issue.number)}
                        <Issue
                            {repository}
                            {issue}
                            {issueLoadingNumber}
                            onViewIssue={(issueNumber) =>
                                void viewIssue(issueNumber)}
                            onStartIssueError={(message) => {
                                remoteStartFromIssueError = message;
                            }}
                        />
                    {/each}
                {/if}
            {:catch issueListError}
                <div
                    class="rounded-xl border border-dashed bg-background/60 px-4 py-6 text-sm text-rose-600"
                >
                    {issueListError instanceof Error
                        ? issueListError.message
                        : String(issueListError)}
                </div>
            {/await}
        </div>
    </ScrollArea>
</section>
