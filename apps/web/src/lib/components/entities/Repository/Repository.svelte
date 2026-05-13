<script lang="ts">
    import type { RepositoryIssueDetailType } from "@flying-pillow/open-mission-core/entities/Repository/RepositorySchema";
    import { onMount } from "svelte";
    import { MediaQuery } from "svelte/reactivity";
    import { app } from "$lib/client/Application.svelte.js";
    import AgentChat from "$lib/components/entities/AgentExecution/AgentChat.svelte";
    import CodeIntelligence from "$lib/components/entities/CodeIntelligence/CodeIntelligence.svelte";
    import IssuePreview from "$lib/components/entities/Issue/IssuePreview.svelte";
    import RepositoryWorkList from "$lib/components/entities/Repository/RepositoryWorkList.svelte";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import {
        ResizableHandle,
        ResizablePane,
        ResizablePaneGroup,
    } from "$lib/components/ui/resizable";

    let selectedIssue = $state<RepositoryIssueDetailType | null>(null);
    let issuePreviewOpen = $state(false);
    let issueError = $state<string | null>(null);
    let issueLoadingNumber = $state<number | null>(null);
    let repositoryChatRequestKey = $state("");
    let repositoryChatRefreshNonce = $state(0);
    let repositoryChatError = $state<string | null>(null);
    let codeIntelligencePaneGroup = $state<{
        getLayout: () => number[];
        setLayout: (layout: number[]) => void;
    }>();
    const codeIntelligencePaneQuery = new MediaQuery("min-width: 1280px");

    const invalidState = $derived(app.repository?.data.invalidState);
    const codeIntelligencePaneAvailable = $derived(
        codeIntelligencePaneQuery.current,
    );

    onMount(() => {
        const toggleCodeIntelligencePane = (): void => {
            const codeIntelligenceSize =
                codeIntelligencePaneGroup?.getLayout()[1] ?? 0;
            codeIntelligencePaneGroup?.setLayout(
                codeIntelligenceSize > 4 ? [100, 0] : [50, 50],
            );
        };

        window.addEventListener(
            "mission:toggle-code-intelligence-pane",
            toggleCodeIntelligencePane,
        );
        return () => {
            window.removeEventListener(
                "mission:toggle-code-intelligence-pane",
                toggleCodeIntelligencePane,
            );
        };
    });

    function closeIssuePreview(): void {
        issuePreviewOpen = false;
        selectedIssue = null;
        issueError = null;
    }

    async function refreshRepositories(): Promise<void> {
        await app.loadRepositories({ force: true });
    }

    async function refreshRepositoryChat(): Promise<void> {
        repositoryChatRefreshNonce += 1;
    }

    $effect(() => {
        if (!app.repository) {
            return;
        }

        const requestKey = `${app.repository.id}:${app.repository.data.repositoryRootPath}`;
        if (repositoryChatRequestKey === requestKey) {
            return;
        }

        repositoryChatRequestKey = requestKey;
        repositoryChatError = null;
        void app.repository
            .ensureRepositoryAgentExecution()
            .then(() => {
                repositoryChatRefreshNonce += 1;
            })
            .catch((error) => {
                repositoryChatError =
                    error instanceof Error ? error.message : String(error);
            });
    });
</script>

{#snippet repositoryChatPane()}
    {#if invalidState || !app.repository?.data.isInitialized}
        <section
            class="mb-2 rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
            <p class="font-medium">Repository manager attention required.</p>
            <p class="mt-1 text-destructive/85">
                Regular mission start stays gated until the repository control
                state is ready. Use the repository chat to review and continue.
            </p>
        </section>
    {/if}

    <section
        class="flex min-h-0 min-w-0 flex-1 overflow-hidden border border-white/10"
    >
        <AgentChat
            ownerEntity={app.repository}
            refreshNonce={repositoryChatRefreshNonce}
            onCommandExecuted={refreshRepositoryChat}
            loadingTitle="Starting repository chat"
            loadingPlaceholder="Starting repository chat"
        />
    </section>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
    {#if app.repositoryLoading && !app.repository}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 text-sm text-muted-foreground backdrop-blur-sm"
        >
            Loading repository surface...
        </section>
    {:else if app.repositoryError || !app.repository}
        <section class="rounded-2xl border bg-card/70 backdrop-blur-sm">
            <h2 class="text-lg font-semibold text-foreground">Repository</h2>
            <p class="mt-3 text-sm text-rose-600">
                {app.repositoryError ?? "Repository data could not be loaded."}
            </p>
        </section>
    {:else}
        <div class="flex min-h-0 flex-1 overflow-hidden">
            <section
                class="flex h-full min-h-0 w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)] shrink-0 flex-col gap-5 overflow-hidden"
            >
                <section class="flex min-h-0 w-full flex-1 overflow-hidden">
                    <RepositoryWorkList
                        bind:selectedIssue
                        bind:issuePreviewOpen
                        bind:issueError
                        bind:issueLoadingNumber
                    />
                </section>
            </section>

            {#if codeIntelligencePaneAvailable}
                <ResizablePaneGroup
                    bind:this={codeIntelligencePaneGroup}
                    direction="horizontal"
                    class="min-h-0 min-w-0 flex-1 overflow-hidden"
                    autoSaveId={`repository-code-intelligence-zero:${app.repository.id}`}
                >
                    <ResizablePane
                        defaultSize={100}
                        minSize={48}
                        class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
                    >
                        {@render repositoryChatPane()}
                    </ResizablePane>

                    <ResizableHandle withHandle />

                    <ResizablePane
                        defaultSize={0}
                        minSize={0}
                        maxSize={52}
                        class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-white/10"
                    >
                        <CodeIntelligence repository={app.repository} />
                    </ResizablePane>
                </ResizablePaneGroup>
            {:else}
                <section
                    class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                >
                    {@render repositoryChatPane()}
                </section>
            {/if}
        </div>
        {#if repositoryChatError}
            <div
                class="border-t px-4 py-3 text-sm text-muted-foreground md:px-5"
            >
                {repositoryChatError}
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
