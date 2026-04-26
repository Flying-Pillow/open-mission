<script lang="ts">
    import { getAirportHomeData } from "./home.remote";
    import AirportHomeAddRepository from "$lib/components/airport/home/airport-home-add-repository.svelte";
    import AirportHomeStatus from "$lib/components/airport/home/airport-home-status.svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import type { AppContextServerValue } from "$lib/client/context/app-context.svelte";
    import RepositoryList from "$lib/components/entities/Repository/RepositoryList.svelte";
    import type {
        GitHubVisibleRepositorySummary,
        RepositorySummary,
    } from "$lib/components/entities/types";

    type HomeData = {
        appContext?: AppContextServerValue;
        loginHref: string;
        airportHome: {
            operationalMode?: string;
            controlRoot?: string;
            currentBranch?: string;
            settingsComplete?: boolean;
            selectedRepositoryRoot?: string;
            repositories: RepositorySummary[];
        };
        githubRepositories: GitHubVisibleRepositorySummary[];
        githubRepositoriesError?: string;
    };

    type HomeForm = {
        addRepository?: {
            error?: string;
            success?: boolean;
            repositoryPath?: string;
            githubRepository?: string;
        };
    };

    let {
        form,
    }: {
        form?: HomeForm;
    } = $props();
    const appContext = getAppContext();
    const loginHref = "/login?redirectTo=/airport";

    let data = $state<HomeData | null>(null);
    let homeLoading = $state(true);
    let homeLoadError = $state<string | null>(null);
    let homeLoaded = $state(false);

    const daemonStatusTone = $derived(
        appContext.daemon.running ? "connected" : "disconnected",
    );
    const githubStatusTone = $derived(appContext.githubStatus);
    const githubAccountLabel = $derived(
        appContext.user?.name ??
            (githubStatusTone === "connected"
                ? "Authenticated GitHub account"
                : "No authenticated GitHub account"),
    );
    const repositoryCountLabel = $derived(
        appContext.airport.repositories.length === 1
            ? "1 repository registered"
            : `${appContext.airport.repositories.length} repositories registered`,
    );

    const selectedRepository = $derived.by(() =>
        appContext.airport.repositories.find(
            (repository) =>
                repository.repositoryRootPath ===
                data?.airportHome.selectedRepositoryRoot,
        ),
    );
    const githubRepositoryCountLabel = $derived(
        data?.githubRepositories.length === 1
            ? "1 visible GitHub repository"
            : `${data?.githubRepositories.length ?? 0} visible GitHub repositories`,
    );

    $effect(() => {
        if (homeLoaded) {
            return;
        }

        homeLoaded = true;
        void loadAirportHomeData();
    });

    function normalizeHomeData(value: unknown): HomeData {
        const record =
            value && typeof value === "object"
                ? (value as Record<string, unknown>)
                : {};
        const airportHomeRecord =
            record.airportHome && typeof record.airportHome === "object"
                ? (record.airportHome as Record<string, unknown>)
                : {};

        return {
            ...(record.appContext && typeof record.appContext === "object"
                ? { appContext: record.appContext as AppContextServerValue }
                : {}),
            loginHref:
                typeof record.loginHref === "string" && record.loginHref.trim()
                    ? record.loginHref
                    : "/login?redirectTo=/airport",
            airportHome: {
                operationalMode:
                    typeof airportHomeRecord.operationalMode === "string"
                        ? airportHomeRecord.operationalMode
                        : undefined,
                controlRoot:
                    typeof airportHomeRecord.controlRoot === "string"
                        ? airportHomeRecord.controlRoot
                        : undefined,
                currentBranch:
                    typeof airportHomeRecord.currentBranch === "string"
                        ? airportHomeRecord.currentBranch
                        : undefined,
                settingsComplete:
                    typeof airportHomeRecord.settingsComplete === "boolean"
                        ? airportHomeRecord.settingsComplete
                        : undefined,
                selectedRepositoryRoot:
                    typeof airportHomeRecord.selectedRepositoryRoot === "string"
                        ? airportHomeRecord.selectedRepositoryRoot
                        : undefined,
                repositories: Array.isArray(airportHomeRecord.repositories)
                    ? (airportHomeRecord.repositories as RepositorySummary[])
                    : [],
            },
            githubRepositories: Array.isArray(record.githubRepositories)
                ? (record.githubRepositories as GitHubVisibleRepositorySummary[])
                : [],
            ...(typeof record.githubRepositoriesError === "string"
                ? { githubRepositoriesError: record.githubRepositoriesError }
                : {}),
        };
    }

    function syncAppContext(nextData: HomeData): void {
        if (nextData.appContext) {
            appContext.syncServerContext(nextData.appContext);
        }

        const nextSelectedRepository = nextData.airportHome.repositories.find(
            (repository) =>
                repository.repositoryRootPath ===
                nextData.airportHome.selectedRepositoryRoot,
        );

        appContext.setRepositories(nextData.airportHome.repositories);
        appContext.setActiveRepository(
            nextSelectedRepository
                ? {
                      repositoryId: nextSelectedRepository.repositoryId,
                      repositoryRootPath:
                          nextSelectedRepository.repositoryRootPath,
                  }
                : undefined,
        );
        appContext.setActiveMission(undefined);
        appContext.setActiveMissionOutline(undefined);
        appContext.setActiveMissionSelectedNodeId(undefined);
    }

    async function loadAirportHomeData(): Promise<void> {
        homeLoading = true;
        homeLoadError = null;

        try {
            const nextData = normalizeHomeData(await getAirportHomeData({}));
            data = nextData;
            syncAppContext(nextData);
        } catch (error) {
            data = null;
            homeLoadError =
                error instanceof Error ? error.message : String(error);
        } finally {
            homeLoading = false;
        }
    }
</script>

<div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
    {#if homeLoading && !data}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 text-sm text-muted-foreground backdrop-blur-sm"
        >
            Loading airport surface...
        </section>
    {:else if homeLoadError || !data}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
        >
            <h2 class="text-lg font-semibold text-foreground">Airport</h2>
            <p class="mt-3 text-sm text-rose-600">
                {homeLoadError ?? "Airport surface could not be loaded."}
            </p>
        </section>
    {:else}
        <AirportHomeStatus
            {daemonStatusTone}
            {githubStatusTone}
            {githubAccountLabel}
            {repositoryCountLabel}
            {githubRepositoryCountLabel}
            {selectedRepository}
            daemonMessage={appContext.daemon.message}
            {loginHref}
        />

        <div
            class="mt-4 grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[1.05fr_0.95fr] xl:overflow-hidden"
        >
            <RepositoryList
                mode="repositories"
                heading="Repositories registered"
                description="Your saved local repositories, ready to open and work from."
            />

            <AirportHomeAddRepository
                githubRepositories={data.githubRepositories}
                {githubStatusTone}
                githubRepositoriesError={data.githubRepositoriesError}
                formState={form}
            />
        </div>
    {/if}
</div>
