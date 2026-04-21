<script lang="ts">
    import AirportHomeAddRepository from "$lib/components/airport/home/airport-home-add-repository.svelte";
    import AirportHomeStatus from "$lib/components/airport/home/airport-home-status.svelte";
    import RepositoryList from "$lib/components/entities/Repository/RepositoryList.svelte";
    import type {
        GitHubVisibleRepositorySummary,
        RepositorySummary,
    } from "$lib/components/entities/types";

    type HomeData = {
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
        data,
        form,
        daemonStatusTone,
        githubStatusTone,
        githubAccountLabel,
        repositoryCountLabel,
        daemonMessage,
    }: {
        data: HomeData;
        form?: HomeForm;
        daemonStatusTone: "connected" | "disconnected";
        githubStatusTone: "connected" | "disconnected" | "unknown";
        githubAccountLabel: string;
        repositoryCountLabel: string;
        daemonMessage: string;
    } = $props();

    const selectedRepository = $derived.by(() =>
        data.airportHome.repositories.find(
            (repository) =>
                repository.repositoryRootPath ===
                data.airportHome.selectedRepositoryRoot,
        ),
    );
    const githubRepositoryCountLabel = $derived(
        data.githubRepositories.length === 1
            ? "1 visible GitHub repository"
            : `${data.githubRepositories.length} visible GitHub repositories`,
    );
</script>

<div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
    <AirportHomeStatus
        {daemonStatusTone}
        {githubStatusTone}
        {githubAccountLabel}
        {repositoryCountLabel}
        {githubRepositoryCountLabel}
        {selectedRepository}
        {daemonMessage}
        loginHref={data.loginHref}
    />

    <div
        class="mt-4 grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[1.05fr_0.95fr] xl:overflow-hidden"
    >
        <RepositoryList
            mode="repositories"
            repositories={data.airportHome.repositories}
            {repositoryCountLabel}
            selectedRepositoryRoot={data.airportHome.selectedRepositoryRoot}
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
</div>
