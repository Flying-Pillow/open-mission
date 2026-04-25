<script lang="ts">
    import ScopedActionbar from "$lib/components/entities/Actionbar/ScopedActionbar.svelte";
    import type { MissionStageId } from "@flying-pillow/mission-core/types.js";

    let {
        refreshNonce,
        stageId,
        taskId,
        onActionExecuted,
    }: {
        refreshNonce: number;
        stageId?: MissionStageId;
        taskId?: string;
        onActionExecuted: () => Promise<void>;
    } = $props();
</script>

<ScopedActionbar
    {refreshNonce}
    {stageId}
    {taskId}
    scope="task"
    defaultVariant="default"
    buttonClass="shadow-sm shadow-primary/10"
    showEmptyState={false}
    {onActionExecuted}
/>
