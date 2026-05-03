<script lang="ts">
    import type { MissionTowerTreeNode } from "@flying-pillow/mission-core/types";

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
            case "active":
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
            case "panicked":
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

    function connectorFillOpacity(index: number): number {
        if (currentStageIndex === -1) {
            return 0.18;
        }

        if (index < currentStageIndex) {
            return 1;
        }

        if (index === currentStageIndex) {
            return 0.45;
        }

        return 0.18;
    }

    function connectorFillWidth(index: number): string {
        if (currentStageIndex === -1) {
            return "0%";
        }

        if (index < currentStageIndex) {
            return "100%";
        }

        if (index === currentStageIndex) {
            return "55%";
        }

        return "0%";
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

<div class="min-h-0 overflow-x-hidden pb-2">
    {#if stageNodes.length === 0}
        <div
            class="rounded-xl border border-dashed bg-background/60 px-4 py-8 text-sm text-muted-foreground"
        >
            Mission cockpit is waiting for the control view.
        </div>
    {:else}
        <div class="relative w-full px-1 py-2">
            <div
                class="mb-4 grid w-full gap-0"
                style={`grid-template-columns: repeat(${stageNodes.length}, minmax(0, 1fr));`}
            >
                {#each stageNodes as stage (stage.id)}
                    <div class="px-2 text-center">
                        <p
                            class={`text-sm font-medium transition-colors ${stageTextClass(stage.id)}`}
                        >
                            {stage.label}
                        </p>
                        <p class="mt-1 text-xs text-muted-foreground">
                            {stageStatusLabel(stage)}
                        </p>
                    </div>
                {/each}
            </div>

            {#if stageNodes.length > 0}
                <div class="pointer-events-none relative mx-[0.625rem] h-5">
                    {#each stageNodes as stage, index (stage.id)}
                        <span
                            class="absolute top-1/2 block h-1 -translate-y-1/2 rounded-full"
                            style={`left: ${endpointPosition(index)}%; width: ${endpointPosition(index + 1) - endpointPosition(index)}%; background-color: ${stageColor(stage)}; opacity: 0.18;`}
                        >
                            <span
                                class="block h-full rounded-full transition-all"
                                style={`width: ${connectorFillWidth(index)}; background-color: ${stageColor(stage)}; opacity: ${connectorFillOpacity(index)};`}
                            ></span>
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
                class="absolute inset-x-0 top-0 grid gap-0"
                style={`grid-template-columns: repeat(${stageNodes.length}, minmax(0, 1fr));`}
            >
                {#each stageNodes as stage (stage.id)}
                    <button
                        type="button"
                        class="group flex h-[5.25rem] w-full flex-col items-center text-center"
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
