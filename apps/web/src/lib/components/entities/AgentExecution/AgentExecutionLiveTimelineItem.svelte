<script lang="ts">
    import type { Artifact as ArtifactEntity } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import type { AgentExecutionDataType } from "@flying-pillow/open-mission-core/entities/AgentExecution/AgentExecutionSchema";
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
    {#if item.payload.transport || item.payload.diagnosticCode || item.payload.connected !== undefined}
        <p class="mt-3 text-xs leading-5 text-slate-400">
            {#if item.payload.transport}
                Transport: {item.payload.transport}
            {/if}
            {#if item.payload.diagnosticCode}
                {item.payload.transport ? " · " : ""}Diagnostic: {item.payload
                    .diagnosticCode}
            {/if}
            {#if item.payload.connected !== undefined}
                {item.payload.transport || item.payload.diagnosticCode
                    ? " · "
                    : ""}{item.payload.connected ? "Connected" : "Disconnected"}
            {/if}
        </p>
    {/if}
    {#if detailText(item)}
        <p
            class="mt-4 whitespace-pre-wrap border-t border-white/10 pt-4 text-xs leading-5 text-slate-300"
        >
            {detailText(item)}
        </p>
    {/if}
</TimelineItemFrame>
