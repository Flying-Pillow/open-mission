<script lang="ts">
    import { page } from "$app/state";
    import AirportHeader from "$lib/components/airport/airport-header.svelte";
    import AirportSidebar from "$lib/components/airport/airport-sidebar.svelte";
    import Mission from "$lib/components/entities/Mission/Mission.svelte";
    import {
        SidebarInset,
        SidebarProvider,
    } from "$lib/components/ui/sidebar/index.js";
</script>

<svelte:head>
    <title>Mission Control</title>
    <meta
        name="description"
        content="Dedicated operator console for steering a single mission workflow in Airport web."
    />
</svelte:head>

<SidebarProvider style="--sidebar-width: 19rem; --sidebar-width-mobile: 20rem;">
    <AirportSidebar variant="inset" />

    <SidebarInset
        class="min-h-0 overflow-hidden h-svh md:peer-data-[variant=inset]:my-0"
    >
        <AirportHeader />
        {#key `${page.params.repositoryId}:${page.params.missionId}`}
            <Mission />
        {/key}
    </SidebarInset>
</SidebarProvider>
