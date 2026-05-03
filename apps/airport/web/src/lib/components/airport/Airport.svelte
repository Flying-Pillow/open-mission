<script lang="ts">
    import RepositoryList from "$lib/components/entities/Repository/RepositoryList.svelte";
</script>

<div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
    <div
        class="mt-4 grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.9fr)]"
    >
        <div class="flex min-h-0 overflow-hidden">
            <RepositoryList
                repositoryFilter="local"
                eyebrow="Local"
                heading="Checked out repositories"
                description="Local working copies already available inside Airport."
            />
        </div>

        <div class="flex min-h-0 max-h-[32rem] overflow-hidden lg:max-h-none">
            <RepositoryList
                repositoryFilter="external"
                eyebrow="GitHub"
                heading="External GitHub repositories"
                description="Repositories discovered from GitHub that can be cloned into the workspace."
            />
        </div>
    </div>
</div>
