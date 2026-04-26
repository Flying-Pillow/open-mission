<script lang="ts">
    import AirportHeader from "$lib/components/airport/airport-header.svelte";
    import AirportSidebar from "$lib/components/airport/airport-sidebar.svelte";
    import {
        SidebarInset,
        SidebarProvider,
    } from "$lib/components/ui/sidebar/index.js";
    import KanbanBoard from "./kanban-board.svelte";
</script>

<svelte:head>
    <title>Kanban · Flying-Pillow Mission</title>
    <meta
        name="description"
        content="Cross-repository Kanban surface for Mission repositories, missions, and GitHub issues."
    />
</svelte:head>

<SidebarProvider>
    <AirportSidebar variant="inset" />

    <SidebarInset
        class="min-h-0 overflow-hidden h-svh md:peer-data-[variant=inset]:my-0"
    >
        <AirportHeader />
        <KanbanBoard />
    </SidebarInset>
</SidebarProvider>
