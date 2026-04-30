<script lang="ts">
    import type { GitHubIssueDetailType } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import ExternalLinkIcon from "@tabler/icons-svelte/icons/external-link";
    import PlayerPlayIcon from "@tabler/icons-svelte/icons/player-play";
    import XIcon from "@tabler/icons-svelte/icons/x";
    import { enhance } from "$app/forms";
    import { onMount, type Component } from "svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    let {
        selectedIssue,
        onClose,
        embedded = false,
    }: {
        selectedIssue: GitHubIssueDetailType;
        onClose: () => void;
        embedded?: boolean;
    } = $props();

    let MarkdownViewer = $state<Component<{ source: string }> | null>(null);

    onMount(async () => {
        MarkdownViewer = (
            await import("$lib/components/viewers/markdown.svelte")
        ).default;
    });
</script>

<section
    class={embedded
        ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden"
        : "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"}
>
    <div class="border-b bg-muted/25 px-5 py-4">
        <div class="min-w-0 space-y-3">
            <div class="flex items-center gap-2 text-muted-foreground">
                <ExternalLinkIcon class="size-4" />
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
                            <ExternalLinkIcon class="size-4" />
                            Open on GitHub
                        </Button>
                    {/if}
                    <form method="POST" action="?/startFromIssue" use:enhance>
                        <input
                            type="hidden"
                            name="issueNumber"
                            value={selectedIssue.number}
                        />
                        <Button type="submit">
                            <PlayerPlayIcon class="size-4" />
                            Start mission
                        </Button>
                    </form>
                    <Button
                        type="button"
                        variant="ghost"
                        onclick={onClose}
                        aria-label="Close issue preview"
                        title="Close issue preview"
                    >
                        <XIcon class="size-4" />
                        Close
                    </Button>
                </div>
            </div>
        </div>
    </div>

    <ScrollArea class="min-h-0 flex-1 overflow-hidden bg-background/70">
        <div class="px-4 py-4">
            {#if MarkdownViewer}
                <MarkdownViewer source={selectedIssue.body} />
            {/if}
        </div>
    </ScrollArea>
</section>
