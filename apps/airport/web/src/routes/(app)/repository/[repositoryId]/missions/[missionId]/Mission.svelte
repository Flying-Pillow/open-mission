<script lang="ts">
    import { page } from "$app/state";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import type { Mission } from "$lib";
    import ArtifactEditor from "$lib/components/entities/Artifact/ArtifactEditor.svelte";
    import ArtifactViewer from "$lib/components/entities/Artifact/ArtifactViewer.svelte";
    import MissionControlTree from "$lib/components/entities/Mission/MissionControlTree.svelte";
    import MissionFileTree from "$lib/components/entities/Mission/MissionFileTree.svelte";
    import MissionTerminal from "$lib/components/entities/Mission/MissionTerminal.svelte";
    import MissionView from "$lib/components/entities/Mission/Mission.svelte";
    import AgentSession from "$lib/components/entities/AgentSession/AgentSession.svelte";
    import type { AgentSession as AgentSessionModel } from "$lib/client/entities/AgentSession";
    import {
        computeMissionControlState,
        createInitialSelectedNodeId,
    } from "$lib/components/entities/Mission/missionControl";
    import {
        ResizableHandle,
        ResizablePane,
        ResizablePaneGroup,
    } from "$lib/components/ui/resizable";
    import * as Tabs from "$lib/components/ui/tabs/index.js";
    import type { MissionFileTreeNode } from "$lib/types/mission-file-tree";
    import type { MissionControlSnapshot } from "$lib/types/mission-control";
    import type { AirportRuntimeEventEnvelope } from "@flying-pillow/mission-core";

    const appContext = getAppContext();
    const routeRepositoryId = $derived(page.params.repositoryId?.trim() ?? "");
    const routeMissionId = $derived(page.params.missionId?.trim() ?? "");

    let pageLoadError = $state<string | null>(null);
    let pageLoading = $state(true);
    let loadedRouteKey = $state<string | null>(null);

    let controlLoading = $state(false);
    let controlError = $state<string | null>(null);
    let runtimeError = $state<string | null>(null);
    let actionRefreshNonce = $state(0);
    let artifactPanelMode = $state<"view" | "edit">("view");
    let leftTreeMode = $state<"control" | "files">("control");
    let rightPanelMode = $state<"terminal" | "agent">("terminal");
    let lastSelectedAgentSessionId = $state<string | null>(null);
    let selectedWorktreeNode = $state<MissionFileTreeNode | null>(null);
    let artifactPanelSourceKey = $state<string | null>(null);

    let controlRefreshTimer: number | null = null;
    let missionRefreshTimer: number | null = null;
    let refreshQueued = false;

    const repository = $derived.by(() => {
        const activeRepository = appContext.airport.activeRepository;
        if (!activeRepository || activeRepository.repositoryId !== routeRepositoryId) {
            return null;
        }

        return activeRepository;
    });
    const mission = $derived.by(() => {
        const activeMission = appContext.airport.activeMission;
        if (!activeMission || activeMission.missionId !== routeMissionId) {
            return null;
        }

        return activeMission;
    });
    const controlSnapshot = $derived(mission?.controlSnapshot ?? null);
    const missionWorktreePath = $derived(mission?.missionWorktreePath ?? "");
    const missionId = $derived(mission?.missionId ?? routeMissionId);

    const selectedNodeId = $derived.by(() => {
        if (!controlSnapshot) {
            return undefined;
        }

        const treeNodes = controlSnapshot.operatorStatus.tower?.treeNodes ?? [];
        const requestedNodeId = appContext.airport.activeMissionSelectedNodeId;

        if (
            requestedNodeId &&
            treeNodes.some((node) => node.id === requestedNodeId)
        ) {
            return requestedNodeId;
        }

        return createInitialSelectedNodeId(
            controlSnapshot.operatorStatus,
            requestedNodeId,
        );
    });
    const controlState = $derived(
        controlSnapshot
            ? computeMissionControlState({
                  status: controlSnapshot.operatorStatus,
                  selectedNodeId,
              })
            : null,
    );
    const missionOutline = $derived({
        title: controlSnapshot?.operatorStatus.title,
        currentStageId: controlSnapshot?.operatorStatus.workflow?.currentStageId,
        briefPath: controlSnapshot?.operatorStatus.productFiles?.brief,
        treeNodes: controlSnapshot?.operatorStatus.tower?.treeNodes ?? [],
    });
    const activeArtifactPath = $derived(controlState?.activeArtifactPath);
    const selectedWorktreeFile = $derived(
        selectedWorktreeNode?.kind === "file" ? selectedWorktreeNode : null,
    );
    const displayArtifactPath = $derived(
        selectedWorktreeFile?.absolutePath ?? activeArtifactPath,
    );
    const displayArtifactLabel = $derived(
        selectedWorktreeFile?.name ?? controlState?.activeArtifact?.displayLabel,
    );
    const displayStageId = $derived(
        selectedWorktreeFile
            ? undefined
            : controlState?.resolvedSelection?.stageId,
    );
    const displayTaskId = $derived(
        selectedWorktreeFile
            ? undefined
            : controlState?.resolvedSelection?.taskId,
    );
    const showArtifactEditor = $derived.by(() => {
        if (!displayArtifactPath) {
            return false;
        }

        if (!selectedWorktreeFile) {
            return artifactPanelMode === "edit";
        }

        return (
            !isMarkdownPath(displayArtifactPath) || artifactPanelMode === "edit"
        );
    });
    const resolvedSession = $derived(
        controlState?.activeSessionId && mission
            ? mission.getSession(controlState.activeSessionId)
            : mission ? resolvePreferredTaskSession(
                  mission,
                  controlState?.resolvedSelection?.taskId,
              ) : undefined,
    );

    $effect(() => {
        const routeKey = `${routeRepositoryId}:${routeMissionId}`;
        if (!routeRepositoryId || !routeMissionId || loadedRouteKey === routeKey) {
            return;
        }

        loadedRouteKey = routeKey;
        pageLoading = true;
        pageLoadError = null;
        selectedWorktreeNode = null;

        void (async () => {
            try {
                await appContext.application.openMissionRoute({
                    repositoryId: routeRepositoryId,
                    missionId: routeMissionId,
                });
            } catch (error) {
                pageLoadError = error instanceof Error ? error.message : String(error);
            } finally {
                pageLoading = false;
            }
        })();
    });

    $effect(() => {
        if (!controlState) {
            return;
        }

        const activeSessionId = controlState.activeSessionId ?? null;
        if (activeSessionId && activeSessionId !== lastSelectedAgentSessionId) {
            rightPanelMode = "agent";
        }

        lastSelectedAgentSessionId = activeSessionId;
    });

    $effect(() => {
        if (!missionId || !selectedNodeId) {
            return;
        }

        if (appContext.airport.activeMissionSelectedNodeId !== selectedNodeId) {
            appContext.setActiveMissionSelectedNodeId(selectedNodeId);
        }
    });

    $effect(() => {
        const nextSourceKey =
            selectedWorktreeFile?.absolutePath ?? activeArtifactPath ?? null;
        if (artifactPanelSourceKey === nextSourceKey) {
            return;
        }

        artifactPanelSourceKey = nextSourceKey;
        artifactPanelMode =
            selectedWorktreeFile &&
            nextSourceKey &&
            !isMarkdownPath(nextSourceKey)
                ? "edit"
                : "view";
    });

    $effect(() => {
        if (!missionId || !missionWorktreePath) {
            return;
        }

        const subscription = appContext.observeMission({
            missionId,
            repositoryRootPath: missionWorktreePath,
            onUpdate: (_, event) => {
                runtimeError = null;
                handleMissionRuntimeEvent(event);
            },
            onError: (error) => {
                runtimeError = error.message;
            },
        });

        return () => {
            subscription.dispose();
            if (controlRefreshTimer !== null) {
                window.clearTimeout(controlRefreshTimer);
            }
            if (missionRefreshTimer !== null) {
                window.clearTimeout(missionRefreshTimer);
            }
        };
    });

    async function refreshMissionRuntimeSnapshot(): Promise<void> {
        if (!mission) {
            return;
        }

        try {
            await mission.refresh();
            runtimeError = null;
        } catch (error) {
            runtimeError =
                error instanceof Error ? error.message : String(error);
        }
    }

    async function refreshControlSnapshot(): Promise<void> {
        if (!mission || !missionWorktreePath) {
            return;
        }

        if (controlLoading) {
            refreshQueued = true;
            return;
        }

        controlLoading = true;
        controlError = null;
        try {
            const nextSnapshot = await mission.getControlSnapshot();
            appContext.application.syncMissionControlState({
                controlSnapshot: nextSnapshot,
                repositoryRootPath: missionWorktreePath,
            });
        } catch (error) {
            controlError =
                error instanceof Error ? error.message : String(error);
        } finally {
            controlLoading = false;
            if (refreshQueued) {
                refreshQueued = false;
                void refreshControlSnapshot();
            }
        }
    }

    function scheduleControlRefresh(): void {
        if (controlRefreshTimer !== null) {
            window.clearTimeout(controlRefreshTimer);
        }
        controlRefreshTimer = window.setTimeout(() => {
            controlRefreshTimer = null;
            void refreshControlSnapshot();
        }, 150);
    }

    function scheduleMissionRuntimeRefresh(): void {
        if (missionRefreshTimer !== null) {
            window.clearTimeout(missionRefreshTimer);
        }
        missionRefreshTimer = window.setTimeout(() => {
            missionRefreshTimer = null;
            void refreshMissionRuntimeRefresh();
        }, 100);
    }

    async function refreshMissionRuntimeRefresh(): Promise<void> {
        await refreshMissionRuntimeSnapshot();
    }

    function applyMissionStatusEvent(
        event: AirportRuntimeEventEnvelope,
    ): void {
        const payload = event.payload as {
            status?: MissionControlSnapshot["operatorStatus"];
        };
        if (!payload.status || !mission) {
            return;
        }

        mission.applyOperatorStatus(payload.status);
        appContext.setActiveMissionOutline({
            title: payload.status.title,
            currentStageId: payload.status.workflow?.currentStageId,
            briefPath: payload.status.productFiles?.brief,
            treeNodes: payload.status.tower?.treeNodes ?? [],
        });
    }

    function handleMissionRuntimeEvent(
        event: AirportRuntimeEventEnvelope,
    ): void {
        switch (event.type) {
            case "mission.status":
                applyMissionStatusEvent(event);
                return;
            case "session.lifecycle":
                scheduleMissionRuntimeRefresh();
                return;
            case "mission.actions.changed":
                actionRefreshNonce += 1;
                scheduleControlRefresh();
                return;
            default:
                return;
        }
    }

    async function handleMissionMutated(): Promise<void> {
        await refreshControlSnapshot();
    }

    function handleSelectNode(nodeId: string): void {
        selectedWorktreeNode = null;
        appContext.setActiveMissionSelectedNodeId(nodeId);
    }

    function handleSelectWorktreeNode(node: MissionFileTreeNode): void {
        selectedWorktreeNode = node.kind === "file" ? node : null;
    }

    function handleEditArtifact(): void {
        artifactPanelMode = "edit";
    }

    function handleCloseArtifactEditor(): void {
        if (
            selectedWorktreeFile?.absolutePath &&
            !isMarkdownPath(selectedWorktreeFile.absolutePath)
        ) {
            selectedWorktreeNode = null;
        }

        artifactPanelMode = "view";
    }

    function isMarkdownPath(filePath: string | undefined): boolean {
        const extension = filePath?.split(".").pop()?.toLowerCase();
        return (
            extension === "md" ||
            extension === "markdown" ||
            extension === "mdx"
        );
    }

    function resolvePreferredTaskSession(
        currentMission: Mission,
        taskId: string | undefined,
    ): AgentSessionModel | undefined {
        if (!taskId) {
            return undefined;
        }

        const sessions = currentMission
            .listSessions()
            .filter((session) => session.taskId === taskId);
        return (
            sessions.find(
                (session) => session.isRunning() && session.isTerminalBacked(),
            ) ??
            sessions.find((session) => session.isRunning()) ??
            sessions.find((session) => session.isTerminalBacked()) ??
            sessions[0]
        );
    }
