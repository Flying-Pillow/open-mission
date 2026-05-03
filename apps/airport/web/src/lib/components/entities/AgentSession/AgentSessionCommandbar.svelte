<script lang="ts">
    import EntityCommandbar from "$lib/components/entities/Commandbar/EntityCommandbar.svelte";
    import type { CommandableEntity } from "$lib/components/entities/Commandbar/CommandableEntity";

    let {
        refreshNonce,
        session,
        onCommandExecuted,
    }: {
        refreshNonce: number;
        session?: CommandableEntity;
        onCommandExecuted: () => Promise<void>;
    } = $props();
</script>

<EntityCommandbar
    {refreshNonce}
    entity={session}
    defaultVariant="outline"
    buttonClass="shadow-sm"
    showEmptyState={false}
    {onCommandExecuted}
/>
