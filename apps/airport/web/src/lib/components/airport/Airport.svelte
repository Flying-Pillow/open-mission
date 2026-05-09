<script lang="ts">
    import Icon from "@iconify/svelte";
    import {
        AgentExecutionDataSchema,
        type AgentExecutionDataType,
    } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";
    import { cmd } from "../../../routes/api/entities/remote/command.remote";
    import { qry } from "../../../routes/api/entities/remote/query.remote";
    import { setAgentExecutionSurfaceContext } from "$lib/client/context/agent-execution-surface-context.svelte.js";
    import { AgentExecution } from "$lib/components/entities/AgentExecution/AgentExecution.svelte.js";
    import AgentChat from "$lib/components/entities/AgentExecution/AgentChat.svelte";
    import RepositoryList from "$lib/components/entities/Repository/RepositoryList.svelte";
    import { Repository as RepositoryEntity } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { Button } from "$lib/components/ui/button/index.js";

    const agentExecutionSurface = setAgentExecutionSurfaceContext({
        surfaceId: "repositories",
        surfacePath: "/repositories",
        loading: false,
        error: null,
    });

    let repositoriesAgentExecution = $state<AgentExecution | undefined>();
    let repositoriesAgentRefreshNonce = $state(0);
    let repositoriesAgentError = $state<string | null>(null);
    let repositoriesAgentLoading = $state(false);
    let repositoriesAgentRequested = $state(false);
    let showTerminalPanel = $state(false);

    const canShowTerminalPanel = $derived(
        Boolean(repositoriesAgentExecution?.isTerminalBacked()),
    );

    $effect(() => {
        agentExecutionSurface.surfaceId = "repositories";
        agentExecutionSurface.surfacePath =
            repositoriesAgentExecution?.workingDirectory ?? "/repositories";
        agentExecutionSurface.loading = repositoriesAgentLoading;
        agentExecutionSurface.error = repositoriesAgentError;
    });

    $effect(() => {
        if (repositoriesAgentRequested) {
            return;
        }

        repositoriesAgentRequested = true;
        void ensureRepositoriesAgentExecution();
    });

    function toggleTerminalPanel(): void {
        if (!canShowTerminalPanel) {
            return;
        }

        showTerminalPanel = !showTerminalPanel;
    }

    async function ensureRepositoriesAgentExecution(): Promise<void> {
        repositoriesAgentLoading = true;
        repositoriesAgentError = null;
        try {
            const data = AgentExecutionDataSchema.parse(
                await RepositoryEntity.executeClassCommand(
                    "ensureSystemAgentExecution",
                ),
            );
            applyRepositoriesAgentExecution(data);
            repositoriesAgentRefreshNonce += 1;
        } catch (error) {
            repositoriesAgentError =
                error instanceof Error ? error.message : String(error);
        } finally {
            repositoriesAgentLoading = false;
        }
    }

    async function refreshRepositoriesAgentExecution(): Promise<void> {
        const execution = repositoriesAgentExecution;
        if (!execution) {
            return;
        }

        const refreshed = AgentExecutionDataSchema.parse(
            await qry({
                entity: "AgentExecution",
                method: "read",
                payload: {
                    ownerId: execution.ownerId,
                    sessionId: execution.sessionId,
                },
            }).run(),
        );
        applyRepositoriesAgentExecution(refreshed);
        repositoriesAgentRefreshNonce += 1;
    }

    function applyRepositoriesAgentExecution(
        data: AgentExecutionDataType,
    ): void {
        const nextData = AgentExecutionDataSchema.parse(data);
        if (repositoriesAgentExecution?.sessionId === nextData.sessionId) {
            repositoriesAgentExecution.updateFromData(nextData);
            return;
        }

        repositoriesAgentExecution = new AgentExecution(nextData, {
            resolveCommands: () => [],
            executeCommand: async (ownerId, sessionId, commandId, input) => {
                await cmd({
                    entity: "AgentExecution",
                    method: "command",
                    payload: {
                        ownerId,
                        sessionId,
                        commandId,
                        ...(input !== undefined ? { input } : {}),
                    },
                });
                await refreshRepositoriesAgentExecution();
            },
        });
    }
