<script lang="ts">
    import { page } from "$app/state";
    import type { Artifact as ArtifactEntity } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import type { Mission as MissionEntity } from "$lib/components/entities/Mission/Mission.svelte.js";
    import type { Task as TaskEntity } from "$lib/components/entities/Task/Task.svelte.js";
    import ChevronDownIcon from "@tabler/icons-svelte/icons/chevron-down";
    import ChevronUpIcon from "@tabler/icons-svelte/icons/chevron-up";
    import type { MissionRuntimeEventEnvelopeType } from "@flying-pillow/mission-core/entities/Mission/MissionSchema";
    import { ArtifactDataSchema } from "@flying-pillow/mission-core/entities/Artifact/ArtifactSchema";
    import { AgentSessionDataSchema } from "@flying-pillow/mission-core/entities/AgentSession/AgentSessionSchema";
    import {
        MissionSnapshotSchema,
        MissionStatusSnapshotSchema,
    } from "@flying-pillow/mission-core/entities/Mission/MissionSchema";
    import { StageDataSchema } from "@flying-pillow/mission-core/entities/Stage/StageSchema";
    import { TaskDataSchema } from "@flying-pillow/mission-core/entities/Task/TaskSchema";
    import type { AgentSession as AgentSessionModel } from "$lib/components/entities/AgentSession/AgentSession.svelte.js";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { setScopedMissionContext } from "$lib/client/context/scoped-mission-context.svelte.js";
    import AgentSession from "$lib/components/entities/AgentSession/AgentSession.svelte";
    import ArtifactEditor from "$lib/components/entities/Artifact/ArtifactEditor.svelte";
    import ArtifactViewer from "$lib/components/entities/Artifact/ArtifactViewer.svelte";
    import MissionCockpit from "$lib/components/entities/Mission/MissionCockpit.svelte";
    import MissionCommandbar from "$lib/components/entities/Mission/MissionCommandbar.svelte";
    import MissionControlTree from "$lib/components/entities/Mission/MissionControlTree.svelte";
    import MissionFileTree from "$lib/components/entities/Mission/MissionFileTree.svelte";
    import MissionTerminal from "$lib/components/entities/Mission/MissionTerminal.svelte";
    import type { MissionTowerTreeNode } from "@flying-pillow/mission-core/types";
    import { Button } from "$lib/components/ui/button/index.js";
    import {
        ResizableHandle,
        ResizablePane,
        ResizablePaneGroup,
    } from "$lib/components/ui/resizable";
    import * as Tabs from "$lib/components/ui/tabs/index.js";
    import type { ActiveMissionOutline } from "$lib/client/context/app-context.svelte";
    import type { MissionFileTreeNode } from "$lib/types/mission-file-tree";
    import type { Repository as RepositoryEntity } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { Badge } from "$lib/components/ui/badge";

    type MissionSelectionState = {
        treeNodes: MissionTowerTreeNode[];
        visibleTreeNodes: MissionTowerTreeNode[];
        selectedNodeId?: string;
        resolvedSelection?: {
            stageId?: string;
            taskId?: string;
        };
        activeArtifact?: {
            displayLabel?: string;
        };
        activeArtifactPath?: string;
        activeSessionId?: string;
    };

    const appContext = getAppContext();
    const repositoryId = $derived(page.params.repositoryId?.trim() ?? "");
    const routeMissionId = $derived(page.params.missionId?.trim() ?? "");
    const missionScopeState = $state<{
        repositoryId?: string;
        missionId?: string;
        mission?: MissionEntity;
        repository?: RepositoryEntity;
        loading: boolean;
        error?: string | null;
    }>({
        loading: true,
    });
    const missionScope = setScopedMissionContext(missionScopeState);
    const activeRepository = $derived(missionScope.repository);
    const activeMission = $derived(missionScope.mission);
    const missionLoading = $derived(missionScope.loading);
    const missionLoadError = $derived(missionScope.error);
    const missionView = $derived(activeMission?.projectionSnapshot);
    const missionWorktreePath = $derived(
        activeMission?.missionWorktreePath ?? "",
    );
    const missionId = $derived(
        activeMission?.missionId ?? missionScope.missionId ?? "",
    );

    let missionViewLoading = $state(false);
    let missionViewError = $state<string | null>(null);
    let runtimeError = $state<string | null>(null);
    let commandRefreshNonce = $state(0);
    let artifactPanelMode = $state<"view" | "edit">("view");
    let leftPanelMode = $state<"mission" | "files">("mission");
    let rightPanelMode = $state<"terminal" | "agent">("terminal");
    let selectedWorktreeNode = $state<MissionFileTreeNode | null>(null);
    let artifactPanelSourceKey = $state<string | null>(null);
    let displayArtifact = $state<ArtifactEntity | undefined>(undefined);
    let missionViewRefreshTimer: number | null = null;
    let refreshQueued = false;
    let progressCollapsed = $state(false);

    $effect(() => {
        const currentRepository = appContext.airport.activeRepository;
        const currentMission = appContext.airport.activeMission;
        missionScope.repositoryId = repositoryId || undefined;
        missionScope.missionId = routeMissionId || undefined;
        missionScope.repository =
            currentRepository?.id === repositoryId
                ? currentRepository
                : undefined;
        missionScope.mission =
            currentRepository?.id === repositoryId &&
            currentMission?.missionId === routeMissionId
                ? currentMission
                : undefined;
        missionScope.loading =
            appContext.airport.activeRepositoryLoading ||
            appContext.airport.activeMissionLoading;
        missionScope.error =
            appContext.airport.activeMissionError ??
            appContext.airport.activeRepositoryError ??
            null;
    });

    const missionStatus = $derived(missionView?.status);
    const workflowLifecycle = $derived(
        missionView?.workflow?.lifecycle ?? activeMission?.workflowLifecycle,
    );
    const workflowUpdatedAt = $derived(
        missionView?.workflow?.updatedAt ?? activeMission?.workflowUpdatedAt,
    );
    const currentStageId = $derived(missionView?.workflow?.currentStageId);
    const missionTitle = $derived(
        missionStatus?.title ??
            activeMission?.missionId ??
            missionScope.missionId,
    );
    const repositoryName = $derived(
        activeRepository?.data.platformRepositoryRef ??
            activeRepository?.data.repoName ??
            "Repository",
    );
    const missionIssueLabel = $derived.by(() => {
        const issueId = missionStatus?.issueId;
        if (issueId) {
            return `#${issueId}`;
        }

        const missionNumber = missionId.match(/^(\d+)(?:-|$)/)?.[1];
        return missionNumber ? `#${missionNumber}` : undefined;
    });
    const missionHeading = $derived(
        `${repositoryName} - ${missionIssueLabel ? `${missionIssueLabel} ` : ""}${missionTitle}`,
    );
    const missionTreeNodes = $derived(
        activeMission ? buildMissionTreeNodes(activeMission) : [],
    );
    const selectedNodeId = $derived.by(() => {
        if (!missionView || missionTreeNodes.length === 0) {
            return undefined;
        }

        const activeNodeId = appContext.airport.activeMissionSelectedNodeId;
        return missionTreeNodes.some((node) => node.id === activeNodeId)
            ? activeNodeId
            : missionTreeNodes.find((node) => node.stageId === currentStageId)
                  ?.id;
    });
    const missionOutline = $derived<ActiveMissionOutline | undefined>(
        activeMission
            ? {
                  title: missionTitle,
                  currentStageId,
                  briefPath: activeMission
                      .listArtifacts()
                      .find(
                          (artifact) => artifact.artifactId === "mission:brief",
                      )?.filePath,
                  treeNodes: missionTreeNodes,
              }
            : undefined,
    );
    const selectionState = $derived.by((): MissionSelectionState => {
        const selectedNode = missionTreeNodes.find(
            (node) => node.id === selectedNodeId,
        );
        const companionStageTask =
            activeMission && isStageSelectionNode(selectedNode)
                ? resolvePreferredStageTask(activeMission, selectedNode.stageId)
                : undefined;
        const companionStageSession =
            activeMission && isStageSelectionNode(selectedNode)
                ? resolvePreferredStageSession(
                      activeMission,
                      selectedNode.stageId,
                  )
                : undefined;
        const resolvedStageId = selectedNode?.stageId;
        const resolvedTaskId =
            selectedNode?.taskId ?? companionStageTask?.taskId;

        return {
            treeNodes: missionTreeNodes,
            visibleTreeNodes: missionTreeNodes,
            selectedNodeId,
            ...(resolvedStageId || resolvedTaskId
                ? {
                      resolvedSelection: {
                          ...(resolvedStageId
                              ? { stageId: resolvedStageId }
                              : {}),
                          ...(resolvedTaskId ? { taskId: resolvedTaskId } : {}),
                      },
                  }
                : {}),
            ...(selectedNode?.sourcePath
                ? {
                      activeArtifact: { displayLabel: selectedNode.label },
                      activeArtifactPath: selectedNode.sourcePath,
                  }
                : {}),
            ...(selectedNode?.sessionId
                ? { activeSessionId: selectedNode.sessionId }
                : companionStageSession?.sessionId
                  ? { activeSessionId: companionStageSession.sessionId }
                  : {}),
        };
    });
    const activeArtifactPath = $derived(selectionState.activeArtifactPath);
    const selectedWorktreeFile = $derived(
        selectedWorktreeNode?.kind === "file" ? selectedWorktreeNode : null,
    );
    const displayArtifactPath = $derived(
        selectedWorktreeFile?.absolutePath ?? activeArtifactPath,
    );
    const displayArtifactLabel = $derived(
        selectedWorktreeFile?.name ??
            selectionState.activeArtifact?.displayLabel,
    );
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
    const displayTask = $derived(
        activeMission && displayTaskId
            ? activeMission.getTask(displayTaskId)
            : undefined,
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
            : activeMission
              ? resolvePreferredTaskSession(
                    activeMission,
                    selectionState.resolvedSelection?.taskId,
                )
              : undefined,
    );

    $effect(() => {
        if (!missionView) {
            return;
        }

        const activeSessionId = resolvedSession?.sessionId ?? null;
        if (
            activeSessionId &&
            (selectionState.activeSessionId ||
                selectionState.resolvedSelection?.taskId)
        ) {
            rightPanelMode = "agent";
        }
    });

    $effect(() => {
        if (!activeMission || !displayArtifactPath) {
            displayArtifact = undefined;
            return;
        }

        displayArtifact = activeMission.resolveArtifact({
            filePath: displayArtifactPath,
            ...(displayArtifactLabel ? { label: displayArtifactLabel } : {}),
            ...(displayStageId ? { stageId: displayStageId } : {}),
            ...(displayTaskId ? { taskId: displayTaskId } : {}),
        });
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
        if (!missionOutline) {
            return;
        }

        appContext.setActiveMissionOutline(missionOutline);
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
            if (missionViewRefreshTimer !== null) {
                window.clearTimeout(missionViewRefreshTimer);
            }
        };
    });

    function currentStageLabel(stageId: string | undefined): string {
        return stageId ? `Current stage ${stageId}` : "No active stage";
    }

    function statusBadgeClass(statusLabel: string | undefined): string {
        switch (statusLabel?.trim().toLowerCase()) {
            case "running":
            case "active":
                return "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300";
            case "completed":
            case "delivered":
                return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
            case "failed":
            case "panicked":
                return "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300";
            case "paused":
            case "cancelled":
            case "terminated":
                return "border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300";
            default:
                return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
        }
    }

    async function refreshMissionView(): Promise<void> {
        if (!missionWorktreePath || !activeMission) {
            return;
        }

        if (missionViewLoading) {
            refreshQueued = true;
            return;
        }

        missionViewLoading = true;
        missionViewError = null;
        try {
            const nextView = await activeMission.getProjectionSnapshot();
            activeMission.setRouteState({
                projectionSnapshot: nextView,
                worktreePath: missionWorktreePath,
            });
            appContext.setActiveMissionOutline({
                title: nextView.status?.title,
                currentStageId: nextView.workflow?.currentStageId,
                treeNodes: activeMission
                    ? buildMissionTreeNodes(activeMission)
                    : [],
            });
        } catch (error) {
            missionViewError =
                error instanceof Error ? error.message : String(error);
        } finally {
            missionViewLoading = false;
            if (refreshQueued) {
                refreshQueued = false;
                void refreshMissionView();
            }
        }
    }

    function scheduleMissionViewRefresh(): void {
        if (missionViewRefreshTimer !== null) {
            window.clearTimeout(missionViewRefreshTimer);
        }
        missionViewRefreshTimer = window.setTimeout(() => {
            missionViewRefreshTimer = null;
            void refreshMissionView();
        }, 150);
    }

    function applyMissionStatusEvent(
        event: MissionRuntimeEventEnvelopeType,
    ): void {
        if (!activeMission) {
            return;
        }

        if (event.type !== "mission.status") {
            return;
        }

        const payload = event.payload as { status?: unknown };
        const status = MissionStatusSnapshotSchema.parse(payload.status);

        activeMission.applyMissionStatus(status);
        appContext.setActiveMissionOutline({
            title: status.title,
            currentStageId: status.workflow?.currentStageId,
            treeNodes: buildMissionTreeNodes(activeMission),
        });
    }

    function handleMissionRuntimeEvent(
        event: MissionRuntimeEventEnvelopeType,
    ): void {
        switch (event.type) {
            case "mission.snapshot.changed":
                const missionPayload = event.payload as { snapshot?: unknown };
                activeMission?.applyMissionSnapshot(
                    MissionSnapshotSchema.parse(missionPayload.snapshot),
                );
                commandRefreshNonce += 1;
                return;
            case "mission.status":
                applyMissionStatusEvent(event);
                return;
            case "stage.snapshot.changed":
                const stagePayload = event.payload as { snapshot?: unknown };
                activeMission?.applyStageSnapshot(
                    StageDataSchema.parse(stagePayload.snapshot),
                );
                commandRefreshNonce += 1;
                return;
            case "task.snapshot.changed":
                const taskPayload = event.payload as { snapshot?: unknown };
                activeMission?.applyTaskSnapshot(
                    TaskDataSchema.parse(taskPayload.snapshot),
                );
                commandRefreshNonce += 1;
                return;
            case "artifact.snapshot.changed":
                const artifactPayload = event.payload as { snapshot?: unknown };
                activeMission?.applyArtifactSnapshot(
                    ArtifactDataSchema.parse(artifactPayload.snapshot),
                );
                commandRefreshNonce += 1;
                return;
            case "agentSession.snapshot.changed":
                const agentSessionPayload = event.payload as {
                    snapshot?: unknown;
                };
                activeMission?.applyAgentSessionSnapshot(
                    AgentSessionDataSchema.parse(agentSessionPayload.snapshot),
                );
                commandRefreshNonce += 1;
                return;
            case "session.event":
                const sessionEventPayload = event.payload as {
                    session?: unknown;
                };
                activeMission?.applyAgentSessionSnapshot(
                    AgentSessionDataSchema.parse(sessionEventPayload.session),
                );
                commandRefreshNonce += 1;
                return;
            case "session.lifecycle":
                scheduleMissionViewRefresh();
                return;
            default:
                return;
        }
    }

    async function handleMissionMutated(): Promise<void> {
        await refreshMissionView();
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

    function isStageSelectionNode(
        node: MissionTowerTreeNode | undefined,
    ): node is MissionTowerTreeNode & { stageId: string } {
        return Boolean(
            node?.stageId &&
                (node.kind === "stage" || node.kind === "stage-artifact"),
        );
    }

    function resolvePreferredStageTask(
        currentMission: MissionEntity,
        stageId: string | undefined,
    ): TaskEntity | undefined {
        if (!stageId) {
            return undefined;
        }

        const tasks = currentMission.listTasksForStage(stageId);
        return (
            tasks.find((task) => task.lifecycle === "running") ??
            tasks.find(
                (task) =>
                    task.lifecycle === "ready" || task.lifecycle === "queued",
            ) ??
            tasks.at(-1)
        );
    }

    function resolvePreferredStageSession(
        currentMission: MissionEntity,
        stageId: string | undefined,
    ): AgentSessionModel | undefined {
        if (!stageId) {
            return undefined;
        }

        const taskIds = new Set(
            currentMission
                .listTasksForStage(stageId)
                .map((task) => task.taskId),
        );
        return currentMission
            .listSessions()
            .filter(
                (session) =>
                    session.taskId !== undefined && taskIds.has(session.taskId),
            )
            .sort(comparePreferredAgentSessions)[0];
    }

    function comparePreferredAgentSessions(
        left: AgentSessionModel,
        right: AgentSessionModel,
    ): number {
        const leftActiveRank = getAgentSessionActiveRank(left);
        const rightActiveRank = getAgentSessionActiveRank(right);
        if (leftActiveRank !== rightActiveRank) {
            return rightActiveRank - leftActiveRank;
        }

        return getAgentSessionUpdatedAt(right) - getAgentSessionUpdatedAt(left);
    }

    function getAgentSessionActiveRank(session: AgentSessionModel): number {
        return session.isRunning() ? 1 : 0;
    }

    function getAgentSessionUpdatedAt(session: AgentSessionModel): number {
        const snapshot = session.toData();
        const timestamp = snapshot.lastUpdatedAt ?? snapshot.createdAt;
        return timestamp ? Date.parse(timestamp) || 0 : 0;
    }

    function buildMissionTreeNodes(
        currentMission: MissionEntity,
    ): MissionTowerTreeNode[] {
        const stageColors = [
            "#38bdf8",
            "#34d399",
            "#f59e0b",
            "#f43f5e",
            "#a78bfa",
        ];
        const nodes: MissionTowerTreeNode[] = [];

        for (const artifact of currentMission.listArtifacts()) {
            if (artifact.stageId || artifact.taskId) {
                continue;
            }
            nodes.push({
                id: `tree:mission-artifact:${artifact.artifactId}`,
                label: artifact.label,
                kind: "mission-artifact",
                depth: 0,
                color: "#8b949e",
                statusLabel: "Mission artifact",
                collapsible: false,
                sourcePath: artifact.filePath,
            });
        }

        currentMission.listStages().forEach((stage, stageIndex) => {
            const stageSnapshot = stage.toData();
            const stageColor = stageColors[stageIndex % stageColors.length];
            const stageNodeId = toMissionTreeStageId(stage.stageId);
            nodes.push({
                id: `tree:stage:${stage.stageId}`,
                label: stage.stageId,
                kind: "stage",
                depth: 0,
                color: stageColor,
                statusLabel: stage.lifecycle,
                collapsible: true,
                stageId: stageNodeId,
            });

            for (const artifact of stage.artifacts) {
                nodes.push({
                    id: `tree:stage-artifact:${artifact.artifactId}`,
                    label: artifact.label,
                    kind: "stage-artifact",
                    depth: 1,
                    color: stageColor,
                    statusLabel: "Stage artifact",
                    collapsible: false,
                    sourcePath: artifact.filePath ?? artifact.relativePath,
                    stageId: stageNodeId,
                });
            }

            for (const task of currentMission.listTasksForStage(
                stage.stageId,
            )) {
                const taskSnapshot = task.toData().task;
                nodes.push({
                    id: `tree:task:${task.taskId}`,
                    label: task.title,
                    kind: "task",
                    depth: 1,
                    color: stageColor,
                    statusLabel: task.lifecycle,
                    collapsible: true,
                    sourcePath: taskSnapshot.filePath,
                    stageId: stageNodeId,
                    taskId: task.taskId,
                });

                for (const artifact of currentMission
                    .listArtifacts()
                    .filter((candidate) => candidate.taskId === task.taskId)) {
                    nodes.push({
                        id: `tree:task-artifact:${artifact.artifactId}`,
                        label: artifact.label,
                        kind: "task-artifact",
                        depth: 2,
                        color: stageColor,
                        statusLabel: "Task artifact",
                        collapsible: false,
                        sourcePath: artifact.filePath,
                        stageId: stageNodeId,
                        taskId: task.taskId,
                    });
                }

                for (const session of currentMission
                    .listSessions()
                    .filter((candidate) => candidate.taskId === task.taskId)) {
                    nodes.push({
                        id: `tree:session:${session.sessionId}`,
                        label: session.currentTurnTitle ?? session.sessionId,
                        kind: "session",
                        depth: 2,
                        color: stageColor,
                        statusLabel: session.lifecycleState,
                        collapsible: false,
                        stageId: stageNodeId,
                        taskId: task.taskId,
                        sessionId: session.sessionId,
                    });
                }
            }

            for (const artifact of stageSnapshot.artifacts.filter(
                (candidate: { taskId?: string }) => !candidate.taskId,
            )) {
                if (
                    nodes.some(
                        (node) =>
                            node.id ===
                            `tree:stage-artifact:${artifact.artifactId}`,
                    )
                ) {
                    continue;
                }
                nodes.push({
                    id: `tree:stage-artifact:${artifact.artifactId}`,
                    label: artifact.label,
                    kind: "stage-artifact",
                    depth: 1,
                    color: stageColor,
                    statusLabel: "Stage artifact",
                    collapsible: false,
                    sourcePath: artifact.filePath ?? artifact.relativePath,
                    stageId: stageNodeId,
                });
            }
        });

        return nodes;
    }

    function toMissionTreeStageId(
        stageId: string,
    ): MissionTowerTreeNode["stageId"] {
        return stageId as MissionTowerTreeNode["stageId"];
    }
</script>

<div class="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2 gap-4">
    {#if missionLoading && !activeMission}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 text-sm text-muted-foreground backdrop-blur-sm"
        >
            Loading mission snapshot...
        </section>
    {:else if missionLoadError || !activeRepository || !activeMission || !missionView}
        <section
            class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
        >
            <h2 class="text-lg font-semibold text-foreground">Mission</h2>
            <p class="mt-3 text-sm text-rose-600">
                {missionLoadError ?? "Mission view could not be loaded."}
            </p>
        </section>
    {:else}
        {#if missionViewError || runtimeError}
            <section
                class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
            >
                {#if missionViewError}
                    <p class="text-sm text-rose-600">{missionViewError}</p>
                {/if}
                {#if runtimeError}
                    <p class="text-sm text-rose-600">{runtimeError}</p>
                {/if}
            </section>
        {/if}

        <section
            class={`min-h-0 gap-4 rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm ${progressCollapsed ? "grid grid-rows-[auto]" : "grid grid-rows-[auto_minmax(0,1fr)]"}`}
        >
            <header
                class={`space-y-4 ${progressCollapsed ? "" : "border-b pb-4"}`}
            >
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
                                {missionHeading}
                            </h1>
                            <div
                                class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"
                            >
                                <Badge
                                    variant="outline"
                                    class={statusBadgeClass(workflowLifecycle)}
                                >
                                    {workflowLifecycle ?? "unknown"}
                                </Badge>
                                <span>{currentStageLabel(currentStageId)}</span>
                                <span
                                    >Updated {workflowUpdatedAt ??
                                        "unknown"}</span
                                >
                                <span
                                    >{activeRepository.data
                                        .repositoryRootPath}</span
                                >
                            </div>
                        </div>
                    </div>

                    <div
                        class="flex items-start gap-2 self-start xl:justify-end"
                    >
                        <MissionCommandbar
                            refreshNonce={commandRefreshNonce}
                            mission={activeMission}
                            onCommandExecuted={handleMissionMutated}
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
                <MissionCockpit
                    {selectionState}
                    {currentStageId}
                    onSelectNode={handleSelectNode}
                />
            {/if}
        </section>

        <ResizablePaneGroup
            direction="horizontal"
            class="min-h-0 flex-1 overflow-hidden"
            autoSaveId={`mission:${missionId}`}
        >
            <ResizablePane
                defaultSize={24}
                minSize={18}
                class="flex h-full min-h-0 flex-col p-2"
            >
                <Tabs.Root
                    bind:value={leftPanelMode}
                    class="min-h-0 flex-1 overflow-hidden rounded-2xl border bg-card/70 backdrop-blur-sm"
                >
                    <div class="border-b px-3 py-2">
                        <Tabs.List class="w-full">
                            <Tabs.Trigger value="mission"
                                >Mission Tree</Tabs.Trigger
                            >
                            <Tabs.Trigger value="files">Files</Tabs.Trigger>
                        </Tabs.List>
                    </div>

                    <div class="relative min-h-0 flex-1 overflow-hidden p-0">
                        {#if leftPanelMode === "mission"}
                            <div
                                class="absolute inset-0 min-h-0 overflow-hidden"
                            >
                                <MissionControlTree
                                    outline={missionOutline}
                                    {missionId}
                                    activeNodeId={selectedNodeId}
                                    class="h-full rounded-none border-0 bg-transparent"
                                    onSelectNode={handleSelectNode}
                                />
                            </div>
                        {:else}
                            <div
                                class="absolute inset-0 min-h-0 overflow-hidden"
                            >
                                <MissionFileTree
                                    activePath={selectedWorktreeFile?.absolutePath}
                                    refreshNonce={commandRefreshNonce}
                                    class="h-full rounded-none border-0 bg-transparent"
                                    onSelectPath={handleSelectWorktreeNode}
                                />
                            </div>
                        {/if}
                    </div>
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
                        refreshNonce={commandRefreshNonce}
                        artifact={displayArtifact}
                        task={displayTask}
                        onEditRequested={handleEditArtifact}
                        onCommandExecuted={handleMissionMutated}
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
                            <div
                                class="absolute inset-0 min-h-0 overflow-hidden"
                            >
                                <MissionTerminal />
                            </div>
                        {:else}
                            <div
                                class="absolute inset-0 min-h-0 overflow-hidden"
                            >
                                <AgentSession
                                    refreshNonce={commandRefreshNonce}
                                    session={resolvedSession}
                                    onCommandExecuted={handleMissionMutated}
                                />
                            </div>
                        {/if}
                    </div>
                </Tabs.Root>
            </ResizablePane>
        </ResizablePaneGroup>
    {/if}
</div>
