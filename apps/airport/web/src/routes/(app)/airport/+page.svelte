<!-- /apps/airport/web/src/routes/(app)/airport/+page.svelte: Minimal Airport route that only renders the shared header. -->
<script lang="ts">
    import type { PageData } from "./$types";
    import AirportHeader from "$lib/components/airport/airport-header.svelte";
    import Airport from "$lib/components/airport/AirportPage.svelte";
    import { SidebarProvider } from "$lib/components/ui/sidebar/index.js";
</script>

<svelte:head>
    <title>Flying-Pillow Mission</title>
    <meta
        name="description"
        content="Minimal Airport route for daemon status and GitHub login state."
    />
</svelte:head>

<SidebarProvider>
    <div class="min-h-svh bg-background">
        <AirportHeader />
        <Airport />
    </div>
</SidebarProvider>
