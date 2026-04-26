<script lang="ts">
    import EntityActionbar from "$lib/components/entities/Actionbar/EntityActionbar.svelte";
    import type { Task } from "$lib/components/entities/Task/Task.svelte.js";

    let {
        refreshNonce,
        task,
        onActionExecuted,
    }: {
        refreshNonce: number;
        task?: Task;
        onActionExecuted: () => Promise<void>;
    } = $props();
</script>

<EntityActionbar
    {refreshNonce}
    entity={task}
    defaultVariant="default"
    buttonClass="shadow-sm shadow-primary/10"
    showEmptyState={false}
    {onActionExecuted}
/>
