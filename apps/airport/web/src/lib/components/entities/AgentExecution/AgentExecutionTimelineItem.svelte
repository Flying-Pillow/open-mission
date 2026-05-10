<script lang="ts">
    import type { Artifact as ArtifactEntity } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import type { AgentExecutionDataType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";
    import ActivityTimelineItem from "$lib/components/entities/AgentExecution/ActivityTimelineItem.svelte";
    import AttentionTimelineItem from "$lib/components/entities/AgentExecution/AttentionTimelineItem.svelte";
    import ArtifactTimelineItem from "$lib/components/entities/AgentExecution/ArtifactTimelineItem.svelte";
    import ConversationTimelineItem from "$lib/components/entities/AgentExecution/ConversationTimelineItem.svelte";
    import RuntimeTimelineItem from "$lib/components/entities/AgentExecution/RuntimeTimelineItem.svelte";
    import WorkflowTimelineItem from "$lib/components/entities/AgentExecution/WorkflowTimelineItem.svelte";

    type TimelineItem =
        AgentExecutionDataType["projection"]["timelineItems"][number];

    let {
        item,
        openArtifactIds = [],
        onSelectArtifact,
        itemAlignClasses,
        itemToneClasses,
        itemIconClasses,
        itemIcon,
        itemTitle,
        useChoice,
        currentActionTimelineItemId,
    }: {
        item: TimelineItem;
        openArtifactIds?: string[];
        onSelectArtifact: (artifact: ArtifactEntity) => void;
        itemAlignClasses: (item: TimelineItem) => string;
        itemToneClasses: (item: TimelineItem) => string;
        itemIconClasses: (item: TimelineItem) => string;
        itemIcon: (item: TimelineItem) => string;
        itemTitle: (item: TimelineItem) => string;
        useChoice: (value: string) => Promise<void>;
        currentActionTimelineItemId?: string;
    } = $props();

    const isCurrentActionItem = $derived(
        item.id === currentActionTimelineItemId,
    );
</script>

{#if item.behavior.class === "approval"}
    <AttentionTimelineItem
        {item}
        {openArtifactIds}
        {onSelectArtifact}
        {itemToneClasses}
        {itemIconClasses}
        {itemIcon}
        {itemTitle}
        {useChoice}
    />
{:else if item.behavior.class === "live-activity"}
    <ActivityTimelineItem
        {item}
        {openArtifactIds}
        {onSelectArtifact}
        {itemToneClasses}
        {itemIconClasses}
        {itemIcon}
        {itemTitle}
        active={isCurrentActionItem}
    />
{:else if item.behavior.class === "runtime-warning" || item.behavior.class === "terminal"}
    <RuntimeTimelineItem
        {item}
        {openArtifactIds}
        {onSelectArtifact}
        {itemToneClasses}
        {itemIconClasses}
        {itemIcon}
        {itemTitle}
    />
{:else if item.behavior.class === "artifact"}
    <ArtifactTimelineItem
        {item}
        {openArtifactIds}
        {onSelectArtifact}
        {itemToneClasses}
        {itemIconClasses}
        {itemIcon}
        {itemTitle}
    />
{:else if item.behavior.class === "timeline-event" || item.behavior.class === "replay-anchor"}
    <WorkflowTimelineItem
        {item}
        {openArtifactIds}
        {onSelectArtifact}
        {itemToneClasses}
        {itemIconClasses}
        {itemIcon}
        {itemTitle}
    />
{:else}
    <ConversationTimelineItem
        {item}
        {openArtifactIds}
        {onSelectArtifact}
        {itemToneClasses}
        {itemIconClasses}
        {itemIcon}
        {itemTitle}
    />
{/if}
