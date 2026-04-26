<script lang="ts">
    import GithubRepositoryList from "$lib/components/entities/Repository/GithubRepositoryList.svelte";
    import RepositoryList from "$lib/components/entities/Repository/RepositoryList.svelte";
</script>

<div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
    <div
        class="mt-4 grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[1.05fr_0.95fr] xl:overflow-hidden"
    >
        <RepositoryList />

        <section class="flex min-h-[36rem] flex-col xl:h-full xl:min-h-0">
            <GithubRepositoryList />
        </section>
    </div>
</div>
