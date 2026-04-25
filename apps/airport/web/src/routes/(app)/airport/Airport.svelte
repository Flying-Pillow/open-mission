<script lang="ts">
    import { onMount } from "svelte";
    import AirportHomeAddRepository from "$lib/components/airport/home/airport-home-add-repository.svelte";
    import AirportHomeStatus from "$lib/components/airport/home/airport-home-status.svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import RepositoryList from "$lib/components/entities/Repository/RepositoryList.svelte";

    const appContext = getAppContext();

    onMount(() => {
        if (appContext.githubStatus !== "connected") {
            return;
        }

        void appContext.application.loadGitHubRepositories();
    });

    const repositories = $derived(appContext.airport.repositories);
    const repositoriesLoading = $derived(
        appContext.application.airportHomeLoading
            || appContext.application.repositoriesLoading,
    );
    const repositoriesError = $derived(
        appContext.application.airportHomeError
            ?? appContext.application.repositoriesError,
    );
</script>

<div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
    {#if repositoriesLoading && repositories.length === 0}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 text-sm text-muted-foreground backdrop-blur-sm"
        >
            Loading repositories...
        </section>
    {:else if repositoriesError && repositories.length === 0}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
        >
            <h2 class="text-lg font-semibold text-foreground">Repositories</h2>
            <p class="mt-3 text-sm text-rose-600">
                {repositoriesError}
            </p>
        </section>
    {:else}
        <AirportHomeStatus />

        <div
            class="mt-4 grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[1.05fr_0.95fr] xl:overflow-hidden"
        >
            <RepositoryList />

            <AirportHomeAddRepository />
        </div>
    {/if}
</div>
