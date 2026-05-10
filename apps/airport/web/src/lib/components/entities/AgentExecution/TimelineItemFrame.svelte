<script lang="ts">
    import type { Snippet } from "svelte";
    import { shimmerThinking } from "$lib/actions/shimmer";
    import type { Artifact as ArtifactEntity } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import type { AgentExecutionDataType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";
    import AgentExecutionArtifactReferences from "$lib/components/entities/AgentExecution/AgentExecutionArtifactReferences.svelte";
    import { timelineItemHeadline } from "$lib/components/entities/AgentExecution/timelineItemText";

    type TimelineItem =
        AgentExecutionDataType["projection"]["timelineItems"][number];

    let {
        item,
        openArtifactIds = [],
        onSelectArtifact,
        itemToneClasses,
        itemTitle,
        headlineOverride,
        widthClass,
        active = false,
        children,
    }: {
        item: TimelineItem;
        openArtifactIds?: string[];
        onSelectArtifact: (artifact: ArtifactEntity) => void;
        itemToneClasses: (item: TimelineItem) => string;
        itemTitle: (item: TimelineItem) => string;
        headlineOverride?: string;
        widthClass: string;
        active?: boolean;
        children?: Snippet;
    } = $props();

    function headline(item: TimelineItem): string {
        if (headlineOverride) {
            return headlineOverride;
        }

        return timelineItemHeadline(item, itemTitle(item));
    }

    function formatTimestamp(value: string): string {
        const timestamp = new Date(value);
        if (Number.isNaN(timestamp.getTime())) {
            return value;
        }

        return new Intl.DateTimeFormat("en", {
            hour: "numeric",
            minute: "2-digit",
        }).format(timestamp);
    }
</script>

<div class={`${widthClass}`}>
    <div class="pb-0.5">
        <div
            class="grid min-h-8 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-3"
        >
            <span class="w-14 shrink-0 text-right text-xs text-slate-500">
                {formatTimestamp(item.occurredAt)}
            </span>
            <p
                class={`min-w-0 flex-1 truncate text-sm font-medium ${active ? "text-muted-foreground" : "text-slate-100"}`}
            >
                <span use:shimmerThinking={{ disabled: !active, speed: 2.45 }}>
                    {headline(item)}
                </span>
            </p>
        </div>
    </div>

    <div class="ml-[4.25rem]">
        <article
            class={`rounded-[1.15rem] ${itemToneClasses(item)} bg-transparent`}
        >
            {@render children?.()}
            <AgentExecutionArtifactReferences
                {item}
                {openArtifactIds}
                {onSelectArtifact}
            />
        </article>
    </div>
</div>
