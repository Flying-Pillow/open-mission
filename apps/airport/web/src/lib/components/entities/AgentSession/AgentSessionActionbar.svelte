<script lang="ts">
    import ScopedActionbar from "$lib/components/entities/Actionbar/ScopedActionbar.svelte";
    import type { MissionStageIdData as MissionStageId } from "../types";

    let {
        refreshNonce,
        stageId,
        taskId,
        sessionId,
        onActionExecuted,
    }: {
        refreshNonce: number;
        stageId?: MissionStageId;
        taskId?: string;
        sessionId?: string;
        onActionExecuted: () => Promise<void>;
    } = $props();
</script>

<ScopedActionbar
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
