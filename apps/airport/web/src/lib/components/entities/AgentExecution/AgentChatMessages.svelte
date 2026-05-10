<script lang="ts">
    import { untrack } from "svelte";
    import Icon from "@iconify/svelte";
    import { createVirtualizer } from "@tanstack/svelte-virtual";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import type { Artifact as ArtifactEntity } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import type { AgentExecutionDataType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";
    import AgentExecutionTimelineItem from "$lib/components/entities/AgentExecution/AgentExecutionTimelineItem.svelte";
    import * as Avatar from "$lib/components/ui/avatar/index.js";

    type TimelineItem =
        AgentExecutionDataType["projection"]["timelineItems"][number];
    let {
        items,
        viewport,
        refreshNonce,
        currentActionTimelineItemId,
        selectedArtifact,
        openArtifactIds = [],
        onSelectArtifact,
        itemAlignClasses,
        itemToneClasses,
        itemIconClasses,
        itemIcon,
        itemTitle,
        useChoice,
    }: {
        items: TimelineItem[];
        viewport: HTMLElement;
        refreshNonce: number;
        currentActionTimelineItemId?: string;
        selectedArtifact?: ArtifactEntity;
        openArtifactIds?: string[];
        onSelectArtifact: (artifact: ArtifactEntity) => void;
        itemAlignClasses: (item: TimelineItem) => string;
        itemToneClasses: (item: TimelineItem) => string;
        itemIconClasses: (item: TimelineItem) => string;
        itemIcon: (item: TimelineItem) => string;
        itemTitle: (item: TimelineItem) => string;
        useChoice: (value: string) => Promise<void>;
    } = $props();

    const appContext = getAppContext();
    const githubAuthenticated = $derived(
        appContext.githubStatus === "connected",
    );
    const operatorAvatarUrl = $derived(appContext.user?.avatarUrl?.trim());
    const operatorDisplayName = $derived(
        appContext.user?.name?.trim() || "You",
    );
    const operatorInitials = $derived.by(
        () =>
            operatorDisplayName
                .split(/[^A-Za-z0-9]+/u)
                .filter((segment) => segment.length > 0)
                .slice(0, 2)
                .map((segment) => segment[0]?.toUpperCase() ?? "")
                .join("") || "Y",
    );

    const initialMessageCount = untrack(() => items.length);
    const messageVirtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
        count: initialMessageCount,
        getScrollElement: () => viewport,
        estimateSize: () => 128,
        getItemKey: (index) => items[index]?.id ?? index,
        overscan: 6,
    });

    function getVirtualizer() {
        return untrack(() => $messageVirtualizer);
    }

    let previousItemCount = $state(initialMessageCount);
    let lastSelectedArtifactId = $state<string | undefined>(undefined);

    $effect(() => {
        getVirtualizer().setOptions({
            count: items.length,
            getItemKey: (index) => items[index]?.id ?? index,
        });
    });

    $effect(() => {
        const nextCount = items.length;
        if (nextCount <= previousItemCount || !viewport) {
            previousItemCount = nextCount;
            return;
        }

        const distanceFromBottom =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        previousItemCount = nextCount;
        if (distanceFromBottom > 240) {
            return;
        }

        queueMicrotask(() => {
            getVirtualizer().scrollToIndex(nextCount - 1, {
                align: "end",
            });
        });
    });

    $effect(() => {
        const selectedArtifactId = selectedArtifact?.id;
        if (
            !viewport ||
            !selectedArtifactId ||
            selectedArtifactId === lastSelectedArtifactId
        ) {
            return;
        }

        const selectedItemIndex = items.findIndex((item) =>
            itemContainsArtifact(item, selectedArtifact),
        );
        if (selectedItemIndex === -1) {
            return;
        }

        lastSelectedArtifactId = selectedArtifactId;
        queueMicrotask(() => {
            getVirtualizer().scrollToIndex(selectedItemIndex, {
                align: "center",
            });
        });
    });

    $effect(() => {
        if (selectedArtifact) {
            return;
        }

        lastSelectedArtifactId = undefined;
    });

    function measureMessageElement(node: HTMLDivElement): {
        update: () => void;
        destroy: () => void;
    } {
        const measure = () => {
            getVirtualizer().measureElement(node);
        };
        const resizeObserver = new ResizeObserver(() => {
            measure();
        });

        measure();
        resizeObserver.observe(node);

        return {
            update: () => {
                measure();
            },
            destroy: () => {
                resizeObserver.disconnect();
            },
        };
    }

    function normalizePath(value: string): string {
        return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    }

    function itemArtifactReferences(
        item: TimelineItem,
    ): NonNullable<TimelineItem["payload"]["artifacts"]> {
        if (item.payload.artifacts && item.payload.artifacts.length > 0) {
            return item.payload.artifacts;
        }

        if (item.payload.artifactId || item.payload.path) {
            return [
                {
                    ...(item.payload.artifactId
                        ? { artifactId: item.payload.artifactId }
                        : {}),
                    ...(item.payload.path ? { path: item.payload.path } : {}),
                },
            ];
        }

        return [];
    }

    function itemContainsArtifact(
        item: TimelineItem,
        artifact: ArtifactEntity | undefined,
    ): boolean {
        if (!artifact) {
            return false;
        }

        const artifactPaths = [
            artifact.relativePath,
            artifact.filePath,
            artifact.fileName,
        ]
            .filter((candidate): candidate is string => Boolean(candidate))
            .map(normalizePath);

        return itemArtifactReferences(item).some((reference) => {
            if (reference.artifactId && reference.artifactId === artifact.id) {
                return true;
            }

            const referencePath = reference.path
                ? normalizePath(reference.path)
                : undefined;
            if (!referencePath) {
                return false;
            }

            return artifactPaths.some(
                (artifactPath) =>
                    artifactPath === referencePath ||
                    artifactPath.endsWith(`/${referencePath}`) ||
                    referencePath.endsWith(`/${artifactPath}`),
            );
        });
    }
