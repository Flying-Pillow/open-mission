<script lang="ts">
    import ChevronDownIcon from "@tabler/icons-svelte/icons/chevron-down";
    import ChevronUpIcon from "@tabler/icons-svelte/icons/chevron-up";
    import type { OperatorStatusData as OperatorStatus } from "../types";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import MissionActionbar from "$lib/components/entities/Mission/MissionActionbar.svelte";
    import type { MissionControlComputedState } from "$lib/components/entities/Mission/missionControl";
    import MissionCockpit from "$lib/components/entities/Mission/MissionCockpit.svelte";
    import { Button } from "$lib/components/ui/button/index.js";

    let {
        refreshNonce,
        operatorStatus,
        selectionState,
        onSelectNode,
        onMissionMutated,
    }: {
        refreshNonce: number;
        operatorStatus: OperatorStatus;
        selectionState: MissionControlComputedState;
        onSelectNode: (nodeId: string) => void;
        onMissionMutated: () => Promise<void>;
    } = $props();
    const appContext = getAppContext();
    const activeRepository = $derived.by(() => {
        const resolvedRepository = appContext.airport.activeRepository;
        if (!resolvedRepository) {
            throw new Error("Mission view requires an active repository in the app context.");
        }

        return resolvedRepository;
    });
    const activeMission = $derived.by(() => {
        const resolvedMission = appContext.airport.activeMission;
        if (!resolvedMission) {
            throw new Error("Mission view requires an active mission in the app context.");
        }

        return resolvedMission;
    });
    const repositorySummary = $derived(activeRepository.summary);

    const workflowLifecycle = $derived(operatorStatus.workflow?.lifecycle);
    const workflowUpdatedAt = $derived(operatorStatus.workflow?.updatedAt);
    const currentStageId = $derived(operatorStatus.workflow?.currentStageId);
    const missionTitle = $derived(operatorStatus.title ?? activeMission.missionId);
    let progressCollapsed = $state(false);

    function currentStageLabel(stageId: string | undefined): string {
        return stageId ? `Current stage ${stageId}` : "No active stage";
    }
</script>

<section
    class={`min-h-0 gap-4 rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm ${progressCollapsed ? "grid grid-rows-[auto]" : "grid grid-rows-[auto_minmax(0,1fr)]"}`}
>
    <header class={`space-y-4 ${progressCollapsed ? "" : "border-b pb-4"}`}>
        <div
            class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"
        >
            <div class="min-w-0 space-y-2">
                <p
                    class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground"
                >
                    Mission
                </p>
                <div>
                    <h1 class="text-2xl font-semibold text-foreground">
                        {missionTitle}
                    </h1>
                    <div
                        class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"
                    >
                        <span>{repositorySummary.label}</span>
                        <span>{activeMission.missionId}</span>
                        <span>{workflowLifecycle ?? "unknown"}</span>
                        <span>{currentStageLabel(currentStageId)}</span>
                        <span>Updated {workflowUpdatedAt ?? "unknown"}</span>
                        <span>{repositorySummary.repositoryRootPath}</span>
                    </div>
                </div>
            </div>

            <div class="flex items-start gap-2 self-start xl:justify-end">
                <MissionActionbar
                    {refreshNonce}
                    onActionExecuted={onMissionMutated}
                />

                <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    class="shrink-0 shadow-sm"
                    aria-expanded={!progressCollapsed}
                    aria-label={progressCollapsed
                        ? "Expand mission progress"
                        : "Collapse mission progress"}
                    onclick={() => {
                        progressCollapsed = !progressCollapsed;
                    }}
                >
                    {#if progressCollapsed}
                        <ChevronDownIcon />
                    {:else}
                        <ChevronUpIcon />
                    {/if}
                    <span class="sr-only">
                        {progressCollapsed
                            ? "Expand mission progress"
                            : "Collapse mission progress"}
                    </span>
                </Button>
            </div>
        </div>
    </header>

    {#if !progressCollapsed}
        <MissionCockpit {selectionState} {currentStageId} {onSelectNode} />
    {/if}
</section>