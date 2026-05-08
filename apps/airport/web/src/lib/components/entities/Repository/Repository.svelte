<script lang="ts">
    import { goto } from "$app/navigation";
    import type { RepositoryIssueDetailType } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import { page } from "$app/state";
    import type { Repository as RepositoryEntity } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { setAgentExecutionSurfaceContext } from "$lib/client/context/agent-execution-surface-context.svelte.js";
    import { setScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
    import AgentChat from "$lib/components/entities/AgentExecution/AgentChat.svelte";
    import IssueList from "$lib/components/entities/Issue/IssueList.svelte";
    import IssuePreview from "$lib/components/entities/Issue/IssuePreview.svelte";
    import MissionList from "$lib/components/entities/Mission/MissionList.svelte";
    import RepositoryPanel from "$lib/components/entities/Repository/RepositoryPanel.svelte";
    import RepositoryCommandbar from "$lib/components/entities/Repository/RepositoryCommandbar.svelte";
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
    const agentExecutionSurfaceState = $state<{
        surfaceId?: string;
        surfacePath?: string;
        loading: boolean;
        error?: string | null;
    }>({ loading: true });
    const repositoryScope = setScopedRepositoryContext(repositoryScopeState);
    const agentExecutionSurface = setAgentExecutionSurfaceContext(
        agentExecutionSurfaceState,
    );

    let selectedIssue = $state<RepositoryIssueDetailType | null>(null);
    let issuePreviewOpen = $state(false);
    let issueError = $state<string | null>(null);
    let issueLoadingNumber = $state<number | null>(null);
    let routeRepositoryResolved = $state(false);
    let setupAgentExecutionRequestKey = $state("");
    let setupAgentExecutionRefreshNonce = $state(0);
    let setupAgentExecutionError = $state<string | null>(null);

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
        agentExecutionSurface.surfaceId = repositoryScope.repositoryId;
        agentExecutionSurface.surfacePath =
            repositoryScope.repository?.data.repositoryRootPath;
        agentExecutionSurface.loading = repositoryScope.loading;
        agentExecutionSurface.error = repositoryScope.error;
    });

    const activeRepository = $derived(repositoryScope.repository);
    const repositoryLoading = $derived(repositoryScope.loading);
    const repositoryError = $derived(repositoryScope.error);
    const invalidState = $derived(activeRepository?.data.invalidState);
    const setupRoute = $derived(page.url.pathname.endsWith("/setup"));
    const showSetupSurface = $derived(
        setupRoute ||
            Boolean(invalidState) ||
            !activeRepository?.data.isInitialized,
    );
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

    async function refreshSetupAgentExecution(): Promise<void> {
        setupAgentExecutionRefreshNonce += 1;
        await activeRepository?.refreshSetupAgentExecution();
    }

    $effect(() => {
        repositoryId;
        routeRepositoryResolved = false;
    });

    $effect(() => {
        if (activeRepository?.id === repositoryId) {
            routeRepositoryResolved = true;
        }
    });

    $effect(() => {
        if (
            !repositoryId ||
            !routeRepositoryResolved ||
            repositoryLoading ||
            repositoryError ||
            activeRepository ||
            appContext.airport.activeRepositoryId
        ) {
            return;
        }

        void goto("/airport");
    });

    $effect(() => {
        if (!activeRepository || !showSetupSurface) {
            return;
        }

        const requestKey = `${activeRepository.id}:${activeRepository.data.repositoryRootPath}`;
        if (setupAgentExecutionRequestKey === requestKey) {
            return;
        }

        setupAgentExecutionRequestKey = requestKey;
        setupAgentExecutionError = null;
        void activeRepository
            .ensureSetupAgentExecution()
            .then(() => {
                setupAgentExecutionRefreshNonce += 1;
            })
            .catch((error) => {
                setupAgentExecutionError =
                    error instanceof Error ? error.message : String(error);
            });
    });
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
        {#if activeRepositoryPanelItem && activeRepository.data.isInitialized && !setupRoute}
            <RepositoryPanel
                repository={activeRepositoryPanelItem}
                localRepository={activeRepository}
                onCommandExecuted={refreshRepositories}
            />
        {/if}

        {#if invalidState}
            <section
                class="border-y border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
                <p class="font-medium">This repository needs setup.</p>
                <p class="mt-1 text-destructive/85">
                    Use the setup chat to review it and continue.
                </p>
            </section>
        {/if}

        {#if showSetupSurface}
            <AgentChat
                agentExecution={activeRepository.setupAgentExecution}
                refreshNonce={setupAgentExecutionRefreshNonce}
                onCommandExecuted={refreshSetupAgentExecution}
            />
            {#if setupAgentExecutionError}
                <div
                    class="border-t px-4 py-3 text-sm text-muted-foreground md:px-5"
                >
                    The assistant is not available right now.
                </div>
            {/if}
            <div class="border-t bg-background/95 px-4 py-3 md:px-5">
                <RepositoryCommandbar
                    repository={activeRepository}
                    onCommandExecuted={refreshRepositories}
                    class="min-h-9"
                    showEmptyState
                />
            </div>
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
