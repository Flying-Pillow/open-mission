<script lang="ts">
    import Icon from "@iconify/svelte";
    import type { ActiveMissionOutline } from "$lib/client/context/app-context.svelte";
    import * as TreeView from "$lib/components/ui/tree-view/index.js";
    import { cn } from "$lib/utils.js";
    import type { MissionTowerTreeNode } from "@flying-pillow/mission-core/entities/Mission/MissionSchema";

    type MissionSidebarTask = {
        node: MissionTowerTreeNode;
        artifacts: MissionTowerTreeNode[];
        sessions: MissionTowerTreeNode[];
    };

    type MissionOutlineArtifact = {
        node: MissionTowerTreeNode;
    };

    type MissionSidebarStage = {
        node: MissionTowerTreeNode;
        artifacts: MissionTowerTreeNode[];
        tasks: MissionSidebarTask[];
    };

    type MissionSidebarOutline = {
        artifacts: MissionOutlineArtifact[];
        stages: MissionSidebarStage[];
    };

    let {
        outline,
        missionId,
        activeNodeId,
        class: className,
        onSelectNode,
    }: {
        outline?: ActiveMissionOutline;
        missionId?: string;
        activeNodeId?: string;
        class?: string;
        onSelectNode: (nodeId: string) => void;
    } = $props();

    const missionOutline = $derived.by(() => {
        const treeNodes = outline?.treeNodes ?? [];
        const briefPath = outline?.briefPath?.trim();

        if (treeNodes.length === 0 && !briefPath) {
            return undefined;
        }

        return {
            title: outline?.title ?? missionId ?? "Mission outline",
            currentStageId: outline?.currentStageId,
            ...buildMissionOutline(treeNodes, briefPath),
        };
    });
    const currentMissionStageId = $derived(missionOutline?.currentStageId);
    let missionBranchOverrides = $state<Record<string, boolean>>({});

    function buildMissionOutline(
        treeNodes: MissionTowerTreeNode[],
        briefPath?: string,
    ): MissionSidebarOutline {
        const artifacts: MissionOutlineArtifact[] = [];
        const stages: MissionSidebarStage[] = [];
        const stageMap: Record<string, MissionSidebarStage> = {};
        const taskMap: Record<string, MissionSidebarTask> = {};

        if (
            briefPath &&
            !treeNodes.some((node) => node.kind === "mission-artifact")
        ) {
            artifacts.push({
                node: {
                    id: "tree:mission-artifact:brief",
                    label: "BRIEF.md",
                    kind: "mission-artifact",
                    depth: 0,
                    color: "#8b949e",
                    statusLabel: "Mission artifact",
                    collapsible: false,
                    sourcePath: briefPath,
                },
            });
        }

        for (const node of treeNodes) {
            if (node.kind === "mission-artifact") {
                artifacts.push({ node });
                continue;
            }

            if (node.kind === "stage") {
                const stage = {
                    node,
                    artifacts: [],
                    tasks: [],
                } satisfies MissionSidebarStage;
                stages.push(stage);
                if (node.stageId) {
                    stageMap[node.stageId] = stage;
                }
                continue;
            }

            const stage = node.stageId ? stageMap[node.stageId] : undefined;
            if (!stage) {
                continue;
            }

            if (node.kind === "stage-artifact") {
                stage.artifacts.push(node);
                continue;
            }

            if (node.kind === "task") {
                const task = {
                    node,
                    artifacts: [],
                    sessions: [],
                } satisfies MissionSidebarTask;
                stage.tasks.push(task);
                if (node.taskId) {
                    taskMap[node.taskId] = task;
                }
                continue;
            }

            const task = node.taskId ? taskMap[node.taskId] : undefined;
            if (!task) {
                continue;
            }

            if (node.kind === "task-artifact") {
                task.artifacts.push(node);
                continue;
            }

            if (node.kind === "session") {
                task.sessions.push(node);
            }
        }

        return {
            artifacts,
            stages,
        };
    }

    function basename(filePath: string | undefined): string | undefined {
        if (!filePath) {
            return undefined;
        }

        const normalized = filePath.replace(/\\/g, "/");
        return normalized.split("/").pop() ?? normalized;
    }

    function nodeLabel(node: MissionTowerTreeNode): string {
        return basename(node.sourcePath) ?? node.label;
    }

    function statusColor(statusLabel: string | undefined): string | undefined {
        switch (normalizeStatusLabel(statusLabel)) {
            case "running":
                return "#0ea5e9";
            case "ready":
            case "queued":
            case "starting":
            case "awaiting input":
                return "#f59e0b";
            case "completed":
            case "delivered":
                return "#10b981";
            case "failed":
                return "#ef4444";
            case "cancelled":
            case "terminated":
            case "paused":
                return "#94a3b8";
            case "pending":
            case "draft":
            case "mission artifact":
            case "stage artifact":
            case "task artifact":
                return "#8b949e";
            default:
                return undefined;
        }
    }

    function nodeColor(node: MissionTowerTreeNode): string | undefined {
        const normalizedStatus = normalizeStatusLabel(node.statusLabel);
        const color = normalizedStatus
            ? (statusColor(node.statusLabel) ?? "#8b949e")
            : node.color?.trim();
        return color && color.length > 0 ? color : undefined;
    }

    function nodeStyle(node: MissionTowerTreeNode): string | undefined {
        const color = nodeColor(node);
        return color ? `color: ${color};` : undefined;
    }

    function sessionIcon(node: MissionTowerTreeNode): string {
        const status = normalizeStatusLabel(node.statusLabel);

        if (status === "terminated") {
            return "lucide:octagon";
        }

        if (status === "running") {
            return "lucide:loader-circle";
        }

        return "lucide:database";
    }

    function sessionIconClass(node: MissionTowerTreeNode): string {
        return normalizeStatusLabel(node.statusLabel) === "running"
            ? "animate-spin"
            : "";
    }

    function hasStageChildren(stage: MissionSidebarStage): boolean {
        return stage.artifacts.length > 0 || stage.tasks.length > 0;
    }

    function hasTaskChildren(task: MissionSidebarTask): boolean {
        return task.artifacts.length > 0 || task.sessions.length > 0;
    }

    function normalizeStatusLabel(statusLabel: string | undefined): string {
        return statusLabel?.trim().toLowerCase() ?? "";
    }

    function isActiveTaskStatus(statusLabel: string | undefined): boolean {
        const normalizedStatus = normalizeStatusLabel(statusLabel);

        return ["queued", "running", "starting", "awaiting input"].includes(
            normalizedStatus,
        );
    }

    function taskContainsSelectedNode(task: MissionSidebarTask): boolean {
        return (
            activeNodeId === task.node.id ||
            task.artifacts.some((artifact) => artifact.id === activeNodeId) ||
            task.sessions.some((session) => session.id === activeNodeId)
        );
    }

    function stageContainsSelectedNode(stage: MissionSidebarStage): boolean {
        return (
            activeNodeId === stage.node.id ||
            stage.artifacts.some((artifact) => artifact.id === activeNodeId) ||
            stage.tasks.some((task) => taskContainsSelectedNode(task))
        );
    }

    function isTaskDefaultOpen(task: MissionSidebarTask): boolean {
        return (
            hasTaskChildren(task) &&
            (isActiveTaskStatus(task.node.statusLabel) ||
                taskContainsSelectedNode(task) ||
                task.sessions.some((session) =>
                    isActiveTaskStatus(session.statusLabel),
                ))
        );
    }

    function isStageDefaultOpen(stage: MissionSidebarStage): boolean {
        return (
            hasStageChildren(stage) &&
            (stage.node.stageId === currentMissionStageId ||
                isActiveTaskStatus(stage.node.statusLabel) ||
                stageContainsSelectedNode(stage) ||
                stage.tasks.some((task) => isTaskDefaultOpen(task)))
        );
    }

    function isBranchOpen(nodeId: string, defaultOpen: boolean): boolean {
        return missionBranchOverrides[nodeId] ?? defaultOpen;
    }

    function setBranchOpen(nodeId: string, open: boolean): void {
        missionBranchOverrides[nodeId] = open;
    }

    function isStageExpanded(stage: MissionSidebarStage): boolean {
        return isBranchOpen(stage.node.id, isStageDefaultOpen(stage));
    }

    function isTaskExpanded(task: MissionSidebarTask): boolean {
        return isBranchOpen(task.node.id, isTaskDefaultOpen(task));
    }

    function fileItemClass(selected: boolean): string {
        return cn(
            "w-full justify-start rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50",
            selected && "bg-accent/70 ring-border/60 ring-1 hover:bg-accent",
        );
    }

    function folderItemClass(selected: boolean): string {
        return cn(
            "rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-accent/50",
            selected && "bg-accent/70 ring-border/60 ring-1 hover:bg-accent",
        );
    }
