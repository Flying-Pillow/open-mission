<script lang="ts">
    import ScopedActionbar from "$lib/components/entities/Actionbar/ScopedActionbar.svelte";
    import type { MissionStageId } from "@flying-pillow/mission-core/types.js";

    let {
        missionId,
        repositoryId,
        repositoryRootPath,
        refreshNonce,
        stageId,
        taskId,
        sessionId,
        onActionExecuted,
    }: {
        missionId: string;
        repositoryId: string;
        repositoryRootPath: string;
        refreshNonce: number;
        stageId?: MissionStageId;
        taskId?: string;
        sessionId?: string;
        onActionExecuted: () => Promise<void>;
    } = $props();
</script>

<ScopedActionbar
    {missionId}
    {repositoryId}
    {repositoryRootPath}
    {refreshNonce}
    {stageId}
    {taskId}
    {sessionId}
    scope="session"
    defaultVariant="outline"
    buttonClass="shadow-sm"
    showEmptyState={false}
    {onActionExecuted}
/>
