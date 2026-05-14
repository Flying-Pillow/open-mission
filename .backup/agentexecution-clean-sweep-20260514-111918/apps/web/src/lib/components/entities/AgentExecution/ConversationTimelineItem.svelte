<script lang="ts">
    import type { Artifact as ArtifactEntity } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import type { AgentExecutionDataType } from "@flying-pillow/open-mission-core/entities/AgentExecution/AgentExecutionSchema";
    import TimelineItemFrame from "$lib/components/entities/AgentExecution/TimelineItemFrame.svelte";
    import MarkdownViewer from "$lib/components/viewers/markdown.svelte";
    import {
        timelineItemAuxDetailText,
        timelineItemBodyText,
    } from "$lib/components/entities/AgentExecution/timelineItemText";

    type TimelineItem =
        AgentExecutionDataType["projection"]["timelineItems"][number];

    let {
        item,
        openArtifactIds = [],
        onSelectArtifact,
        itemToneClasses,
        itemIconClasses,
        itemIcon,
        itemTitle,
    }: {
        item: TimelineItem;
        openArtifactIds?: string[];
        onSelectArtifact: (artifact: ArtifactEntity) => void;
        itemToneClasses: (item: TimelineItem) => string;
        itemIconClasses: (item: TimelineItem) => string;
        itemIcon: (item: TimelineItem) => string;
        itemTitle: (item: TimelineItem) => string;
    } = $props();

    function contentText(item: TimelineItem): string | undefined {
        if (rendersMarkdown(item)) {
            const text = item.payload.text?.trim();
            return text && text.length > 0 ? text : undefined;
        }

        return timelineItemBodyText(item, itemTitle(item));
    }

    function detailText(item: TimelineItem): string | undefined {
        return timelineItemAuxDetailText(item, itemTitle(item));
    }

    function rendersMarkdown(item: TimelineItem): boolean {
        return item.primitive === "conversation.agent-message";
    }
</script>

<TimelineItemFrame
    {item}
    {openArtifactIds}
    {onSelectArtifact}
    widthClass="w-full max-w-[min(48rem,100%)]"
    {itemToneClasses}
    {itemTitle}
    headlineOverride={rendersMarkdown(item) ? itemTitle(item) : undefined}
>
    {@const content = contentText(item)}
    {#if content}
        {#if rendersMarkdown(item)}
            <div class="agent-response-markdown mt-1 text-muted-foreground">
                <MarkdownViewer source={content} compact />
            </div>
        {:else}
            <p
                class="text-muted-foreground mt-1 whitespace-pre-wrap text-sm leading-6"
            >
                {content}
            </p>
        {/if}
    {/if}
    {#if detailText(item)}
        <p class="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-400">
            {detailText(item)}
        </p>
    {/if}
</TimelineItemFrame>

<style>
    :global(.agent-response-markdown .markdown-body) {
        color: inherit;
        font-size: inherit;
    }

    :global(.agent-response-markdown .markdown-body > :first-child) {
        margin-top: 0;
    }

    :global(.agent-response-markdown .markdown-body > :last-child) {
        margin-bottom: 0;
    }
</style>
