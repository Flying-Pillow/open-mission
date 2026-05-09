<script lang="ts">
    import AgentExecution from "$lib/components/entities/AgentExecution/AgentExecution.svelte";
    import type { AgentExecution as AgentExecutionEntity } from "$lib/components/entities/AgentExecution/AgentExecution.svelte.js";
    import Artifact from "$lib/components/entities/Artifact/Artifact.svelte";
    import type { Artifact as ArtifactEntity } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import type { Task as TaskEntity } from "$lib/components/entities/Task/Task.svelte.js";
    import TaskCommandbar from "$lib/components/entities/Task/TaskCommandbar.svelte";
    import type { AgentDataType } from "@flying-pillow/mission-core/entities/Agent/AgentSchema";
    import type { AgentIdType } from "@flying-pillow/mission-core/entities/Agent/AgentSchema";
    import {
        ResizableHandle,
        ResizablePane,
        ResizablePaneGroup,
    } from "$lib/components/ui/resizable";
    import * as Tabs from "$lib/components/ui/tabs/index.js";

    let {
        refreshNonce,
        availableAgents = [],
        enabledAgentAdapters = [],
        artifacts = [],
        selectedArtifactId,
        task,
        session,
        sessions = [],
        onCommandExecuted,
    }: {
        refreshNonce: number;
        availableAgents?: AgentDataType[];
        enabledAgentAdapters?: AgentIdType[];
        artifacts?: ArtifactEntity[];
        selectedArtifactId?: string;
        task?: TaskEntity;
        session?: AgentExecutionEntity;
        sessions?: AgentExecutionEntity[];
        onCommandExecuted: () => Promise<void>;
    } = $props();

    let activeArtifactTab = $state("");
    let activeAgentExecutionTab = $state("");
    let lastSelectedArtifactId = $state<string | undefined>(undefined);
    let lastSelectedAgentExecutionId = $state<string | undefined>(undefined);

    const panelLabel = $derived(task?.title ?? "Task");
    const artifactTabs = $derived.by(() => {
        const tabs: ArtifactEntity[] = [];
        for (const candidate of artifacts) {
            if (tabs.some((artifactTab) => artifactTab.id === candidate.id)) {
                continue;
            }
            tabs.push(candidate);
        }
        return tabs;
    });
    const agentExecutionTabs = $derived.by(() => {
        const tabs: AgentExecutionEntity[] = [];
        for (const candidate of [...sessions, ...(session ? [session] : [])]) {
            if (
                tabs.some(
                    (agentExecutionTab) =>
                        agentExecutionTab.id === candidate.id,
                )
            ) {
                continue;
            }
            tabs.push(candidate);
        }
        return tabs.sort(compareAgentExecutionTabs);
    });
    $effect(() => {
        const selectedArtifactChanged =
            selectedArtifactId !== lastSelectedArtifactId;
        if (selectedArtifactChanged) {
            lastSelectedArtifactId = selectedArtifactId;
        }

        if (artifactTabs.length === 0) {
            activeArtifactTab = "";
            return;
        }

        const selectedArtifactExists = Boolean(
            selectedArtifactId &&
                artifactTabs.some(
                    (candidate) => candidate.id === selectedArtifactId,
                ),
        );
        if (
            selectedArtifactChanged &&
            selectedArtifactId &&
            selectedArtifactExists
        ) {
            activeArtifactTab = selectedArtifactId;
            return;
        }

        if (selectedArtifactChanged && !selectedArtifactId) {
            activeArtifactTab = artifactTabs[0].id;
            return;
        }

        if (
            !artifactTabs.some(
                (candidate) => candidate.id === activeArtifactTab,
            )
        ) {
            activeArtifactTab = artifactTabs[0].id;
        }
    });
    $effect(() => {
        const selectedAgentExecutionId = session?.sessionId;
        const selectedAgentExecutionChanged =
            selectedAgentExecutionId !== lastSelectedAgentExecutionId;
        if (selectedAgentExecutionChanged) {
            lastSelectedAgentExecutionId = selectedAgentExecutionId;
        }

        if (agentExecutionTabs.length === 0) {
            activeAgentExecutionTab = "";
            return;
        }

        const selectedAgentExecutionExists = Boolean(
            selectedAgentExecutionId &&
                agentExecutionTabs.some(
                    (candidate) => candidate.id === selectedAgentExecutionId,
                ),
        );
        if (
            selectedAgentExecutionChanged &&
            selectedAgentExecutionId &&
            selectedAgentExecutionExists
        ) {
            activeAgentExecutionTab = selectedAgentExecutionId;
            return;
        }

        if (selectedAgentExecutionChanged && !selectedAgentExecutionId) {
            activeAgentExecutionTab = agentExecutionTabs[0].id;
            return;
        }

        if (
            !agentExecutionTabs.some(
                (candidate) => candidate.id === activeAgentExecutionTab,
            )
        ) {
            activeAgentExecutionTab = agentExecutionTabs[0].id;
        }
    });

    function artifactTabLabel(artifact: ArtifactEntity): string {
        if (artifact.taskId && (!task || artifact.taskId === task.taskId)) {
            return "Task";
        }

        return artifact.label;
    }

    function agentExecutionTabLabel(
        agentExecution: AgentExecutionEntity,
    ): string {
        const snapshot = agentExecution.toData();
        const adapterLabel = snapshot.agentId.trim();
        const startTime = formatAgentExecutionStartTime(snapshot.createdAt);
        return startTime ? `${adapterLabel} ${startTime}` : adapterLabel;
    }

    function formatAgentExecutionStartTime(
        timestamp: string | undefined,
    ): string {
        if (!timestamp) {
            return "";
        }

        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) {
            return "";
        }

        return date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
    }

    function compareAgentExecutionTabs(
        left: AgentExecutionEntity,
        right: AgentExecutionEntity,
    ): number {
        const leftActiveRank = left.isRunning() ? 1 : 0;
        const rightActiveRank = right.isRunning() ? 1 : 0;
        if (leftActiveRank !== rightActiveRank) {
            return rightActiveRank - leftActiveRank;
        }

        const leftTerminalRank = left.isTerminalBacked() ? 1 : 0;
        const rightTerminalRank = right.isTerminalBacked() ? 1 : 0;
        if (leftTerminalRank !== rightTerminalRank) {
            return rightTerminalRank - leftTerminalRank;
        }

        return (
            getAgentExecutionUpdatedAt(right) - getAgentExecutionUpdatedAt(left)
        );
    }

    function getAgentExecutionUpdatedAt(
        agentExecution: AgentExecutionEntity,
    ): number {
        const snapshot = agentExecution.toData();
        const timestamp = snapshot.lastUpdatedAt ?? snapshot.createdAt;
        return timestamp ? Date.parse(timestamp) || 0 : 0;
    }
