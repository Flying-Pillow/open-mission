<script lang="ts">
    import type { MissionTowerTreeNode } from "@flying-pillow/mission-core/entities/Mission/MissionSchema";
    import { Badge } from "$lib/components/ui/badge";

    type MissionCockpitSelectionState = {
        treeNodes: MissionTowerTreeNode[];
        selectedNodeId?: string;
    };

    let {
        selectionState,
        currentStageId,
        onSelectNode,
    }: {
        selectionState: MissionCockpitSelectionState;
        currentStageId?: string;
        onSelectNode: (nodeId: string) => void;
    } = $props();

    const stageNodes = $derived(
        selectionState.treeNodes.filter((node) => node.kind === "stage"),
    );
    const currentStageIndex = $derived(
        stageNodes.findIndex((node) => node.stageId === currentStageId),
    );
    const taskNodes = $derived(
        selectionState.treeNodes.filter((node) => node.kind === "task"),
    );

    function isSelected(nodeId: string): boolean {
        return selectionState.selectedNodeId === nodeId;
    }

    function stageStatusLabel(node: MissionTowerTreeNode): string {
        if (node.stageId === currentStageId) {
            return "Current";
        }

        return node.statusLabel ?? "Pending";
    }

    function normalizeStatusLabel(statusLabel: string | undefined): string {
        return statusLabel?.trim().toLowerCase() ?? "";
    }

    function statusColor(statusLabel: string | undefined): string {
        switch (normalizeStatusLabel(statusLabel)) {
            case "running":
                return "#0ea5e9";
            case "ready":
            case "queued":
            case "starting":
            case "awaiting input":
                return "#f59e0b";
            case "completed":
            case "delivered":
                return "#10b981";
            case "failed":
                return "#ef4444";
            case "cancelled":
            case "terminated":
            case "paused":
                return "#94a3b8";
            case "pending":
            case "draft":
            default:
                return "#8b949e";
        }
    }

    function stageColor(node: MissionTowerTreeNode): string {
        return statusColor(node.statusLabel);
    }

    function stageBadgeBackground(node: MissionTowerTreeNode): string {
        return `${stageColor(node)}4d`;
    }

    function stageTrackBackground(node: MissionTowerTreeNode): string {
        return `${stageColor(node)}1f`;
    }

    function isCompletedTask(node: MissionTowerTreeNode): boolean {
        const statusLabel = normalizeStatusLabel(node.statusLabel);
        return statusLabel === "completed" || statusLabel === "delivered";
    }

    function stageProgressPercent(stage: MissionTowerTreeNode): number {
        const stageTasks = taskNodes.filter(
            (task) => task.stageId === stage.stageId,
        );
        if (stageTasks.length === 0) {
            return isCompletedTask(stage) ? 100 : 0;
        }

        const completedTaskCount = stageTasks.filter(isCompletedTask).length;
        return (completedTaskCount / stageTasks.length) * 100;
    }

    function stageProgressBackground(stage: MissionTowerTreeNode): string {
        const progress = stageProgressPercent(stage);
        const gradientMargin = 10;
        const gradientStart = Math.max(0, progress - gradientMargin);
        const gradientEnd = Math.min(100, progress + gradientMargin);
        const progressColor = stageBadgeBackground(stage);
        const trackColor = stageTrackBackground(stage);

        if (progress <= 0) {
            return trackColor;
        }

        if (progress >= 100) {
            return progressColor;
        }

        return `linear-gradient(90deg, ${progressColor} 0%, ${progressColor} ${gradientStart}%, ${trackColor} ${gradientEnd}%, ${trackColor} 100%)`;
    }

    function stageTextClass(nodeId: string): string {
        return isSelected(nodeId)
            ? "text-foreground"
            : "text-foreground/90 group-hover:text-foreground";
    }

    function endpointPosition(index: number): number {
        if (stageNodes.length <= 0) {
            return 50;
        }

        return (index / stageNodes.length) * 100;
    }

    function endpointColor(index: number): string {
        if (stageNodes.length === 0) {
            return "hsl(var(--border))";
        }

        const node = stageNodes[Math.min(index, stageNodes.length - 1)];
        return stageColor(node);
    }

    function endpointFilled(index: number): boolean {
        if (currentStageIndex === -1) {
            return index === 0;
        }

        return index <= currentStageIndex;
    }
</script>

<div class="h-12 min-h-0 overflow-hidden p-2">
    {#if stageNodes.length === 0}
        <div
            class="flex h-full items-center border border-dashed bg-background/60 text-sm text-muted-foreground"
        >
            Mission cockpit is waiting for the control view.
        </div>
    {:else}
        <div class="relative h-full w-full overflow-hidden">
            {#if stageNodes.length > 0}
                <div class="pointer-events-none relative mx-[0.625rem] h-full">
                    {#each stageNodes as stage, index (stage.id)}
                        <span
                            class="absolute top-1/2 block h-6 -translate-y-1/2"
                            style={`left: ${endpointPosition(index)}%; width: ${endpointPosition(index + 1) - endpointPosition(index)}%;`}
                        >
                            <span
                                class="absolute top-1/2 block h-1 w-full -translate-y-1/2"
                                style={`background: ${stageProgressBackground(stage)};`}
                            ></span>
                            <span
                                class={`absolute inset-0 z-20 flex items-center justify-center px-1 text-center text-sm font-medium leading-none transition-colors ${stageTextClass(stage.id)}`}
                            >
                                <Badge
                                    variant="outline"
                                    class="max-w-full overflow-hidden rounded-full border bg-background px-2 text-xs font-semibold shadow-sm"
                                    style={`border-color: ${stageColor(stage)}; color: ${stageColor(stage)};`}
                                    title={`${stage.label}: ${stageStatusLabel(stage)}`}
                                >
                                    <span class="truncate">{stage.label}</span>
                                </Badge>
                            </span>
                        </span>
                    {/each}

                    {#each Array(stageNodes.length + 1) as _, index (`endpoint-${index}`)}
                        <span
                            class="absolute top-1/2 z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors"
                            style={`left: ${endpointPosition(index)}%; border-color: ${endpointColor(index)}; background-color: ${endpointFilled(index) ? endpointColor(index) : "transparent"};`}
                        ></span>
                    {/each}
                </div>
            {/if}

            <div
                class="absolute inset-0 grid gap-0"
                style={`grid-template-columns: repeat(${stageNodes.length}, minmax(0, 1fr));`}
            >
                {#each stageNodes as stage (stage.id)}
                    <button
                        type="button"
                        class="group flex h-full w-full flex-col items-center text-center"
                        onclick={() => onSelectNode(stage.id)}
                    >
                        <span class="sr-only">
                            {stage.label}
                        </span>
                    </button>
                {/each}
            </div>
        </div>
    {/if}
</div>
