<script lang="ts">
    import type { GitHubIssueDetailType } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import { page } from "$app/state";
    import type { Repository as RepositoryEntity } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { setScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
    import IssueList from "$lib/components/entities/Issue/IssueList.svelte";
    import IssuePreview from "$lib/components/entities/Issue/IssuePreview.svelte";
    import RepositoryList from "$lib/components/entities/Repository/RepositoryList.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";

    const appContext = getAppContext();
    const repositoryId = $derived(page.params.repositoryId?.trim() ?? "");
    const repositoryScopeState = $state<{
        repositoryId?: string;
        repository?: RepositoryEntity;
        loading: boolean;
        error?: string | null;
    }>({
        loading: true,
    });
    const repositoryScope = setScopedRepositoryContext(repositoryScopeState);

    let selectedIssue = $state<GitHubIssueDetailType | null>(null);
    let issuePreviewOpen = $state(false);
    let issueError = $state<string | null>(null);
    let issueLoadingNumber = $state<number | null>(null);

    $effect(() => {
        const activeRepository = appContext.airport.activeRepository;
        repositoryScope.repositoryId = repositoryId || undefined;
        repositoryScope.repository =
            activeRepository?.id === repositoryId
                ? activeRepository
                : undefined;
        repositoryScope.loading = appContext.airport.activeRepositoryLoading;
        repositoryScope.error =
            appContext.airport.activeRepositoryError ?? null;
    });

    const activeRepository = $derived(repositoryScope.repository);
    const repositoryLoading = $derived(repositoryScope.loading);
    const repositoryError = $derived(repositoryScope.error);
    const repositorySummary = $derived(activeRepository?.summary);
    const repositoryDisplayName = $derived(
        activeRepository?.displayName ?? "Repository",
    );
    const repositoryDisplayDescription = $derived(
        activeRepository?.displayDescription ?? "Repository unavailable",
    );
    const repositoryOperationalMode = $derived(
        activeRepository?.operationalMode,
    );
    const repositoryControlRoot = $derived(
        activeRepository?.controlRoot ?? repositorySummary?.repositoryRootPath,
    );
    const repositoryCurrentBranch = $derived(activeRepository?.currentBranch);
    const repositoryPlatformRepositoryRef = $derived(
        activeRepository?.platformRepositoryRef ??
            repositorySummary?.platformRepositoryRef,
    );
    const repositorySettingsComplete = $derived(
        activeRepository?.settingsComplete,
    );
    const resolvedMissionCountLabel = $derived(
        activeRepository?.missionCountLabel ?? "0 missions",
    );

    function closeIssuePreview(): void {
        issuePreviewOpen = false;
        selectedIssue = null;
        issueError = null;
    }
</script>

<div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
    {#if repositoryLoading && !activeRepository}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 text-sm text-muted-foreground backdrop-blur-sm"
        >
            Loading repository surface...
        </section>
    {:else if repositoryError || !activeRepository || !repositorySummary}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
        >
            <h2 class="text-lg font-semibold text-foreground">Repository</h2>
            <p class="mt-3 text-sm text-rose-600">
                {repositoryError ?? "Repository snapshot could not be loaded."}
            </p>
        </section>
    {:else}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
        >
            <div class="flex items-start justify-between gap-4">
                <div>
                    <p
                        class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                    >
                        Repository
                    </p>
                    <h1 class="mt-2 text-2xl font-semibold text-foreground">
                        {repositoryDisplayName}
                    </h1>
                    <p class="mt-1 text-sm text-muted-foreground">
                        {repositoryDisplayDescription}
                    </p>
                    <p class="mt-2 font-mono text-xs text-muted-foreground">
                        {repositorySummary.repositoryRootPath}
                    </p>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                    <Badge variant="secondary"
                        >{resolvedMissionCountLabel}</Badge
                    >
                    {#if repositoryOperationalMode}
                        <Badge variant="outline"
                            >{repositoryOperationalMode}</Badge
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
                        {repositoryPlatformRepositoryRef ?? "Not configured"}
                    </p>
                </div>
                <div class="rounded-xl border bg-background/70 px-4 py-3">
                    <p
                        class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                    >
                        Setup
                    </p>
                    <p class="mt-2 text-sm font-medium text-foreground">
                        {repositorySettingsComplete === false
                            ? "Incomplete"
                            : "Ready"}
                    </p>
                </div>
            </div>
        </section>

        {#key activeRepository.id}
            <div
                class="mt-4 grid min-h-0 flex-1 gap-4 overflow-hidden sm:grid-cols-2"
            >
                <section class="flex min-h-0 w-full overflow-hidden">
                    <RepositoryList mode="missions" />
                </section>

                <section class="flex min-h-0 w-full overflow-hidden">
                    <IssueList
                        bind:selectedIssue
                        bind:issuePreviewOpen
                        bind:issueError
                        bind:issueLoadingNumber
                    />
                </section>
            </div>
        {/key}

        <Dialog.Root bind:open={issuePreviewOpen}>
            <Dialog.Content
                class="flex h-[100dvh] max-h-[100dvh] min-h-0 w-full max-w-[100vw] flex-col overflow-hidden sm:h-[80dvh] sm:max-h-[80dvh] sm:max-w-4xl"
            >
                {#if selectedIssue}
                    <IssuePreview
                        {selectedIssue}
                        onClose={closeIssuePreview}
                        embedded
                    />
                {/if}
            </Dialog.Content>
        </Dialog.Root>
    {/if}
</div>
