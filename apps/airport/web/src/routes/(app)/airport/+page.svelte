<!-- /apps/airport/web/src/routes/(app)/airport/+page.svelte: Airport home route shell. -->
<script lang="ts">
    import AirportHeader from "$lib/components/airport/airport-header.svelte";
    import AirportSidebar from "$lib/components/airport/airport-sidebar.svelte";
    import Home from "./Home.svelte";
    import {
        SidebarInset,
        SidebarProvider,
    } from "$lib/components/ui/sidebar/index.js";
</script>

<svelte:head>
    <title>Flying-Pillow Mission</title>
    <meta
        name="description"
        content="Minimal Airport route for daemon status and GitHub login state."
    />
</svelte:head>

<SidebarProvider>
    <AirportSidebar variant="inset" />

    <SidebarInset
        class="min-h-0 overflow-hidden h-svh md:peer-data-[variant=inset]:my-0"
    >
        <AirportHeader />
        <Home />
    </SidebarInset>
</SidebarProvider>
