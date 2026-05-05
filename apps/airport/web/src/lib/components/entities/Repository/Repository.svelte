<script lang="ts">
    import type { RepositoryIssueDetailType } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import { page } from "$app/state";
    import type { Repository as RepositoryEntity } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { setScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
    import IssueList from "$lib/components/entities/Issue/IssueList.svelte";
    import IssuePreview from "$lib/components/entities/Issue/IssuePreview.svelte";
    import MissionList from "$lib/components/entities/Mission/MissionList.svelte";
    import RepositoryPanel from "$lib/components/entities/Repository/RepositoryPanel.svelte";
    import RepositorySetup from "$lib/components/entities/Repository/RepositorySetup.svelte";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import type { AirportRepositoryListItem } from "$lib/components/entities/types";

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

    let selectedIssue = $state<RepositoryIssueDetailType | null>(null);
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
    const activeRepositoryPanelItem = $derived.by(
        (): AirportRepositoryListItem | undefined => {
            if (!activeRepository) {
                return undefined;
            }

            const listedRepository =
                appContext.application.repositoryListItems.find(
                    (repository) => repository.key === activeRepository.id,
                );
            if (listedRepository) {
                return listedRepository;
            }

            const platformRepositoryRef =
                activeRepository.data.platformRepositoryRef ?? undefined;
            return {
                key: activeRepository.id,
                local: {
                    ...activeRepository.data,
                    missions: activeRepository.missions,
                },
                displayName:
                    platformRepositoryRef ?? activeRepository.data.repoName,
                displayDescription:
                    platformRepositoryRef ??
                    activeRepository.data.repositoryRootPath,
                repositoryRootPath: activeRepository.data.repositoryRootPath,
                ...(platformRepositoryRef ? { platformRepositoryRef } : {}),
                missions: activeRepository.missions,
                isLocal: true,
            };
        },
    );

    function closeIssuePreview(): void {
        issuePreviewOpen = false;
        selectedIssue = null;
        issueError = null;
    }

    async function refreshRepositories(): Promise<void> {
        await appContext.application.loadRepositories({ force: true });
    }
</script>

<div class="flex min-h-0 flex-1 flex-col">
    {#if repositoryLoading && !activeRepository}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 text-sm text-muted-foreground backdrop-blur-sm"
        >
            Loading repository surface...
        </section>
    {:else if repositoryError || !activeRepository}
        <section class="rounded-2xl border bg-card/70 backdrop-blur-sm">
            <h2 class="text-lg font-semibold text-foreground">Repository</h2>
            <p class="mt-3 text-sm text-rose-600">
                {repositoryError ?? "Repository data could not be loaded."}
            </p>
        </section>
    {:else}
        {#if activeRepositoryPanelItem}
            <RepositoryPanel
                repository={activeRepositoryPanelItem}
                localRepository={activeRepository}
                onCommandExecuted={refreshRepositories}
            />
        {/if}

        {#if !activeRepository.data.isInitialized}
            <RepositorySetup
                repository={activeRepository}
                onSetupSubmitted={refreshRepositories}
            />
        {:else}
            <div class="grid min-h-0 flex-1 overflow-hidden sm:grid-cols-2">
                <section class="flex min-h-0 w-full overflow-hidden">
                    <MissionList />
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
        {/if}

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
