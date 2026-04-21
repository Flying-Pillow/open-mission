<!-- /apps/airport/web/src/routes/+page.svelte: Airport home route with repository management and daemon health summary. -->
<script lang="ts">
    import AirportHeader from "$lib/components/airport/airport-header.svelte";
    import AirportHomeSurface from "$lib/components/airport/home/airport-home-surface.svelte";
    import AirportSidebar from "$lib/components/airport/airport-sidebar.svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import {
        SidebarInset,
        SidebarProvider,
    } from "$lib/components/ui/sidebar/index.js";

    let { data, form } = $props<{
        data: {
            appContext: {
                daemon: {
                    running: boolean;
                    startedByHook: boolean;
                    message: string;
                    endpointPath?: string;
                    lastCheckedAt: string;
                };
                githubStatus: "connected" | "disconnected" | "unknown";
                user?: {
                    githubStatus: "connected" | "disconnected" | "unknown";
                };
            };
            loginHref: string;
            airportHome: {
                operationalMode?: string;
                controlRoot?: string;
                currentBranch?: string;
                settingsComplete?: boolean;
                selectedRepositoryRoot?: string;
                repositories: Array<{
                    repositoryId: string;
                    repositoryRootPath: string;
                    label: string;
                    description: string;
                    githubRepository?: string;
                }>;
            };
            githubRepositories: Array<{
                fullName: string;
                ownerLogin?: string;
                htmlUrl?: string;
                visibility: "private" | "public";
                archived: boolean;
            }>;
            githubRepositoriesError?: string;
        };
        form?: {
            addRepository?: {
                error?: string;
                success?: boolean;
                repositoryPath?: string;
                githubRepository?: string;
            };
        };
    }>();
    const appContext = getAppContext();

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
        data.airportHome.repositories.length === 1
            ? "1 repository registered"
            : `${data.airportHome.repositories.length} repositories registered`,
    );
    const selectedRepository = $derived.by(() =>
        data.airportHome.repositories.find(
            (repository: (typeof data.airportHome.repositories)[number]) =>
                repository.repositoryRootPath ===
                data.airportHome.selectedRepositoryRoot,
        ),
    );
    syncAppContext();

    $effect(() => {
        syncAppContext();
    });

    function syncAppContext(): void {
        appContext.setRepositories(data.airportHome.repositories);
        appContext.setActiveRepository(
            selectedRepository
                ? {
                      repositoryId: selectedRepository.repositoryId,
                      repositoryRootPath: selectedRepository.repositoryRootPath,
                  }
                : undefined,
        );
        appContext.setActiveMission(undefined);
        appContext.setActiveMissionOutline(undefined);
        appContext.setActiveMissionSelectedNodeId(undefined);
    }
</script>

<svelte:head>
    <title>Flying-Pillow Mission</title>
    <meta
        name="description"
        content="Airport repository management surface for the Flying-Pillow Mission workspace."
    />
</svelte:head>

<SidebarProvider>
    <AirportSidebar variant="inset" />

    <SidebarInset
        class="min-h-svh xl:h-svh xl:min-h-0 xl:overflow-hidden md:peer-data-[variant=inset]:my-0"
    >
        <AirportHeader />
        <AirportHomeSurface
            {data}
            {form}
            {daemonStatusTone}
            {githubStatusTone}
            {githubAccountLabel}
            {repositoryCountLabel}
            daemonMessage={appContext.daemon.message}
        />
    </SidebarInset>
</SidebarProvider>