</script>

<div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2 gap-4">
    {#if pageLoading && !mission}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 text-sm text-muted-foreground backdrop-blur-sm"
        >
            Loading mission surface...
        </section>
    {:else if pageLoadError || !controlSnapshot || !repository || !mission || !controlState}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
        >
            <h2 class="text-lg font-semibold text-foreground">Mission control</h2>
            <p class="mt-3 text-sm text-rose-600">
                {pageLoadError ?? "Mission surface could not be loaded."}
            </p>
        </section>
    {:else}
    {#if controlError || runtimeError}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
        >
            {#if controlError}
                <p class="text-sm text-rose-600">{controlError}</p>
            {/if}
            {#if runtimeError}
                <p class="text-sm text-rose-600">{runtimeError}</p>
            {/if}
        </section>
    {/if}

    <MissionView
        refreshNonce={actionRefreshNonce}
        operatorStatus={controlSnapshot.operatorStatus}
        selectionState={controlState}
        onSelectNode={handleSelectNode}
        onMissionMutated={handleMissionMutated}
    />
    <ResizablePaneGroup
        direction="horizontal"
        class="min-h-0 flex-1 overflow-hidden"
        autoSaveId={`mission-control:${missionId}`}
    >
        <ResizablePane
            defaultSize={24}
            minSize={18}
            class="flex h-full min-h-0 flex-col p-2"
        >
            <Tabs.Root
                bind:value={leftTreeMode}
                class="min-h-0 flex-1 overflow-hidden rounded-2xl border bg-card/70 backdrop-blur-sm"
            >
                <div class="border-b px-3 py-2">
                    <Tabs.List class="w-full">
                        <Tabs.Trigger value="control"
                            >Mission Control</Tabs.Trigger
                        >
                        <Tabs.Trigger value="files"
                            >Mission Files</Tabs.Trigger
                        >
                    </Tabs.List>
                </div>

                <Tabs.Content
                    value="control"
                    class="min-h-0 flex-1 overflow-hidden p-0"
                >
                    <MissionControlTree
                        outline={missionOutline}
                        {missionId}
                        activeNodeId={selectedNodeId}
                        title="Mission control"
                        class="h-full rounded-none border-0 bg-transparent"
                        onSelectNode={handleSelectNode}
                    />
                </Tabs.Content>

                <Tabs.Content
                    value="files"
                    class="min-h-0 flex-1 overflow-hidden p-0"
                >
                    <MissionFileTree
                        activePath={selectedWorktreeFile?.absolutePath}
                        refreshNonce={actionRefreshNonce}
                        class="h-full rounded-none border-0 bg-transparent"
                        onSelectPath={handleSelectWorktreeNode}
                    />
                </Tabs.Content>
            </Tabs.Root>
        </ResizablePane>

        <ResizableHandle withHandle />

        <ResizablePane
            defaultSize={38}
            minSize={24}
            class="flex h-full min-h-0 flex-col p-2"
        >
            {#if showArtifactEditor}
                <ArtifactEditor
                    artifactPath={displayArtifactPath}
                    artifactLabel={displayArtifactLabel}
                    onCloseRequested={handleCloseArtifactEditor}
                />
            {:else}
                <ArtifactViewer
                    refreshNonce={actionRefreshNonce}
                    artifactPath={displayArtifactPath}
                    artifactLabel={displayArtifactLabel}
                    stageId={displayStageId}
                    taskId={displayTaskId}
                    onEditRequested={handleEditArtifact}
                    onActionExecuted={handleMissionMutated}
                />
            {/if}
        </ResizablePane>

        <ResizableHandle withHandle />

        <ResizablePane
            defaultSize={38}
            minSize={24}
            class="flex h-full min-h-0 flex-col p-2"
        >
            <Tabs.Root
                bind:value={rightPanelMode}
                class="min-h-0 flex-1 overflow-hidden rounded-2xl border bg-card/70 backdrop-blur-sm"
            >
                <div class="border-b px-3 py-2">
                    <Tabs.List class="w-full">
                        <Tabs.Trigger value="terminal"
                            >Mission Terminal</Tabs.Trigger
                        >
                        <Tabs.Trigger value="agent"
                            >Agent Session</Tabs.Trigger
                        >
                    </Tabs.List>
                </div>

                <div
                    class="relative min-h-0 flex-1 overflow-hidden p-0"
                >
                    <div
                        class={`absolute inset-0 min-h-0 overflow-hidden ${rightPanelMode === "terminal" ? "block" : "hidden"}`}
                        aria-hidden={rightPanelMode !== "terminal"}
                    >
                        <MissionTerminal active={rightPanelMode === "terminal"} />
                    </div>

                    <div
                        class={`absolute inset-0 min-h-0 overflow-hidden ${rightPanelMode === "agent" ? "block" : "hidden"}`}
                        aria-hidden={rightPanelMode !== "agent"}
                    >
                        <AgentSession
                            refreshNonce={actionRefreshNonce}
                            stageId={controlState.resolvedSelection
                                ?.stageId}
                            session={resolvedSession}
                            active={rightPanelMode === "agent"}
                            onActionExecuted={handleMissionMutated}
                        />
                    </div>
                </div>
            </Tabs.Root>
        </ResizablePane>
    </ResizablePaneGroup>
    {/if}
</div>