</script>

<section
    class={cn(
        "grid h-full min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-2xl border bg-card/70 backdrop-blur-sm",
        className,
    )}
>
    <div class="min-h-0 overflow-auto p-2">
        {#if missionOutline}
            <TreeView.Root class="gap-1">
                {#each missionOutline.artifacts as artifact (artifact.node.id)}
                    {@const selected = activeNodeId === artifact.node.id}
                    <TreeView.File
                        name={nodeLabel(artifact.node)}
                        class={fileItemClass(selected)}
                        style={nodeStyle(artifact.node)}
                        onclick={() => onSelectNode(artifact.node.id)}
                    >
                        {#snippet icon()}
                            <Icon
                                icon="lucide:file-text"
                                class="size-4 shrink-0"
                            />
                        {/snippet}
                    </TreeView.File>
                {/each}

                {#each missionOutline.stages as stage (stage.node.id)}
                    {@const stageSelected =
                        activeNodeId === stage.node.id ||
                        stage.node.stageId === currentMissionStageId}
                    {#if hasStageChildren(stage)}
                        <TreeView.Folder
                            name={stage.node.label}
                            class={folderItemClass(stageSelected)}
                            style={nodeStyle(stage.node)}
                            onclick={() => onSelectNode(stage.node.id)}
                            bind:open={
                                () => isStageExpanded(stage),
                                (open) => setBranchOpen(stage.node.id, open)
                            }
                        >
                            {#snippet icon({ open })}
                                <Icon
                                    icon="lucide:calendar"
                                    class="size-4 shrink-0"
                                />
                            {/snippet}

                            {#each stage.tasks as task (task.node.id)}
                                {@const taskSelected =
                                    activeNodeId === task.node.id}
                                {#if hasTaskChildren(task)}
                                    <TreeView.Folder
                                        name={task.node.label}
                                        class={folderItemClass(taskSelected)}
                                        style={nodeStyle(task.node)}
                                        onclick={() =>
                                            onSelectNode(task.node.id)}
                                        bind:open={
                                            () => isTaskExpanded(task),
                                            (open) =>
                                                setBranchOpen(
                                                    task.node.id,
                                                    open,
                                                )
                                        }
                                    >
                                        {#snippet icon({ open })}
                                            <Icon
                                                icon="lucide:layout-dashboard"
                                                class="size-4 shrink-0"
                                            />
                                        {/snippet}

                                        {#each task.artifacts as artifact (artifact.id)}
                                            {@const selected =
                                                activeNodeId === artifact.id}
                                            <TreeView.File
                                                name={nodeLabel(artifact)}
                                                class={fileItemClass(selected)}
                                                style={nodeStyle(artifact)}
                                                onclick={() =>
                                                    onSelectNode(artifact.id)}
                                            >
                                                {#snippet icon()}
                                                    <Icon
                                                        icon="lucide:file-text"
                                                        class="size-4 shrink-0"
                                                    />
                                                {/snippet}
                                            </TreeView.File>
                                        {/each}

                                        {#each task.sessions as session (session.id)}
                                            {@const selected =
                                                activeNodeId === session.id}
                                            {@const sessionIconName =
                                                sessionIcon(session)}
                                            <TreeView.File
                                                name={nodeLabel(session)}
                                                class={fileItemClass(selected)}
                                                style={nodeStyle(session)}
                                                onclick={() =>
                                                    onSelectNode(session.id)}
                                            >
                                                {#snippet icon()}
                                                    <Icon
                                                        icon={sessionIconName}
                                                        class={cn(
                                                            "size-4 shrink-0",
                                                            sessionIconClass(
                                                                session,
                                                            ),
                                                        )}
                                                    />
                                                {/snippet}
                                            </TreeView.File>
                                        {/each}
                                    </TreeView.Folder>
                                {:else}
                                    <TreeView.File
                                        name={task.node.label}
                                        class={fileItemClass(taskSelected)}
                                        style={nodeStyle(task.node)}
                                        onclick={() =>
                                            onSelectNode(task.node.id)}
                                    >
                                        {#snippet icon()}
                                            <Icon
                                                icon="lucide:layout-dashboard"
                                                class="size-4 shrink-0"
                                            />
                                        {/snippet}
                                    </TreeView.File>
                                {/if}
                            {/each}

                            {#each stage.artifacts as artifact (artifact.id)}
                                {@const selected = activeNodeId === artifact.id}
                                <TreeView.File
                                    name={nodeLabel(artifact)}
                                    class={fileItemClass(selected)}
                                    style={nodeStyle(artifact)}
                                    onclick={() => onSelectNode(artifact.id)}
                                >
                                    {#snippet icon()}
                                        <Icon
                                            icon="lucide:file-text"
                                            class="size-4 shrink-0"
                                        />
                                    {/snippet}
                                </TreeView.File>
                            {/each}
                        </TreeView.Folder>
                    {:else}
                        <TreeView.File
                            name={stage.node.label}
                            class={fileItemClass(stageSelected)}
                            style={nodeStyle(stage.node)}
                            onclick={() => onSelectNode(stage.node.id)}
                        >
                            {#snippet icon()}
                                <Icon
                                    icon="lucide:calendar"
                                    class="size-4 shrink-0"
                                />
                            {/snippet}
                        </TreeView.File>
                    {/if}
                {/each}
            </TreeView.Root>
        {:else}
            <div
                class="rounded-xl border border-dashed bg-background/60 px-4 py-8 text-sm text-muted-foreground"
            >
                Mission files will appear once the control view is available.
            </div>
        {/if}
    </div>
</section>
