<script lang="ts">
    import { onMount } from "svelte";
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

    const appContext = getAppContext();

    let data = $state<HomeData | null>(null);
    let homeLoading = $state(true);
    let homeLoadError = $state<string | null>(null);

    onMount(() => {
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

<div class="flex min-h-0 flex-1 flex-col bg-muted/20 px-4 pb-4 pt-3">
    {#if homeLoading && !data}
        <section
            class="rounded-lg border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm"
        >
            Loading airport surface...
        </section>
    {:else if homeLoadError || !data}
        <section class="rounded-lg border bg-card px-5 py-4 shadow-sm">
            <h2 class="text-lg font-semibold text-foreground">Airport</h2>
            <p class="mt-3 text-sm text-rose-600">
                {homeLoadError ?? "Airport surface could not be loaded."}
            </p>
        </section>
    {:else}
        <AirportHomeStatus />

        <div
            class="mt-4 grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1.08fr)_minmax(24rem,0.92fr)] xl:overflow-hidden"
        >
            <RepositoryList
                mode="repositories"
                heading="Repositories registered"
                description="Your saved local repositories, ready to open and work from."
            />

            <AirportHomeAddRepository />
        </div>
    {/if}
</div>
