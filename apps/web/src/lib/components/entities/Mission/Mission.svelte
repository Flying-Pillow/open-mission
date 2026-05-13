<script lang="ts">
    import { app } from "$lib/client/Application.svelte.js";
    import MissionCockpit from "$lib/components/entities/Mission/MissionCockpit.svelte";
    import MissionCommandbar from "$lib/components/entities/Mission/MissionCommandbar.svelte";
    import MissionFileTree from "$lib/components/entities/Mission/MissionFileTree.svelte";
    import MissionTaskList from "$lib/components/entities/Mission/MissionTaskList.svelte";
    import MissionTerminal from "$lib/components/entities/Mission/MissionTerminal.svelte";
    import Task from "$lib/components/entities/Task/Task.svelte";
    import {
        ResizableHandle,
        ResizablePane,
        ResizablePaneGroup,
    } from "$lib/components/ui/resizable";
    import * as Tabs from "$lib/components/ui/tabs/index.js";
    import type { MissionFileTreeNode } from "$lib/types/mission-file-tree";

    let commandRefreshNonce = $state(0);
    let leftPanelMode = $state<"mission" | "files">("mission");
    let selectedWorktreeNode = $state<MissionFileTreeNode | null>(null);
    let observedFocusId = $state<string | undefined>();

    const selectedWorktreeFile = $derived(
        selectedWorktreeNode?.kind === "file" ? selectedWorktreeNode : null,
    );

    async function refreshMissionView(): Promise<void> {
        if (!app.mission) {
            return;
        }

        const controlData = await app.mission.getControlData();
        app.mission.setRouteState({
            controlData,
            worktreePath: app.mission.missionWorktreePath,
        });
        commandRefreshNonce += 1;
    }

    async function handleMissionMutated(): Promise<void> {
        await refreshMissionView();
    }

    async function handleTaskAutostartChange(
        taskId: string,
        autostart: boolean,
    ): Promise<void> {
        await app.configureTask({
            taskId,
            options: { autostart },
        });
        await handleMissionMutated();
    }

    function handleSelectWorktreeNode(node: MissionFileTreeNode): void {
        selectedWorktreeNode = node.kind === "file" ? node : null;
    }

    $effect(() => {
        if (observedFocusId === app.focusId) {
            return;
        }

        observedFocusId = app.focusId;
        selectedWorktreeNode = null;
    });
</script>

<div class="flex min-h-0 flex-1 flex-col">
    {#if app.missionLoading && !app.mission}
        <section
            class="border bg-card/70 text-sm text-muted-foreground backdrop-blur-sm p-2"
        >
            Loading mission snapshot...
        </section>
    {:else if app.missionError || !app.repository || !app.mission || !app.mission.controlData}
        <section class="border bg-card/70 backdrop-blur-sm p-2">
            <h2 class="text-lg font-semibold text-foreground">Mission</h2>
            <p class="mt-3 text-sm text-rose-600">
                {app.missionError ?? "Mission view could not be loaded."}
            </p>
        </section>
    {:else}
        <MissionCockpit />

        <ResizablePaneGroup
            direction="horizontal"
            class="min-h-0 flex-1 overflow-hidden"
            autoSaveId={`mission:${app.mission.missionId}`}
        >
            <ResizablePane
                defaultSize={24}
                minSize={18}
                class="flex h-full min-h-0 flex-col"
            >
                <Tabs.Root
                    bind:value={leftPanelMode}
                    class="min-h-0 flex-1 overflow-hidden border bg-card/70 backdrop-blur-sm"
                >
                    <div class="border-b">
                        <div class="border-b p-2">
                            <MissionCommandbar
                                refreshNonce={commandRefreshNonce}
                                mission={app.mission}
                                onCommandExecuted={handleMissionMutated}
                            />
                        </div>

                        <Tabs.List class="w-full">
                            <Tabs.Trigger value="mission">Tasks</Tabs.Trigger>
                            <Tabs.Trigger value="files">Files</Tabs.Trigger>
                        </Tabs.List>
                    </div>

                    <div class="relative min-h-0 flex-1 overflow-hidden p-0">
                        {#if leftPanelMode === "mission"}
                            <div
                                class="absolute inset-0 min-h-0 overflow-hidden"
                            >
                                <MissionTaskList
                                    refreshNonce={commandRefreshNonce}
                                    class="h-full rounded-none border-0 bg-transparent"
                                    onTaskAutostartChange={handleTaskAutostartChange}
                                    onCommandExecuted={handleMissionMutated}
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
                defaultSize={76}
                minSize={24}
                class="flex h-full min-h-0 flex-col"
            >
                <ResizablePaneGroup
                    direction="vertical"
                    class="min-h-0 flex-1 overflow-hidden"
                    autoSaveId={`mission-panel:${app.mission.missionId}`}
                >
                    <ResizablePane
                        defaultSize={68}
                        minSize={35}
                        class="flex h-full min-h-0 flex-col"
                    >
                        <Task
                            refreshNonce={commandRefreshNonce}
                            onCommandExecuted={handleMissionMutated}
                        />
                    </ResizablePane>

                    <ResizableHandle withHandle />

                    <ResizablePane
                        defaultSize={5}
                        minSize={5}
                        maxSize={60}
                        class="flex h-full min-h-0 flex-col border bg-card/70 backdrop-blur-sm"
                    >
                        <MissionTerminal />
                    </ResizablePane>
                </ResizablePaneGroup>
            </ResizablePane>
        </ResizablePaneGroup>
    {/if}
</div>
