<script lang="ts">
    import { app } from "$lib/client/Application.svelte.js";
    import EntityCommandbar from "$lib/components/entities/Entity/EntityCommandbar.svelte";

    let {
        refreshNonce,
        onCommandExecuted,
    }: {
        refreshNonce: number;
        onCommandExecuted: () => Promise<void>;
    } = $props();
</script>

<div class="flex flex-wrap items-center gap-2">
    <EntityCommandbar
        {refreshNonce}
        entity={app.task}
        defaultVariant="default"
        buttonClass="shadow-sm shadow-primary/10"
        showEmptyState={false}
        {onCommandExecuted}
    />
</div>
