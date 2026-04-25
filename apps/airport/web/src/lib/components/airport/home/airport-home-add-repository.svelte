<script lang="ts">
    import GithubRepositoryList from "$lib/components/entities/Repository/GithubRepositoryList.svelte";
</script>

<section
    class="flex min-h-[36rem] flex-col rounded-[2rem] border bg-card/70 px-5 py-5 backdrop-blur-sm xl:h-full xl:min-h-0"
>
    <div class="space-y-2">
        <h2 class="text-xl font-semibold text-foreground">
            GitHub repositories
        </h2>
        <p class="text-sm text-muted-foreground">
            Browse accessible repositories and open the clone dialog when you
            want to bring one into Airport.
        </p>
    </div>

    <div class="mt-5 flex min-h-0 flex-1">
        <GithubRepositoryList />
    </div>
</section>
