<script lang="ts">
    import BrandGithubIcon from "@tabler/icons-svelte/icons/brand-github";
    import PlusIcon from "@tabler/icons-svelte/icons/plus";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import BriefForm from "$lib/components/entities/Brief/BriefForm.svelte";
    import { getScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
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
    const repositoryScope = getScopedRepositoryContext();
    const activeRepository = $derived.by(() => {
        const repository = repositoryScope.repository;
        if (!repository) {
            throw new Error("Issue list requires a scoped repository context.");
        }

        return repository;
    });

    let remoteStartFromIssueError = $state<string | null>(null);
    let createMissionOpen = $state(false);
    const repositoryIssuesQuery = $derived(activeRepository.listIssuesQuery());
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
            selectedIssue = await activeRepository.getIssue(issueNumber);
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

<section
    class="flex h-full min-h-[24rem] w-full flex-col overflow-hidden rounded-lg border bg-card shadow-sm"
>
    <div class="border-b bg-muted/25 px-5 py-4">
        <div class="min-w-0 space-y-3">
            <div class="flex items-center gap-2 text-muted-foreground">
                <BrandGithubIcon class="size-4" />
                <p class="text-xs font-medium uppercase tracking-[0.16em]">
                    GitHub
                </p>
            </div>
            <h2 class="text-lg font-semibold text-foreground">
                Start from issue
            </h2>
            <div
                class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
                <div class="flex min-w-0 items-center gap-3">
                    <p class="min-w-0 text-sm leading-6 text-muted-foreground">
                        Turn a tracked repository issue into a new mission with
                        one step.
                    </p>
                    <Badge variant="secondary">
                        {repositoryIssuesLoading
                            ? "Loading issues..."
                            : repositoryIssues.length === 1
                              ? "1 open issue"
                              : `${repositoryIssues.length} open issues`}
                    </Badge>
                </div>
                <Dialog.Root bind:open={createMissionOpen}>
                    <Dialog.Trigger>
                        {#snippet child({ props })}
                            <Button type="button" size="sm" {...props}>
                                <PlusIcon class="size-4" />
                                New issue
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
                                    <PlusIcon class="size-4" />
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
                                        Create a new mission from an authored
                                        brief when the work is not tied to a
                                        tracked repository issue.
                                    </Dialog.Description>
                                </div>
                            </div>
                        </div>

                        <BriefForm embedded />
                    </Dialog.Content>
                </Dialog.Root>
            </div>
        </div>
    </div>

    {#if issueError || remoteStartFromIssueError || repositoryIssueLoadError}
        <div class="px-4 pt-4">
            <p class="text-sm text-rose-600">
                {issueError ??
                    remoteStartFromIssueError ??
                    repositoryIssueLoadError}
            </p>
        </div>
    {/if}

    <ScrollArea class="min-h-0 flex-1">
        <div class="grid gap-3 p-4">
            {#if repositoryIssuesLoading}
                <div
                    class="rounded-lg border border-dashed bg-background px-4 py-8 text-sm text-muted-foreground"
                >
                    Loading tracked issues for this repository...
                </div>
            {:else if repositoryIssueLoadError}
                <div
                    class="rounded-lg border border-dashed bg-background px-4 py-8 text-sm text-rose-600"
                >
                    {repositoryIssueLoadError}
                </div>
            {:else if repositoryIssues.length === 0}
                <div
                    class="rounded-lg border border-dashed bg-background px-4 py-8 text-sm text-muted-foreground"
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
