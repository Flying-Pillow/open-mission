<!-- /apps/airport/web/src/routes/repository/[repositoryId]/+page.svelte: Repository-scoped Airport route for selecting missions and creating new missions. -->
<script lang="ts">
    import { page } from "$app/state";
    import AirportHeader from "$lib/components/airport/airport-header.svelte";
    import AirportSidebar from "$lib/components/airport/airport-sidebar.svelte";
    import Repository from "$lib/components/entities/Repository/Repository.svelte";
    import {
        SidebarInset,
        SidebarProvider,
    } from "$lib/components/ui/sidebar/index.js";
</script>

<svelte:head>
    <title>Airport Repository</title>
    <meta
        name="description"
        content="Repository-scoped Airport route for selecting missions and creating new missions from issues or briefs."
    />
</svelte:head>

<SidebarProvider>
    <AirportSidebar variant="inset" />

    <SidebarInset
        class="min-h-0 overflow-hidden h-svh md:peer-data-[variant=inset]:my-0"
    >
        <AirportHeader />
        {#key page.params.repositoryId}
            <Repository />
        {/key}
    </SidebarInset>
</SidebarProvider>
