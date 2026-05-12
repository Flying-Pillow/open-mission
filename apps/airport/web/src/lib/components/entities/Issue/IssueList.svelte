<script lang="ts">
    import Icon from "@iconify/svelte";
    import BriefForm from "$lib/components/entities/Brief/BriefForm.svelte";
    import { app } from "$lib/client/Application.svelte.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import Issue from "$lib/components/entities/Issue/Issue.svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import type {
        RepositoryIssueDetailType,
        TrackedIssueSummaryType,
    } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";

    let {
        selectedIssue = $bindable<RepositoryIssueDetailType | null>(null),
        issuePreviewOpen = $bindable(false),
        issueError = $bindable<string | null>(null),
        issueLoadingNumber = $bindable<number | null>(null),
    }: {
        selectedIssue?: RepositoryIssueDetailType | null;
        issuePreviewOpen?: boolean;
        issueError?: string | null;
        issueLoadingNumber?: number | null;
    } = $props();
    const repository = $derived.by(() => {
        const repository = app.repository;
        if (!repository) {
            throw new Error("Issue list requires app.repository.");
        }

        return repository;
    });

    let remoteStartFromIssueError = $state<string | null>(null);
    let createMissionOpen = $state(false);
    const repositoryIssuesQuery = $derived(repository.listIssuesQuery());
    const repositoryIssues = $derived(
        (repositoryIssuesQuery.current as
            | TrackedIssueSummaryType[]
            | undefined) ?? [],
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
            selectedIssue = await repository.getIssue(issueNumber);
            issuePreviewOpen = true;
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

<section class="flex h-full min-h-[20rem] w-full flex-col overflow-hidden">
    <div class="px-1 py-1">
        <div class="flex items-center justify-between gap-3">
            <h2
                class="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
            >
                Remote issues
            </h2>
            <Dialog.Root bind:open={createMissionOpen}>
                <Dialog.Trigger>
                    {#snippet child({ props })}
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            class="h-7 rounded-full px-2.5 text-xs text-muted-foreground"
                            {...props}
                        >
                            <Icon icon="lucide:plus" class="size-4" />
                            New mission
                        </Button>
                    {/snippet}
                </Dialog.Trigger>
                <Dialog.Content
                    class="min-h-[80dvh] overflow-hidden sm:max-w-3xl flex flex-col"
                >
                    <div class="border-b bg-muted/25 px-5 py-4">
                        <div class="min-w-0 space-y-3 pr-10">
                            <div
                                class="flex items-center gap-2 text-muted-foreground"
                            >
                                <Icon icon="lucide:plus" class="size-4" />
                                <p
                                    class="text-xs font-medium uppercase tracking-[0.16em]"
                                >
                                    Workflow
                                </p>
                            </div>
                            <Dialog.Title
                                class="text-lg font-semibold text-foreground"
                            >
                                Start from brief
                            </Dialog.Title>
                            <div class="flex min-w-0 items-center gap-3">
                                <Dialog.Description
                                    class="min-w-0 text-sm leading-6 text-muted-foreground"
                                >
                                    Create a new mission from an authored brief
                                    when the work is not tied to a tracked
                                    repository issue.
                                </Dialog.Description>
                            </div>
                        </div>
                    </div>

                    <BriefForm embedded />
                </Dialog.Content>
            </Dialog.Root>
        </div>
    </div>

    {#if issueError || remoteStartFromIssueError || repositoryIssueLoadError}
        <div class="px-1 pt-3">
            <p class="text-sm text-rose-600">
                {issueError ??
                    remoteStartFromIssueError ??
                    repositoryIssueLoadError}
            </p>
        </div>
    {/if}

    <ScrollArea class="min-h-0 flex-1">
        <div class="grid gap-3 px-1 pb-2 pt-1">
            {#if repositoryIssuesLoading}
                <div
                    class="rounded-none border border-dashed border-border/70 bg-background/35 px-4 py-6 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]"
                >
                    Loading tracked issues for this repository...
                </div>
            {:else if repositoryIssueLoadError}
                <div
                    class="rounded-none border border-dashed border-rose-300/60 bg-rose-50/60 px-4 py-6 text-sm text-rose-600 dark:border-rose-400/40 dark:bg-rose-950/20 dark:text-rose-300"
                >
                    {repositoryIssueLoadError}
                </div>
            {:else if repositoryIssues.length === 0}
                <div
                    class="rounded-none border border-dashed border-border/70 bg-background/35 px-4 py-6 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]"
                >
                    No tracked issues are available for this repository.
                </div>
            {:else}
                {#each repositoryIssues as issue, index (issue.number)}
                    <Issue
                        {issue}
                        cardIndex={index}
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
