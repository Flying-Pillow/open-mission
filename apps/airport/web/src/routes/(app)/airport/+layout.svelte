<script lang="ts">
    import AirportHeader from "$lib/components/airport/airport-header.svelte";
    import AirportSidebar from "$lib/components/airport/airport-sidebar.svelte";
    import {
        SidebarInset,
        SidebarProvider,
    } from "$lib/components/ui/sidebar/index.js";
    import type { Snippet } from "svelte";

    let { children }: { children: Snippet } = $props();
</script>

<SidebarProvider style="--sidebar-width: 19rem; --sidebar-width-mobile: 20rem;">
    <AirportSidebar variant="inset" />

    <SidebarInset
        class="min-h-0 overflow-hidden h-svh md:peer-data-[variant=inset]:my-0"
    >
        <AirportHeader />
        {@render children()}
    </SidebarInset>
</SidebarProvider>
