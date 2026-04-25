<script lang="ts">
    import ScopedActionbar from "$lib/components/entities/Actionbar/ScopedActionbar.svelte";
    import type { MissionStageId } from "@flying-pillow/mission-core/types.js";

    let {
        refreshNonce,
        stageId,
        taskId,
        artifactPath,
        onActionExecuted,
    }: {
        refreshNonce: number;
        stageId?: MissionStageId;
        taskId?: string;
        artifactPath?: string;
        onActionExecuted: () => Promise<void>;
    } = $props();
</script>

<ScopedActionbar
    {refreshNonce}
    {stageId}
    {taskId}
    {artifactPath}
    scope="artifact"
    defaultVariant="outline"
    buttonClass="shadow-sm"
    showEmptyState={false}
    {onActionExecuted}
/>