</script>

<div class="flex min-h-0 flex-1 flex-col">
    <section
        class="rounded-2xl border bg-card/70 px-4 py-3 backdrop-blur-sm md:px-5"
    >
        <div class="flex min-w-0 items-center justify-between gap-3">
            <div class="min-w-0">
                <h1 class="text-lg font-semibold text-foreground">
                    Repositories
                </h1>
            </div>

            <Button
                type="button"
                variant={showTerminalPanel ? "secondary" : "outline"}
                size="sm"
                class="h-9 max-w-48 rounded-md border-white/15 bg-white/[0.04] px-3 text-slate-100 shadow-none hover:bg-white/[0.08]"
                disabled={!canShowTerminalPanel}
                aria-label={showTerminalPanel
                    ? "Hide repositories AgentExecution terminal"
                    : "Show repositories AgentExecution terminal"}
                title={showTerminalPanel
                    ? "Hide repositories AgentExecution terminal"
                    : canShowTerminalPanel
                      ? "Show repositories AgentExecution terminal"
                      : "AgentExecution terminal is not available"}
                onclick={toggleTerminalPanel}
            >
                <Icon
                    icon={repositoriesAgentExecution?.agentId
                        ?.toLowerCase()
                        .includes("copilot")
                        ? "simple-icons:githubcopilot"
                        : repositoriesAgentExecution?.agentId
                                ?.toLowerCase()
                                .includes("openai") ||
                            repositoriesAgentExecution?.agentId
                                ?.toLowerCase()
                                .includes("codex")
                          ? "simple-icons:openai"
                          : repositoriesAgentExecution?.agentId
                                  ?.toLowerCase()
                                  .includes("claude") ||
                              repositoriesAgentExecution?.agentId
                                  ?.toLowerCase()
                                  .includes("anthropic")
                            ? "simple-icons:anthropic"
                            : repositoriesAgentExecution?.agentId
                                    ?.toLowerCase()
                                    .includes("opencode")
                              ? "lucide:code-2"
                              : repositoriesAgentExecution?.agentId
                                      ?.toLowerCase()
                                      .includes("pi")
                                ? "lucide:message-circle"
                                : "lucide:bot"}
                    class="size-4 text-emerald-200"
                    data-icon="inline-start"
                />
                <span class="min-w-0 truncate">
                    {repositoriesAgentExecution?.adapterLabel ?? "Agent"}
                </span>
            </Button>
        </div>
    </section>

    <div
        class="mt-4 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-[20dvw_minmax(0,1fr)]"
    >
        <div class="flex min-h-0 flex-col gap-5 overflow-hidden xl:pr-2">
            <section class="flex min-h-0 w-full flex-1 overflow-hidden">
                <RepositoryList
                    repositoryFilter="local"
                    eyebrow="Local"
                    heading="Checked out repositories"
                    description="Working copies already available inside Airport."
                    presentation="rail"
                />
            </section>

            <section class="flex min-h-0 w-full flex-1 overflow-hidden">
                <RepositoryList
                    repositoryFilter="external"
                    eyebrow="GitHub"
                    heading="External repositories"
                    description="Repositories discovered from GitHub that can be cloned into the workspace."
                    presentation="rail"
                />
            </section>
        </div>

        <section
            class="flex min-h-0 min-w-0 overflow-hidden rounded-2xl border border-white/10"
        >
            <AgentChat
                agentExecution={repositoriesAgentExecution}
                refreshNonce={repositoriesAgentRefreshNonce}
                onCommandExecuted={refreshRepositoriesAgentExecution}
                loadingTitle="Starting repositories chat"
                loadingPlaceholder="Starting repositories chat"
                bind:showTerminalPanel
                showHeader={false}
            />
        </section>
    </div>

    {#if repositoriesAgentError}
        <div class="border-t px-4 py-3 text-sm text-muted-foreground md:px-5">
            The repositories assistant is not available right now.
        </div>
    {/if}
</div>
