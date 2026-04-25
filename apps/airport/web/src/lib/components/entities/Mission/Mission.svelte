<script lang="ts">
    import { page } from "$app/state";
    import { onMount } from "svelte";
    import type { Artifact as ArtifactEntity } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import type { Mission as MissionEntity } from "$lib/components/entities/Mission/Mission.svelte.js";
    import ChevronDownIcon from "@tabler/icons-svelte/icons/chevron-down";
    import ChevronUpIcon from "@tabler/icons-svelte/icons/chevron-up";
    import type { AirportRuntimeEventEnvelope } from "@flying-pillow/mission-core";
    import type { OperatorStatus } from "@flying-pillow/mission-core/types.js";
    import type { AgentSession as AgentSessionModel } from "$lib/components/entities/AgentSession/AgentSession.svelte.js";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { setScopedMissionContext } from "$lib/client/context/scoped-mission-context.svelte.js";
    import AgentSession from "$lib/components/entities/AgentSession/AgentSession.svelte";
    import ArtifactEditor from "$lib/components/entities/Artifact/ArtifactEditor.svelte";
    import ArtifactViewer from "$lib/components/entities/Artifact/ArtifactViewer.svelte";
    import MissionActionbar from "$lib/components/entities/Mission/MissionActionbar.svelte";
    import MissionCockpit from "$lib/components/entities/Mission/MissionCockpit.svelte";
    import MissionControlTree from "$lib/components/entities/Mission/MissionControlTree.svelte";
    import MissionFileTree from "$lib/components/entities/Mission/MissionFileTree.svelte";
    import MissionTerminal from "$lib/components/entities/Mission/MissionTerminal.svelte";
    import {
        computeMissionControlState,
        createInitialSelectedNodeId,
        type MissionControlComputedState,
    } from "$lib/components/entities/Mission/missionControl";
    import { operatorStatusSchema } from "$lib/types/mission-control";
    import { Button } from "$lib/components/ui/button/index.js";
    import {
        ResizableHandle,
        ResizablePane,
        ResizablePaneGroup,
    } from "$lib/components/ui/resizable";
    import * as Tabs from "$lib/components/ui/tabs/index.js";
    import type { MissionFileTreeNode } from "$lib/types/mission-file-tree";
    import type { MissionControlSnapshot } from "$lib/types/mission-control";
    import type { Repository as RepositoryEntity } from "$lib/components/entities/Repository/Repository.svelte.js";

    const appContext = getAppContext();
    const repositoryId = page.params.repositoryId?.trim() ?? "";
    const routeMissionId = page.params.missionId?.trim() ?? "";
    const missionScopeState = $state<{
        repositoryId?: string;
        missionId?: string;
        mission?: MissionEntity;
        repository?: RepositoryEntity;
        loading: boolean;
        error?: string | null;
    }>({
        repositoryId: repositoryId || undefined,
        missionId: routeMissionId || undefined,
        loading: true,
    });
    const missionScope = setScopedMissionContext(missionScopeState);
    const activeRepository = $derived(missionScope.repository);
    const activeMission = $derived(missionScope.mission);
    const missionLoading = $derived(missionScope.loading);
    const missionLoadError = $derived(missionScope.error);
    const controlSnapshot = $derived(activeMission?.controlSnapshot);
    const repositorySummary = $derived(activeRepository?.summary);
    const missionWorktreePath = $derived(activeMission?.missionWorktreePath ?? "");
    const missionId = $derived(activeMission?.missionId ?? missionScope.missionId ?? "");

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
    let refreshQueued = false;
    let progressCollapsed = $state(false);

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
    const selectionState = $derived.by((): MissionControlComputedState => {
        if (!controlSnapshot) {
            return {
                treeNodes: [],
                visibleTreeNodes: [],
            };
        }

        return computeMissionControlState({
            status: controlSnapshot.operatorStatus,
            selectedNodeId,
        });
    });
    const missionOutline = $derived({
        title: controlSnapshot?.operatorStatus.title,
        currentStageId: controlSnapshot?.operatorStatus.workflow?.currentStageId,
        briefPath: controlSnapshot?.operatorStatus.productFiles?.brief,
        treeNodes: controlSnapshot?.operatorStatus.tower?.treeNodes ?? [],
    });
    const activeArtifactPath = $derived(selectionState.activeArtifactPath);
    const selectedWorktreeFile = $derived(
        selectedWorktreeNode?.kind === "file" ? selectedWorktreeNode : null,
    );
    const displayArtifactPath = $derived(
        selectedWorktreeFile?.absolutePath ?? activeArtifactPath,
    );
    const displayArtifactLabel = $derived(
        selectedWorktreeFile?.name ?? selectionState.activeArtifact?.displayLabel,
    );
    const displayArtifact = $derived.by((): ArtifactEntity | undefined => {
        if (!activeMission || !displayArtifactPath) {
            return undefined;
        }

        return activeMission.resolveArtifact({
            filePath: displayArtifactPath,
            ...(displayArtifactLabel ? { label: displayArtifactLabel } : {}),
            ...(displayStageId ? { stageId: displayStageId } : {}),
            ...(displayTaskId ? { taskId: displayTaskId } : {})
        });
    });
    const displayStageId = $derived(
        selectedWorktreeFile
            ? undefined
            : selectionState.resolvedSelection?.stageId,
    );
    const displayTaskId = $derived(
        selectedWorktreeFile
            ? undefined
            : selectionState.resolvedSelection?.taskId,
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
        selectionState.activeSessionId && activeMission
            ? activeMission.getSession(selectionState.activeSessionId)
            : activeMission ? resolvePreferredTaskSession(
                activeMission,
                selectionState.resolvedSelection?.taskId,
            ) : undefined,
    );

    const operatorStatus = $derived(
        controlSnapshot?.operatorStatus as OperatorStatus | undefined,
    );
    const workflowLifecycle = $derived(operatorStatus.workflow?.lifecycle);
    const workflowUpdatedAt = $derived(operatorStatus.workflow?.updatedAt);
    const currentStageId = $derived(operatorStatus.workflow?.currentStageId);
    const missionTitle = $derived(operatorStatus?.title ?? activeMission?.missionId ?? missionScope.missionId);

    onMount(async () => {
        try {
            const mission = await appContext.application.openMissionRoute({
                repositoryId,
                missionId: routeMissionId,
            });
            missionScope.mission = mission;
            missionScope.repository = appContext.application.resolveRepository(repositoryId);
            missionScope.error = null;
        } catch (error) {
            missionScope.mission = undefined;
            missionScope.repository = undefined;
            missionScope.error = error instanceof Error ? error.message : String(error);
        } finally {
            missionScope.loading = false;
        }
    });

    $effect(() => {
        if (!controlSnapshot) {
            return;
        }

        const activeSessionId = selectionState.activeSessionId ?? null;
        if (activeSessionId && activeSessionId !== lastSelectedAgentSessionId) {
            rightPanelMode = "agent";
        }

        lastSelectedAgentSessionId = activeSessionId;
    });

    $effect(() => {
        if (!selectedNodeId) {
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
        const normalizedMissionId = missionId?.trim();
        const normalizedWorktreePath = missionWorktreePath?.trim();

        if (!normalizedMissionId || !normalizedWorktreePath) {
            return;
        }

        const subscription = appContext.observeMission({
            missionId: normalizedMissionId,
            repositoryRootPath: normalizedWorktreePath,
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
        };
    });

    function currentStageLabel(stageId: string | undefined): string {
        return stageId ? `Current stage ${stageId}` : "No active stage";
    }

    async function refreshControlSnapshot(): Promise<void> {
        if (!missionWorktreePath || !activeMission) {
            return;
        }

        if (controlLoading) {
            refreshQueued = true;
            return;
        }

        controlLoading = true;
        controlError = null;
        try {
            const nextSnapshot = await activeMission.getControlSnapshot();
            activeMission.setRouteState({
                controlSnapshot: nextSnapshot,
                worktreePath: missionWorktreePath,
            });
            appContext.setActiveMissionOutline({
                title: nextSnapshot.operatorStatus.title,
                currentStageId: nextSnapshot.operatorStatus.workflow?.currentStageId,
                briefPath: nextSnapshot.operatorStatus.productFiles?.brief,
                treeNodes: nextSnapshot.operatorStatus.tower?.treeNodes ?? [],
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

    function applyMissionStatusEvent(
        event: AirportRuntimeEventEnvelope,
    ): void {
        if (!activeMission) {
            return;
        }

        const payload = event.payload as {
            status?: unknown;
        };
        if (!payload.status) {
            return;
        }

        const status = operatorStatusSchema.parse(payload.status);

        activeMission.applyOperatorStatus(status);
        appContext.setActiveMissionOutline({
            title: status.title,
            currentStageId: status.workflow?.currentStageId,
            briefPath: status.productFiles?.brief,
            treeNodes: status.tower?.treeNodes ?? [],
        });
    }

    function handleMissionRuntimeEvent(
        event: AirportRuntimeEventEnvelope,
    ): void {
        switch (event.type) {
            case "mission.status":
                applyMissionStatusEvent(event);
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
        currentMission: MissionEntity,
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
    {#if missionLoading && !activeMission}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 text-sm text-muted-foreground backdrop-blur-sm"
        >
            Loading mission snapshot...
        </section>
    {:else if missionLoadError || !activeRepository || !activeMission || !controlSnapshot || !repositorySummary}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
        >
            <h2 class="text-lg font-semibold text-foreground">Mission control</h2>
            <p class="mt-3 text-sm text-rose-600">
                {missionLoadError ?? "Mission snapshot could not be loaded."}
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

        <section
            class={`min-h-0 gap-4 rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm ${progressCollapsed ? "grid grid-rows-[auto]" : "grid grid-rows-[auto_minmax(0,1fr)]"}`}
        >
            <header class={`space-y-4 ${progressCollapsed ? "" : "border-b pb-4"}`}>
                <div
                    class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"
                >
                    <div class="min-w-0 space-y-2">
                        <p
                            class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground"
                        >
                            Mission
                        </p>
                        <div>
                            <h1 class="text-2xl font-semibold text-foreground">
                                {missionTitle}
                            </h1>
                            <div
                                class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"
                            >
                                <span>{repositorySummary.label}</span>
                                <span>{activeMission.missionId}</span>
                                <span>{workflowLifecycle ?? "unknown"}</span>
                                <span>{currentStageLabel(currentStageId)}</span>
                                <span>Updated {workflowUpdatedAt ?? "unknown"}</span>
                                <span>{repositorySummary.repositoryRootPath}</span>
                            </div>
                        </div>
                    </div>

                    <div class="flex items-start gap-2 self-start xl:justify-end">
                        <MissionActionbar
                            refreshNonce={actionRefreshNonce}
                            onActionExecuted={handleMissionMutated}
                        />

                        <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            class="shrink-0 shadow-sm"
                            aria-expanded={!progressCollapsed}
                            aria-label={progressCollapsed
                                ? "Expand mission progress"
                                : "Collapse mission progress"}
                            onclick={() => {
                                progressCollapsed = !progressCollapsed;
                            }}
                        >
                            {#if progressCollapsed}
                                <ChevronDownIcon />
                            {:else}
                                <ChevronUpIcon />
                            {/if}
                            <span class="sr-only">
                                {progressCollapsed
                                    ? "Expand mission progress"
                                    : "Collapse mission progress"}
                            </span>
                        </Button>
                    </div>
                </div>
            </header>

            {#if !progressCollapsed}
                <MissionCockpit {selectionState} {currentStageId} onSelectNode={handleSelectNode} />
            {/if}
        </section>

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

                    {#if leftTreeMode === "control"}
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
                    {:else}
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
                    {/if}
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
                        artifact={displayArtifact}
                        onCloseRequested={handleCloseArtifactEditor}
                    />
                {:else}
                    <ArtifactViewer
                        refreshNonce={actionRefreshNonce}
                        artifact={displayArtifact}
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

                    <div class="relative min-h-0 flex-1 overflow-hidden p-0">
                        {#if rightPanelMode === "terminal"}
                            <div class="absolute inset-0 min-h-0 overflow-hidden">
                                <MissionTerminal />
                            </div>
                        {:else}
                            <div class="absolute inset-0 min-h-0 overflow-hidden">
                                <AgentSession
                                    refreshNonce={actionRefreshNonce}
                                    stageId={selectionState.resolvedSelection?.stageId}
                                    session={resolvedSession}
                                    onActionExecuted={handleMissionMutated}
                                />
                            </div>
                        {/if}
                    </div>
                </Tabs.Root>
            </ResizablePane>
        </ResizablePaneGroup>
    {/if}
</div>
