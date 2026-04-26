<script lang="ts">
    import EntityActionbar from "$lib/components/entities/Actionbar/EntityActionbar.svelte";
    import type { Artifact } from "$lib/components/entities/Artifact/Artifact.svelte.js";

    let {
        refreshNonce,
        artifact,
        onActionExecuted,
    }: {
        refreshNonce: number;
        artifact?: Artifact;
        onActionExecuted: () => Promise<void>;
    } = $props();
</script>

<EntityActionbar
    {refreshNonce}
    entity={artifact}
    defaultVariant="outline"
    buttonClass="shadow-sm"
    showEmptyState={false}
    {onActionExecuted}
/>
