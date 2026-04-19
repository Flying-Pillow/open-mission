<script lang="ts">
    import { Badge } from "$lib/components/ui/badge/index.js";
    import type { RepositorySummary } from "$lib/components/entities/types";

    let {
        repository,
        operationalMode,
        controlRoot,
        currentBranch,
        settingsComplete,
        githubRepository,
        missionCountLabel,
    }: {
        repository: RepositorySummary;
        operationalMode?: string;
        controlRoot?: string;
        currentBranch?: string;
        settingsComplete?: boolean;
        githubRepository?: string;
        missionCountLabel: string;
    } = $props();
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
                {repository.label}
            </h1>
            <p class="mt-1 text-sm text-muted-foreground">
                {repository.description}
            </p>
            <p class="mt-2 font-mono text-xs text-muted-foreground">
                {repository.repositoryRootPath}
            </p>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
            <Badge variant="secondary">{missionCountLabel}</Badge>
            {#if operationalMode}
                <Badge variant="outline">{operationalMode}</Badge>
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
                {controlRoot ?? repository.repositoryRootPath}
            </p>
        </div>
        <div class="rounded-xl border bg-background/70 px-4 py-3">
            <p
                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
                Branch
            </p>
            <p class="mt-2 text-sm font-medium text-foreground">
                {currentBranch ?? "Unavailable"}
            </p>
        </div>
        <div class="rounded-xl border bg-background/70 px-4 py-3">
            <p
                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
                Tracking
            </p>
            <p class="mt-2 text-sm font-medium text-foreground">
                {githubRepository ??
                    repository.githubRepository ??
                    "Not configured"}
            </p>
        </div>
        <div class="rounded-xl border bg-background/70 px-4 py-3">
            <p
                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
                Setup
            </p>
            <p class="mt-2 text-sm font-medium text-foreground">
                {settingsComplete === false ? "Incomplete" : "Ready"}
            </p>
        </div>
    </div>
</section>
