<script lang="ts">
    import { onMount } from "svelte";
    import AirportHeader from "$lib/components/airport/airport-header.svelte";
    import AirportSidebar from "$lib/components/airport/airport-sidebar.svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import {
        Mission,
        MissionCommandTransport,
        MissionRuntimeTransport,
    } from "$lib";
    import ArtifactEditor from "$lib/components/entities/Artifact/ArtifactEditor.svelte";
    import ArtifactViewer from "$lib/components/entities/Artifact/ArtifactViewer.svelte";
    import MissionControlTree from "$lib/components/entities/Mission/MissionControlTree.svelte";
    import MissionFileTree from "$lib/components/entities/Mission/MissionFileTree.svelte";
    import MissionView from "$lib/components/entities/Mission/Mission.svelte";
    import AgentSession from "$lib/components/entities/AgentSession/AgentSession.svelte";
    import {
        computeMissionControlState,
        createInitialSelectedNodeId,
    } from "$lib/components/entities/Mission/missionControl";
    import {
        ResizableHandle,
        ResizablePane,
        ResizablePaneGroup,
    } from "$lib/components/ui/resizable";
    import {
        SidebarInset,
        SidebarProvider,
    } from "$lib/components/ui/sidebar/index.js";
    import * as Tabs from "$lib/components/ui/tabs/index.js";
    import type { MissionFileTreeNode } from "$lib/types/mission-file-tree";
    import type { MissionControlSnapshot } from "$lib/types/mission-control";
    import type {
        AirportRuntimeEventEnvelopeDto,
        RepositorySurfaceSnapshotDto,
    } from "@flying-pillow/mission-core";

    type Props = {
        data: {
            airportRepositories: import("$lib/components/entities/types").RepositorySummary[];
            repositorySurface: RepositorySurfaceSnapshotDto;
            missionControl: MissionControlSnapshot;
            repositoryId: string;
            missionId: string;
        };
    };

    let { data }: Props = $props();
    const appContext = getAppContext();
    const missionTransport = new MissionRuntimeTransport();
    const missionCommands = new MissionCommandTransport();
    const repositorySurface = $derived(data.repositorySurface);

    let refreshedControlSnapshot = $state<MissionControlSnapshot | null>(null);
    const controlSnapshot = $derived(
        refreshedControlSnapshot ?? data.missionControl,
    );
    let mission = $state(
        new Mission(
            createInitialMissionRuntimeSnapshot(),
            (missionId) =>
                missionTransport.getMissionRuntimeSnapshot(missionId),
            missionCommands,
        ),
    );
    let controlLoading = $state(false);
    let controlError = $state<string | null>(null);
    let runtimeError = $state<string | null>(null);
    let actionRefreshNonce = $state(0);
    let artifactPanelMode = $state<"view" | "edit">("view");
    let leftTreeMode = $state<"control" | "files">("control");
    let selectedWorktreeNode = $state<MissionFileTreeNode | null>(null);
    let artifactPanelSourceKey = $state<string | null>(null);

    let controlRefreshTimer: number | null = null;
    let missionRefreshTimer: number | null = null;
    let refreshQueued = false;

    const repository = $derived(repositorySurface.repository);
    const missionId = $derived(controlSnapshot.missionRuntime.missionId);

    syncAppContext();

    const selectedNodeId = $derived.by(() => {
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
        computeMissionControlState({
            status: controlSnapshot.operatorStatus,
            selectedNodeId,
        }),
    );
    const missionOutline = $derived({
        title: controlSnapshot.operatorStatus.title,
        currentStageId: controlSnapshot.operatorStatus.workflow?.currentStageId,
        briefPath: controlSnapshot.operatorStatus.productFiles?.brief,
        treeNodes: controlSnapshot.operatorStatus.tower?.treeNodes ?? [],
    });
    const activeArtifactPath = $derived(controlState.activeArtifactPath);
    const selectedWorktreeFile = $derived(
        selectedWorktreeNode?.kind === "file" ? selectedWorktreeNode : null,
    );
    const displayArtifactPath = $derived(
        selectedWorktreeFile?.absolutePath ?? activeArtifactPath,
    );
    const displayArtifactLabel = $derived(
        selectedWorktreeFile?.name ?? controlState.activeArtifact?.displayLabel,
    );
    const displayStageId = $derived(
        selectedWorktreeFile
            ? undefined
            : controlState.resolvedSelection?.stageId,
    );
    const displayTaskId = $derived(
        selectedWorktreeFile
            ? undefined
            : controlState.resolvedSelection?.taskId,
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
        controlState.activeSessionId
            ? mission.getSession(controlState.activeSessionId)
            : undefined,
    );

    $effect(() => {
        syncAppContext();
    });

    $effect(() => {
        if (!missionId) {
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

    onMount(() => {
        const subscription = missionTransport.observeMissionRuntime({
            missionId,
            onEvent: (event) => {
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
        try {
            const nextSnapshot =
                await missionTransport.getMissionRuntimeSnapshot(missionId);
            mission.applySnapshot(nextSnapshot);
            refreshedControlSnapshot = {
                ...(refreshedControlSnapshot ?? controlSnapshot),
                missionRuntime: nextSnapshot,
            };
            runtimeError = null;
        } catch (error) {
            runtimeError =
                error instanceof Error ? error.message : String(error);
        }
    }

    async function refreshControlSnapshot(): Promise<void> {
        if (controlLoading) {
            refreshQueued = true;
            return;
        }

        controlLoading = true;
        controlError = null;
        try {
            const response = await fetch(
                `/api/runtime/missions/${encodeURIComponent(missionId)}/control`,
            );
            if (!response.ok) {
                throw new Error(
                    `Mission Control refresh failed (${response.status}).`,
                );
            }

            const nextSnapshot =
                (await response.json()) as MissionControlSnapshot;
            refreshedControlSnapshot = nextSnapshot;
            mission.applySnapshot(nextSnapshot.missionRuntime);
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
            void refreshMissionRuntimeSnapshot();
        }, 100);
    }

    function applyMissionStatusEvent(
        event: AirportRuntimeEventEnvelopeDto,
    ): void {
        const payload = event.payload as {
            status?: MissionControlSnapshot["operatorStatus"];
        };
        if (!payload.status) {
            return;
        }

        refreshedControlSnapshot = {
            ...(refreshedControlSnapshot ?? data.missionControl),
            operatorStatus: payload.status,
        };
    }

    function handleMissionRuntimeEvent(
        event: AirportRuntimeEventEnvelopeDto,
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

    function syncAppContext(): void {
        const repositories = data.airportRepositories.some(
            (candidate) => candidate.repositoryId === repository.repositoryId,
        )
            ? data.airportRepositories
            : [repository, ...data.airportRepositories];

        appContext.setRepositories(repositories);
        appContext.setActiveRepository({
            repositoryId: repository.repositoryId,
            repositoryRootPath: repository.repositoryRootPath,
        });
        appContext.setActiveMission(missionId);
        appContext.setActiveMissionOutline({
            title: controlSnapshot.operatorStatus.title,
            currentStageId:
                controlSnapshot.operatorStatus.workflow?.currentStageId,
            briefPath: controlSnapshot.operatorStatus.productFiles?.brief,
            treeNodes: controlSnapshot.operatorStatus.tower?.treeNodes ?? [],
        });
    }

    function createInitialMissionControlSnapshot(): MissionControlSnapshot {
        return refreshedControlSnapshot ?? data.missionControl;
    }

    function createInitialMissionRuntimeSnapshot(): MissionControlSnapshot["missionRuntime"] {
        return data.missionControl.missionRuntime;
    }
</script>

<svelte:head>
    <title
        >{repository.label} · {controlSnapshot.operatorStatus.title ??
            missionId} · Mission Control</title
    >
    <meta
        name="description"
        content="Dedicated operator console for steering a single mission workflow in Airport web."
    />
</svelte:head>

<SidebarProvider style="--sidebar-width: 19rem; --sidebar-width-mobile: 20rem;">
    <AirportSidebar variant="inset" />

    <SidebarInset
        class="min-h-0 overflow-hidden h-svh md:peer-data-[variant=inset]:my-0"
    >
        <AirportHeader />
        <div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2 gap-4">
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
                {repository}
                {mission}
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
                                {missionId}
                                repositoryRootPath={repository.repositoryRootPath}
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
                            {missionId}
                            repositoryRootPath={repository.repositoryRootPath}
                            artifactPath={displayArtifactPath}
                            artifactLabel={displayArtifactLabel}
                            onCloseRequested={handleCloseArtifactEditor}
                        />
                    {:else}
                        <ArtifactViewer
                            {missionId}
                            repositoryId={repository.repositoryId}
                            repositoryRootPath={repository.repositoryRootPath}
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
                    <AgentSession
                        {missionId}
                        repositoryId={repository.repositoryId}
                        refreshNonce={actionRefreshNonce}
                        stageId={controlState.resolvedSelection?.stageId}
                        session={resolvedSession}
                        onActionExecuted={handleMissionMutated}
                    />
                </ResizablePane>
            </ResizablePaneGroup>
        </div>
    </SidebarInset>
</SidebarProvider>
