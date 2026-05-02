<script lang="ts">
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";

    const appContext = getAppContext();
    const activeRepository = $derived.by(() => {
        const currentRepository = appContext.airport.activeRepository;
        if (!currentRepository) {
            throw new Error(
                "Repository card requires an active repository in the app context.",
            );
        }

        return currentRepository;
    });
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
                {activeRepository.data.platformRepositoryRef ??
                    activeRepository.data.repoName}
            </h1>
            <p class="mt-1 text-sm text-muted-foreground">
                {activeRepository.data.platformRepositoryRef ??
                    activeRepository.data.repositoryRootPath}
            </p>
            <p class="mt-2 font-mono text-xs text-muted-foreground">
                {activeRepository.data.repositoryRootPath}
            </p>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
            <Badge variant="secondary"
                >{activeRepository.missions.length === 1
                    ? "1 mission"
                    : `${activeRepository.missions.length} missions`}</Badge
            >
            {#if activeRepository.data.operationalMode}
                <Badge variant="outline"
                    >{activeRepository.data.operationalMode}</Badge
                >
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
                {activeRepository.data.repositoryRootPath}
            </p>
        </div>
        <div class="rounded-xl border bg-background/70 px-4 py-3">
            <p
                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
                Branch
            </p>
            <p class="mt-2 text-sm font-medium text-foreground">
                {activeRepository.data.currentBranch ?? "Unavailable"}
            </p>
        </div>
        <div class="rounded-xl border bg-background/70 px-4 py-3">
            <p
                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
                Tracking
            </p>
            <p class="mt-2 text-sm font-medium text-foreground">
                {activeRepository.data.platformRepositoryRef ??
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
                {!activeRepository.data.isInitialized
                    ? "Incomplete"
                    : "Ready"}
            </p>
        </div>
    </div>
</section>
