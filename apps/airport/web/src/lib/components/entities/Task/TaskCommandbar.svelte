<script lang="ts">
    import EntityCommandbar from "$lib/components/entities/Commandbar/EntityCommandbar.svelte";
    import type { Task } from "$lib/components/entities/Task/Task.svelte.js";

    let {
        refreshNonce,
        task,
        onCommandExecuted,
    }: {
        refreshNonce: number;
        task?: Task;
        onCommandExecuted: () => Promise<void>;
    } = $props();
</script>

<EntityCommandbar
    {refreshNonce}
    entity={task}
    defaultVariant="default"
    buttonClass="shadow-sm shadow-primary/10"
    showEmptyState={false}
    {onCommandExecuted}
/>