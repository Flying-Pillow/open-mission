<script lang="ts">
    import RepositoryList from "$lib/components/entities/Repository/RepositoryList.svelte";
</script>

<div class="flex min-h-0 w-full flex-col md:flex-row flex-1">
    <div class="flex-1 min-h-0 overflow-hidden">
        <RepositoryList
            repositoryFilter="local"
            eyebrow="Local"
            heading="Checked out repositories"
            description="Local working copies already available inside Airport."
        />
    </div>

    <div class="flex-1 min-h-0 max-h-[32rem] overflow-hidden lg:max-h-none">
        <RepositoryList
            repositoryFilter="external"
            eyebrow="GitHub"
            heading="External GitHub repositories"
            description="Repositories discovered from GitHub that can be cloned into the workspace."
        />
    </div>
</div>
