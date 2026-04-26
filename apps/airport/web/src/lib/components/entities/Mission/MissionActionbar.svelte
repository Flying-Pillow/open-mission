<script lang="ts">
    import EntityActionbar from "$lib/components/entities/Actionbar/EntityActionbar.svelte";
    import type { Mission } from "$lib/components/entities/Mission/Mission.svelte.js";

    let {
        refreshNonce,
        mission,
        onActionExecuted,
    }: {
        refreshNonce: number;
        mission: Mission;
        onActionExecuted: () => Promise<void>;
    } = $props();
</script>

<EntityActionbar
    {refreshNonce}
    entity={mission}
    class="xl:justify-end"
    buttonClass="shadow-sm"
    defaultVariant="outline"
    showEmptyState={true}
    {onActionExecuted}
/>
