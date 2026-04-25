<script lang="ts">
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";

    const appContext = getAppContext();
    const activeRepository = $derived.by(() => {
        const currentRepository = appContext.airport.activeRepository;
        if (!currentRepository) {
            throw new Error("Repository card requires an active repository in the app context.");
        }

        return currentRepository;
    });
    const repositorySummary = $derived(activeRepository.summary);
    const repositoryOperationalMode = $derived(activeRepository.operationalMode);
    const repositoryControlRoot = $derived(
        activeRepository.controlRoot ?? repositorySummary.repositoryRootPath,
    );
    const repositoryCurrentBranch = $derived(activeRepository.currentBranch);
    const repositoryGithubRepository = $derived(
        activeRepository.githubRepository ?? repositorySummary.githubRepository,
    );
    const repositorySettingsComplete = $derived(
        activeRepository.settingsComplete,
    );
    const resolvedMissionCountLabel = $derived(
        activeRepository.missionCountLabel ?? "0 missions",
    );
</script>

<section class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm">
    <div class="flex items-start justify-between gap-4">
        <div>
            <p
                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
                Repository
            </p>
            <h1 class="mt-2 text-2xl font-semibold text-foreground">
                {repositorySummary?.label}
            </h1>
            <p class="mt-1 text-sm text-muted-foreground">
                {repositorySummary?.description}
            </p>
            <p class="mt-2 font-mono text-xs text-muted-foreground">
                {repositorySummary?.repositoryRootPath}
            </p>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
            <Badge variant="secondary">{resolvedMissionCountLabel}</Badge>
            {#if repositoryOperationalMode}
                <Badge variant="outline">{repositoryOperationalMode}</Badge>
            {/if}
        </div>
    </div>

    <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-xl border bg-background/70 px-4 py-3">
            <p
                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
                Control root
            </p>
            <p class="mt-2 text-sm font-medium text-foreground">
                {repositoryControlRoot}
            </p>
        </div>
        <div class="rounded-xl border bg-background/70 px-4 py-3">
            <p
                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
                Branch
            </p>
            <p class="mt-2 text-sm font-medium text-foreground">
                {repositoryCurrentBranch ?? "Unavailable"}
            </p>
        </div>
        <div class="rounded-xl border bg-background/70 px-4 py-3">
            <p
                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
                Tracking
            </p>
            <p class="mt-2 text-sm font-medium text-foreground">
                {repositoryGithubRepository ?? "Not configured"}
            </p>
        </div>
        <div class="rounded-xl border bg-background/70 px-4 py-3">
            <p
                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
                Setup
            </p>
            <p class="mt-2 text-sm font-medium text-foreground">
                {repositorySettingsComplete === false ? "Incomplete" : "Ready"}
            </p>
        </div>
    </div>
</section>