<script lang="ts">
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { getScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import Issue from "$lib/components/entities/Issue/Issue.svelte";
    import type {
        IssueSummary,
        SelectedIssueSummary,
    } from "$lib/components/entities/types";

    let {
        selectedIssue = $bindable<SelectedIssueSummary | null>(null),
        issueError = $bindable<string | null>(null),
        issueLoadingNumber = $bindable<number | null>(null),
    }: {
        selectedIssue?: SelectedIssueSummary | null;
        issueError?: string | null;
        issueLoadingNumber?: number | null;
    } = $props();
    const repositoryScope = getScopedRepositoryContext();
    const activeRepository = $derived.by(() => {
        const repository = repositoryScope.repository;
        if (!repository) {
            throw new Error("Issue list requires a scoped repository context.");
        }

        return repository;
    });

    let remoteStartFromIssueError = $state<string | null>(null);
    const repositoryIssuesQuery = $derived(activeRepository.listIssuesQuery());
    const repositoryIssues = $derived(
        (repositoryIssuesQuery.current as IssueSummary[] | undefined) ?? [],
    );
    const repositoryIssuesLoading = $derived(
        repositoryIssuesQuery.loading ?? false,
    );
    const repositoryIssueLoadError = $derived.by(() => {
        const error = repositoryIssuesQuery.error;
        if (!error) {
            return null;
        }

        return error instanceof Error ? error.message : String(error);
    });

    async function viewIssue(issueNumber: number): Promise<void> {
        issueLoadingNumber = issueNumber;
        issueError = null;

        try {
            selectedIssue = await activeRepository.getIssue(issueNumber);
        } catch (error) {
            issueError = error instanceof Error ? error.message : String(error);
        } finally {
            issueLoadingNumber = null;
        }
    }

    function handleStartIssueError(message: string | null): void {
        remoteStartFromIssueError = message;
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
            {repositoryIssuesLoading
                ? "Loading issues..."
                : repositoryIssues.length === 1
                    ? "1 open issue"
                    : `${repositoryIssues.length} open issues`}
        </Badge>
    </div>

    {#if issueError || remoteStartFromIssueError || repositoryIssueLoadError}
        <p class="mt-3 text-sm text-rose-600">
            {issueError ?? remoteStartFromIssueError ?? repositoryIssueLoadError}
        </p>
    {/if}

    <ScrollArea class="mt-4 min-h-0 flex-1 pr-3">
        <div class="grid gap-3">
            {#if repositoryIssuesLoading}
                <div
                    class="rounded-xl border border-dashed bg-background/60 px-4 py-6 text-sm text-muted-foreground"
                >
                    Loading tracked issues for this repository...
                </div>
            {:else if repositoryIssueLoadError}
                <div
                    class="rounded-xl border border-dashed bg-background/60 px-4 py-6 text-sm text-rose-600"
                >
                    {repositoryIssueLoadError}
                </div>
            {:else if repositoryIssues.length === 0}
                <div
                    class="rounded-xl border border-dashed bg-background/60 px-4 py-6 text-sm text-muted-foreground"
                >
                    No tracked issues are available for this repository.
                </div>
            {:else}
                {#each repositoryIssues as issue (issue.number)}
                    <Issue
                        {issue}
                        {issueLoadingNumber}
                        onViewIssue={(issueNumber) =>
                            void viewIssue(issueNumber)}
                        onStartIssueError={handleStartIssueError}
                    />
                {/each}
            {/if}
        </div>
    </ScrollArea>
</section>
