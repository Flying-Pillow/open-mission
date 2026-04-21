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

    let repositoryPath = $state("");
    let selectedGitHubRepository = $state("");

    $effect(() => {
        repositoryPath =
            form?.addRepository?.repositoryPath ??
            data.airportHome.controlRoot ??
            "";
        selectedGitHubRepository = form?.addRepository?.githubRepository ?? "";
    });
</script>

<div class="px-4 pb-4 pt-2">
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

    <div class="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <RepositoryList
            mode="repositories"
            repositories={data.airportHome.repositories}
            {repositoryCountLabel}
            selectedRepositoryRoot={data.airportHome.selectedRepositoryRoot}
            heading="Workspace repositories"
            description="Your saved local repositories, ready to open and work from."
        />

        <AirportHomeAddRepository
            githubRepositories={data.githubRepositories}
            {githubStatusTone}
            githubRepositoriesError={data.githubRepositoriesError}
            controlRoot={data.airportHome.controlRoot}
            formState={form}
            bind:repositoryPath
            bind:selectedGitHubRepository
        />
    </div>
</div>
