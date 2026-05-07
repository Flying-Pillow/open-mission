<script lang="ts">
    import type { Mission } from "$lib/components/entities/Mission/Mission.svelte.js";
    import type { Stage } from "$lib/components/entities/Stage/Stage.svelte.js";
    import type { Task } from "$lib/components/entities/Task/Task.svelte.js";
    import { Badge } from "$lib/components/ui/badge";

    let {
        mission,
        currentStageId,
        selectedFocusId,
        onSelectFocus,
    }: {
        mission?: Mission;
        currentStageId?: string;
        selectedFocusId?: string;
        onSelectFocus: (focusId: string) => void;
    } = $props();

    const stages = $derived(mission?.listStages() ?? []);
    const currentStageIndex = $derived(
        stages.findIndex((stage) => stage.stageId === currentStageId),
    );

    function stageFocusId(stageId: string): string {
        return `stage:${stageId}`;
    }

    function isSelected(stageId: string): boolean {
        return selectedFocusId === stageFocusId(stageId);
    }

    function stageStatusLabel(stage: Stage): string {
        if (stage.stageId === currentStageId) {
            return "Current";
        }

        return stage.lifecycle;
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

    function stageColor(stage: Stage): string {
        return statusColor(stage.lifecycle);
    }

    function stageBadgeBackground(stage: Stage): string {
        return `${stageColor(stage)}4d`;
    }

    function stageTrackBackground(stage: Stage): string {
        return `${stageColor(stage)}1f`;
    }

    function isCompletedTask(task: Task): boolean {
        const statusLabel = normalizeStatusLabel(task.lifecycle);
        return statusLabel === "completed" || statusLabel === "delivered";
    }

    function stageProgressPercent(stage: Stage): number {
        const tasks = stage.listTasks();
        if (tasks.length === 0) {
            return normalizeStatusLabel(stage.lifecycle) === "completed"
                ? 100
                : 0;
        }

        const completedTaskCount = tasks.filter(isCompletedTask).length;
        return (completedTaskCount / tasks.length) * 100;
    }

    function stageProgressBackground(stage: Stage): string {
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

    function stageTextClass(stageId: string): string {
        return isSelected(stageId)
            ? "text-foreground"
            : "text-foreground/90 group-hover:text-foreground";
    }

    function endpointPosition(index: number): number {
        if (stages.length <= 0) {
            return 50;
        }

        return (index / stages.length) * 100;
    }

    function endpointColor(index: number): string {
        if (stages.length === 0) {
            return "hsl(var(--border))";
        }

        const stage = stages[Math.min(index, stages.length - 1)];
        return stageColor(stage);
    }

    function endpointFilled(index: number): boolean {
        if (currentStageIndex === -1) {
            return index === 0;
        }

        return index <= currentStageIndex;
    }
</script>

<div class="h-12 min-h-0 overflow-hidden p-2">
    {#if stages.length === 0}
        <div
            class="flex h-full items-center border border-dashed bg-background/60 text-sm text-muted-foreground"
        >
            Mission cockpit is waiting for the control view.
        </div>
    {:else}
        <div class="relative h-full w-full overflow-hidden">
            <div class="pointer-events-none relative mx-[0.625rem] h-full">
                {#each stages as stage, index (stage.stageId)}
                    <span
                        class="absolute top-1/2 block h-6 -translate-y-1/2"
                        style={`left: ${endpointPosition(index)}%; width: ${endpointPosition(index + 1) - endpointPosition(index)}%;`}
                    >
                        <span
                            class="absolute top-1/2 block h-1 w-full -translate-y-1/2"
                            style={`background: ${stageProgressBackground(stage)};`}
                        ></span>
                        <span
                            class={`absolute inset-0 z-20 flex items-center justify-center px-1 text-center text-sm font-medium leading-none transition-colors ${stageTextClass(stage.stageId)}`}
                        >
                            <Badge
                                variant="outline"
                                class="max-w-full overflow-hidden rounded-full border bg-background px-2 text-xs font-semibold shadow-sm"
                                style={`border-color: ${stageColor(stage)}; color: ${stageColor(stage)};`}
                                title={`${stage.stageId}: ${stageStatusLabel(stage)}`}
                            >
                                <span class="truncate">{stage.stageId}</span>
                            </Badge>
                        </span>
                    </span>
                {/each}

                {#each Array(stages.length + 1) as _, index (`endpoint-${index}`)}
                    <span
                        class="absolute top-1/2 z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors"
                        style={`left: ${endpointPosition(index)}%; border-color: ${endpointColor(index)}; background-color: ${endpointFilled(index) ? endpointColor(index) : "transparent"};`}
                    ></span>
                {/each}
            </div>

            <div
                class="absolute inset-0 grid gap-0"
                style={`grid-template-columns: repeat(${stages.length}, minmax(0, 1fr));`}
            >
                {#each stages as stage (stage.stageId)}
                    <button
                        type="button"
                        class="group flex h-full w-full flex-col items-center text-center"
                        onclick={() =>
                            onSelectFocus(stageFocusId(stage.stageId))}
                    >
                        <span class="sr-only">
                            {stage.stageId}
                        </span>
                    </button>
                {/each}
            </div>
        </div>
    {/if}
</div>
