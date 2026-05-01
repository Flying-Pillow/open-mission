<script lang="ts">
    import EntityCommandbar from "$lib/components/entities/Commandbar/EntityCommandbar.svelte";
    import type { Mission } from "$lib/components/entities/Mission/Mission.svelte.js";

    let {
        refreshNonce,
        mission,
        onCommandExecuted,
    }: {
        refreshNonce: number;
        mission: Mission;
        onCommandExecuted: () => Promise<void>;
    } = $props();
</script>

<EntityCommandbar
    {refreshNonce}
    entity={mission}
    class="xl:justify-end"
    buttonClass="shadow-sm"
    defaultVariant="outline"
    showEmptyState={true}
    {onCommandExecuted}
/>