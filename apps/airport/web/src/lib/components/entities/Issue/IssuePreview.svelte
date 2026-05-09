<script lang="ts">
    import type { RepositoryIssueDetailType } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import Icon from "@iconify/svelte";
    import { goto } from "$app/navigation";
    import { onMount, type Component } from "svelte";
    import { getScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    let {
        selectedIssue,
        onClose,
        embedded = false,
    }: {
        selectedIssue: RepositoryIssueDetailType;
        onClose: () => void;
        embedded?: boolean;
    } = $props();

    let MarkdownViewer = $state<Component<{ source: string }> | null>(null);
    const repositoryScope = getScopedRepositoryContext();
    const activeRepository = $derived(repositoryScope.repository);
    const canStartMission = $derived(
        Boolean(activeRepository?.data.isInitialized),
    );
    let missionCreationPending = $state(false);
    let startError = $state<string | null>(null);

    onMount(async () => {
        MarkdownViewer = (
            await import("$lib/components/viewers/markdown.svelte")
        ).default;
    });

    async function startFromIssue(): Promise<void> {
        startError = null;
        if (!activeRepository) {
            startError =
                "Repository context is unavailable until the repository route is loaded.";
            return;
        }
        if (!canStartMission) {
            startError =
                "Complete Repository initialization before starting regular missions.";
            return;
        }
        missionCreationPending = true;
        try {
            const result = await activeRepository.startMissionFromIssue(
                selectedIssue.number,
            );
            await goto(result.redirectTo);
        } catch (error) {
            startError = error instanceof Error ? error.message : String(error);
        } finally {
            missionCreationPending = false;
        }
    }
</script>

<section
    class={embedded
        ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden"
        : "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"}
>
    <div class="border-b bg-muted/25 px-5 py-4">
        <div class="min-w-0 space-y-3">
            <div class="flex items-center gap-2 text-muted-foreground">
                <Icon icon="lucide:external-link" class="size-4" />
                <p class="text-xs font-medium uppercase tracking-[0.16em]">
                    GitHub
                </p>
            </div>
            <h2 class="text-lg font-semibold text-foreground">
                Issue #{selectedIssue.number}
            </h2>
            <div
                class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
                <div class="flex min-w-0 flex-wrap items-center gap-3">
                    <p class="min-w-0 text-sm leading-6 text-muted-foreground">
                        {selectedIssue.title}
                    </p>
                    <Badge variant="secondary">
                        Updated: {selectedIssue.updatedAt ?? "Unknown"}
                    </Badge>
                    {#each selectedIssue.labels as label (`issue-label:${selectedIssue.number}:${label}`)}
                        <Badge variant="secondary">{label}</Badge>
                    {/each}
                    {#each selectedIssue.assignees as assignee (`issue-assignee:${selectedIssue.number}:${assignee}`)}
                        <Badge variant="outline">@{assignee}</Badge>
                    {/each}
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    {#if selectedIssue.url}
                        <Button
                            href={selectedIssue.url}
                            target="_blank"
                            rel="noreferrer"
                            variant="outline"
                        >
                            <Icon icon="lucide:external-link" class="size-4" />
                            Open on GitHub
                        </Button>
                    {/if}
                    <Button
                        type="button"
                        onclick={() => void startFromIssue()}
                        disabled={missionCreationPending || !canStartMission}
                        title={canStartMission
                            ? "Start mission"
                            : "Repository initialization required"}
                    >
                        <Icon icon="lucide:play" class="size-4" />
                        {missionCreationPending
                            ? "Starting..."
                            : "Start mission"}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        onclick={onClose}
                        aria-label="Close issue preview"
                        title="Close issue preview"
                    >
                        <Icon icon="lucide:x" class="size-4" />
                        Close
                    </Button>
                </div>
            </div>
        </div>
    </div>

    <ScrollArea class="min-h-0 flex-1 overflow-hidden bg-background/70">
        {#if startError}
            <div class="border-b px-4 py-3 text-sm text-rose-600">
                {startError}
            </div>
        {/if}
        <div class="px-4 py-4">
            {#if MarkdownViewer}
                <MarkdownViewer source={selectedIssue.body} />
            {/if}
        </div>
    </ScrollArea>
</section>