</script>

<div
    class="relative w-full"
    style={`height: ${$messageVirtualizer.getTotalSize()}px;`}
>
    {#each $messageVirtualizer.getVirtualItems() as virtualMessage (virtualMessage.key)}
        {@const item = items[virtualMessage.index]}
        {@const isCurrentActionItem = item?.id === currentActionTimelineItemId}
        <div
            data-index={virtualMessage.index}
            class="absolute left-0 top-0 w-full px-2 pb-5"
            style={`transform: translateY(${virtualMessage.start}px);`}
            use:measureMessageElement
        >
            {#if item}
                {@const isOperatorMessage =
                    item.primitive === "conversation.operator-message"}
                <div class="flex items-start gap-3">
                    <div class="relative shrink-0 self-stretch">
                        <div
                            class="absolute bottom-[-1.4rem] left-1/2 top-0 w-px -translate-x-1/2 bg-white/22 shadow-[0_0_10px_rgba(255,255,255,0.08)]"
                        ></div>
                        {#if isOperatorMessage && githubAuthenticated}
                            <Avatar.Root class="ring-1 ring-black/15">
                                {#if operatorAvatarUrl}
                                    <Avatar.Image
                                        src={operatorAvatarUrl}
                                        alt={operatorDisplayName}
                                    />
                                {/if}
                                <Avatar.Fallback>
                                    {operatorInitials}
                                </Avatar.Fallback>
                            </Avatar.Root>
                        {:else}
                            <span
                                class={`relative inline-flex size-8 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/15 ${itemIconClasses(item)} ${isCurrentActionItem ? "agent-current-action-icon" : ""}`}
                            >
                                {#if isCurrentActionItem}
                                    <span
                                        class="agent-current-action-icon__aura"
                                        aria-hidden="true"
                                    ></span>
                                {/if}
                                <Icon
                                    icon={itemIcon(item)}
                                    class={`relative z-10 size-4 ${isCurrentActionItem ? "agent-current-action-icon__glyph" : ""}`}
                                />
                            </span>
                        {/if}
                    </div>
                    <div class={`min-w-0 flex-1 ${itemAlignClasses(item)}`}>
                        <AgentExecutionTimelineItem
                            {item}
                            {openArtifactIds}
                            {onSelectArtifact}
                            {itemAlignClasses}
                            {itemToneClasses}
                            {itemIconClasses}
                            {itemIcon}
                            {itemTitle}
                            {useChoice}
                            {currentActionTimelineItemId}
                        />
                    </div>
                </div>
            {/if}
        </div>
    {/each}
</div>

<style>
    :global(.agent-current-action-icon) {
        box-shadow:
            0 0 0 1px color-mix(in oklch, var(--primary) 34%, transparent),
            0 0 24px color-mix(in oklch, var(--secondary) 22%, transparent);
    }

    :global(.agent-current-action-icon__aura) {
        position: absolute;
        inset: -45%;
        background: conic-gradient(
            from 0deg,
            transparent,
            color-mix(in oklch, var(--primary) 58%, transparent),
            color-mix(in oklch, var(--secondary) 50%, transparent),
            transparent 72%
        );
        opacity: 0.85;
        animation: agent-current-action-orbit 3.6s linear infinite;
    }

    :global(.agent-current-action-icon::after) {
        content: "";
        position: absolute;
        inset: 2px;
        border-radius: inherit;
        background: rgb(8 9 11 / 0.86);
    }

    :global(.agent-current-action-icon__glyph) {
        filter: drop-shadow(
            0 0 8px color-mix(in oklch, var(--secondary) 55%, transparent)
        );
        animation: agent-current-action-breathe 1.9s ease-in-out infinite;
    }

    @keyframes agent-current-action-orbit {
        to {
            transform: rotate(1turn);
        }
    }

    @keyframes agent-current-action-breathe {
        50% {
            transform: scale(1.08);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        :global(.agent-current-action-icon__aura),
        :global(.agent-current-action-icon__glyph) {
            animation: none;
        }
    }
</style>
