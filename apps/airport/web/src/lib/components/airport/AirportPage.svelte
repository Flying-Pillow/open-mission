<script lang="ts">
    import AirportHomeAddRepository from "$lib/components/airport/home/airport-home-add-repository.svelte";
    import AirportHomeStatus from "$lib/components/airport/home/airport-home-status.svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import RepositoryList from "$lib/components/entities/Repository/RepositoryList.svelte";

    const appContext = getAppContext();
    const airportHomeState = $derived(appContext.application.airportHomeState);
    const airportHomeLoading = $derived(appContext.application.airportHomeLoading);
    const airportHomeError = $derived(appContext.application.airportHomeError);
</script>

<div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
    {#if airportHomeLoading && !airportHomeState}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 text-sm text-muted-foreground backdrop-blur-sm"
        >
            Loading airport home...
        </section>
    {:else if airportHomeError && !airportHomeState}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
        >
            <h2 class="text-lg font-semibold text-foreground">Airport home</h2>
            <p class="mt-3 text-sm text-rose-600">
                {airportHomeError}
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