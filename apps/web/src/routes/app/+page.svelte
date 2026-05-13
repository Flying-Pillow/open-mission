<!-- /apps/web/src/routes/(app)/app/+page.svelte: Open Mission app route showing repositories. -->
<script lang="ts">
    import { afterNavigate } from "$app/navigation";
    import { app } from "$lib/client/Application.svelte.js";
    import AppShell from "$lib/components/app-shell/AppShell.svelte";

    afterNavigate(() => {
        app.clearAppSelection();
    });
</script>

<svelte:head>
    <title>Flying-Pillow Open Mission</title>
    <meta
        name="description"
        content="Open Mission app route for daemon status and GitHub login state."
    />
</svelte:head>

<AppShell />
