<script lang="ts">
    import type { RepositoryCandidateDto } from "@flying-pillow/mission-core/airport/runtime";
    import type { OperatorStatus } from "@flying-pillow/mission-core/types.js";
    import type { Mission as MissionEntity } from "$lib/client/entities/Mission";
    import MissionActionbar from "$lib/components/entities/Mission/MissionActionbar.svelte";
    import type { MissionControlComputedState } from "$lib/components/entities/Mission/missionControl";
    import MissionCockpit from "$lib/components/entities/Mission/MissionCockpit.svelte";

    let {
        repository,
        runtimeRepositoryRootPath,
        mission,
        refreshNonce,
        operatorStatus,
        selectionState,
        onSelectNode,
        onMissionMutated,
    }: {
        repository: RepositoryCandidateDto;
        runtimeRepositoryRootPath: string;
        mission: MissionEntity;
        refreshNonce: number;
        operatorStatus: OperatorStatus;
        selectionState: MissionControlComputedState;
        onSelectNode: (nodeId: string) => void;
        onMissionMutated: () => Promise<void>;
    } = $props();

    const workflowLifecycle = $derived(operatorStatus.workflow?.lifecycle);
    const workflowUpdatedAt = $derived(operatorStatus.workflow?.updatedAt);
    const currentStageId = $derived(operatorStatus.workflow?.currentStageId);
    const missionTitle = $derived(operatorStatus.title ?? mission.missionId);

    function currentStageLabel(stageId: string | undefined): string {
        return stageId ? `Current stage ${stageId}` : "No active stage";
    }
</script>

<section
    class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
>
    <header class="space-y-4 border-b pb-4">
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
                        <span>{repository.label}</span>
                        <span>{mission.missionId}</span>
                        <span>{workflowLifecycle ?? "unknown"}</span>
                        <span>{currentStageLabel(currentStageId)}</span>
                        <span>Updated {workflowUpdatedAt ?? "unknown"}</span>
                        <span>{repository.repositoryRootPath}</span>
                    </div>
                </div>
            </div>

            <MissionActionbar
                missionId={mission.missionId}
                repositoryId={repository.repositoryId}
                repositoryRootPath={runtimeRepositoryRootPath}
                {refreshNonce}
                onActionExecuted={onMissionMutated}
            />
        </div>
    </header>

    <MissionCockpit {selectionState} {currentStageId} {onSelectNode} />
</section>
