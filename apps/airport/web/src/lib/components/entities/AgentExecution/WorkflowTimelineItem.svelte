<script lang="ts">
    import type { Artifact as ArtifactEntity } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import type { AgentExecutionDataType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";
    import TimelineItemFrame from "$lib/components/entities/AgentExecution/TimelineItemFrame.svelte";
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
        return timelineItemBodyText(item, itemTitle(item));
    }

    function detailText(item: TimelineItem): string | undefined {
        return timelineItemAuxDetailText(item, itemTitle(item));
    }
</script>

<TimelineItemFrame
    {item}
    {openArtifactIds}
    {onSelectArtifact}
    widthClass="w-full max-w-3xl"
    {itemToneClasses}
    {itemTitle}
>
    {#if contentText(item)}
        <p
            class="text-muted-foreground mt-1 whitespace-pre-wrap text-sm leading-6"
        >
            {contentText(item)}
        </p>
    {/if}
    {#if item.payload.result || item.payload.entity}
        <p class="mt-2 text-xs leading-5 text-slate-400">
            {#if item.payload.result}
                Result: {item.payload.result}
            {/if}
            {#if item.payload.entity}
                {item.payload.result ? " · " : ""}Entity: {item.payload.entity}
            {/if}
        </p>
    {/if}
    {#if detailText(item)}
        <p class="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-400">
            {detailText(item)}
        </p>
    {/if}
</TimelineItemFrame>
