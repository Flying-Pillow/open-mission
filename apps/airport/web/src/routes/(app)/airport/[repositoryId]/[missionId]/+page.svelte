<script lang="ts">
    import { page } from "$app/state";
    import Mission from "$lib/components/entities/Mission/Mission.svelte";
</script>

<svelte:head>
    <title>Mission Control</title>
    <meta
        name="description"
        content="Dedicated operator console for steering a single mission workflow in Airport web."
    />
</svelte:head>

{#key `${page.params.repositoryId}:${page.params.missionId}`}
    <Mission />
{/key}
