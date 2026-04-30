<!-- /apps/airport/web/src/routes/(app)/airport/+page.svelte: Airport home route showing repositories. -->
<script lang="ts">
    import Airport from "$lib/components/airport/Airport.svelte";
</script>

<svelte:head>
    <title>Flying-Pillow Mission</title>
    <meta
        name="description"
        content="Minimal Airport route for daemon status and GitHub login state."
    />
</svelte:head>

<Airport />
