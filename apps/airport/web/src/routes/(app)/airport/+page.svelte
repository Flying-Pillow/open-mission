<!-- /apps/airport/web/src/routes/+page.svelte: Airport home route with repository management and daemon health summary. -->
<script lang="ts">
    import Airport from "./Airport.svelte";
    import AirportHeader from "$lib/components/airport/airport-header.svelte";
    import AirportSidebar from "$lib/components/airport/airport-sidebar.svelte";
    import {
        SidebarInset,
        SidebarProvider,
    } from "$lib/components/ui/sidebar/index.js";
</script>

<svelte:head>
    <title>Flying-Pillow Mission</title>
    <meta
        name="description"
        content="Airport repository management surface for the Flying-Pillow Mission workspace."
    />
</svelte:head>

<SidebarProvider>
    <AirportSidebar variant="inset" />

    <SidebarInset
        class="min-h-svh xl:h-svh xl:min-h-0 xl:overflow-hidden md:peer-data-[variant=inset]:my-0"
    >
        <AirportHeader />
        <Airport />
    </SidebarInset>
</SidebarProvider>