</script>

<section
    class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
>
    <header
        class="flex min-h-11 flex-wrap items-center gap-2 border bg-card/70 px-3 py-2 backdrop-blur-sm overflow-hidden"
    >
        <div class="min-w-0 flex-1">
            <h2 class="truncate text-sm font-semibold text-foreground">
                {panelLabel}
            </h2>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <TaskCommandbar
                {refreshNonce}
                {availableAgents}
                {enabledAgentAdapters}
                {task}
                {onCommandExecuted}
            />
        </div>
    </header>

    <ResizablePaneGroup
        direction="horizontal"
        class="min-h-0 flex-1 overflow-hidden"
        autoSaveId="task-panel"
    >
        <ResizablePane
            defaultSize={58}
            minSize={30}
            class="flex h-full min-h-0 flex-col"
        >
            {#if artifactTabs.length > 0}
                <Tabs.Root
                    bind:value={activeArtifactTab}
                    class="min-h-0 flex-1 overflow-hidden border bg-card/70 backdrop-blur-sm"
                >
                    <Tabs.List class="w-full overflow-x-auto overflow-y-hidden">
                        {#each artifactTabs as artifactTab (artifactTab.id)}
                            <Tabs.Trigger value={artifactTab.id}>
                                {artifactTabLabel(artifactTab)}
                            </Tabs.Trigger>
                        {/each}
                    </Tabs.List>

                    {#each artifactTabs as artifactTab (artifactTab.id)}
                        <Tabs.Content
                            value={artifactTab.id}
                            class="min-h-0 overflow-hidden"
                        >
                            <Artifact {refreshNonce} artifact={artifactTab} />
                        </Tabs.Content>
                    {/each}
                </Tabs.Root>
            {:else}
                <Artifact {refreshNonce} artifact={undefined} />
            {/if}
        </ResizablePane>

        <ResizableHandle withHandle />

        <ResizablePane
            defaultSize={42}
            minSize={28}
            class="flex h-full min-h-0 flex-col"
        >
            {#if agentExecutionTabs.length > 0}
                <Tabs.Root
                    bind:value={activeAgentExecutionTab}
                    class="min-h-0 flex-1 overflow-hidden border bg-card/70 backdrop-blur-sm"
                >
                    <Tabs.List class="w-full overflow-x-auto overflow-y-hidden">
                        {#each agentExecutionTabs as agentExecutionTab (agentExecutionTab.id)}
                            <Tabs.Trigger
                                value={agentExecutionTab.id}
                                class="min-w-32 max-w-56 flex-none truncate"
                            >
                                <span class="truncate">
                                    {agentExecutionTabLabel(agentExecutionTab)}
                                </span>
                            </Tabs.Trigger>
                        {/each}
                    </Tabs.List>

                    {#each agentExecutionTabs as agentExecutionTab (agentExecutionTab.id)}
                        <Tabs.Content
                            value={agentExecutionTab.id}
                            class="min-h-0 overflow-hidden"
                        >
                            <AgentExecution
                                {refreshNonce}
                                session={agentExecutionTab}
                                {onCommandExecuted}
                            />
                        </Tabs.Content>
                    {/each}
                </Tabs.Root>
            {:else}
                <AgentExecution
                    {refreshNonce}
                    session={undefined}
                    {onCommandExecuted}
                />
            {/if}
        </ResizablePane>
    </ResizablePaneGroup>
</section>
