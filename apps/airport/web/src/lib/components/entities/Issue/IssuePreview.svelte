<script lang="ts">
    import ExternalLinkIcon from "@tabler/icons-svelte/icons/external-link";
    import PlayerPlayIcon from "@tabler/icons-svelte/icons/player-play";
    import XIcon from "@tabler/icons-svelte/icons/x";
    import { enhance } from "$app/forms";
    import type { Component } from "svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import type { SelectedIssueSummary } from "$lib/components/entities/types";

    let {
        selectedIssue,
        MarkdownViewer,
        onClose,
    }: {
        selectedIssue: SelectedIssueSummary;
        MarkdownViewer: Component<{ source: string }> | null;
        onClose: () => void;
    } = $props();
</script>

<section
    class="flex min-h-0 flex-1 flex-col rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
>
    <div class="flex items-start justify-between gap-4">
        <div>
            <p
                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
                GitHub issue
            </p>
            <h2 class="mt-2 text-lg font-semibold text-foreground">
                #{selectedIssue.number}
                {selectedIssue.title}
            </h2>
            <p class="mt-1 text-sm text-muted-foreground">
                Updated: {selectedIssue.updatedAt ?? "Unknown"}
            </p>
        </div>
        <div class="flex items-center gap-2">
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

    <div class="mt-3 flex flex-wrap gap-2">
        {#each selectedIssue.labels as label (`issue-label:${selectedIssue.number}:${label}`)}
            <Badge variant="secondary">{label}</Badge>
        {/each}
        {#each selectedIssue.assignees as assignee (`issue-assignee:${selectedIssue.number}:${assignee}`)}
            <Badge variant="outline">@{assignee}</Badge>
        {/each}
    </div>

    <ScrollArea class="mt-4 min-h-0 flex-1 rounded-xl border bg-background/70">
        <div class="px-4 py-4">
            {#if MarkdownViewer}
                <MarkdownViewer source={selectedIssue.body} />
            {/if}
        </div>
    </ScrollArea>
</section>
