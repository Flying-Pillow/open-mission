<!-- /apps/airport/web/src/routes/(app)/airport/[repositoryId]/+page.svelte: Repository route for selecting missions and creating new missions. -->
<script lang="ts">
    import { page } from "$app/state";
    import Repository from "$lib/components/entities/Repository/Repository.svelte";
</script>

<svelte:head>
    <title>Airport Repository</title>
    <meta
        name="description"
        content="Repository route for selecting missions and creating new missions from issues or briefs."
    />
</svelte:head>

{#key page.params.repositoryId}
    <Repository />
{/key}
