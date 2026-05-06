<script lang="ts">
    import { afterNavigate } from "$app/navigation";
    import { page } from "$app/state";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import Mission from "$lib/components/entities/Mission/Mission.svelte";

    const appContext = getAppContext();

    afterNavigate(() => {
        const repositoryId = page.params.repositoryId?.trim();
        const missionId = page.params.missionId?.trim();
        if (!repositoryId || !missionId) {
            return;
        }

        void appContext.loadMissionPage({ repositoryId, missionId });
    });
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
