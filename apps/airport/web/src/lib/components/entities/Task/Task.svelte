<script lang="ts">
    import AgentSession from "$lib/components/entities/AgentSession/AgentSession.svelte";
    import type { AgentSession as AgentSessionEntity } from "$lib/components/entities/AgentSession/AgentSession.svelte.js";
    import Artifact from "$lib/components/entities/Artifact/Artifact.svelte";
    import type { Artifact as ArtifactEntity } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import type { Task as TaskEntity } from "$lib/components/entities/Task/Task.svelte.js";
    import TaskCommandbar from "$lib/components/entities/Task/TaskCommandbar.svelte";
    import type { RepositoryAgentRunnerSettingsType } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import {
        ResizableHandle,
        ResizablePane,
        ResizablePaneGroup,
    } from "$lib/components/ui/resizable";
    import * as Tabs from "$lib/components/ui/tabs/index.js";

    let {
        refreshNonce,
        agentRunners = [],
        artifacts = [],
        selectedArtifactId,
        task,
        session,
        sessions = [],
        onCommandExecuted,
    }: {
        refreshNonce: number;
        agentRunners?: RepositoryAgentRunnerSettingsType[];
        artifacts?: ArtifactEntity[];
        selectedArtifactId?: string;
        task?: TaskEntity;
        session?: AgentSessionEntity;
        sessions?: AgentSessionEntity[];
        onCommandExecuted: () => Promise<void>;
    } = $props();

    let activeArtifactTab = $state("");
    let activeAgentSessionTab = $state("");
    let lastSelectedArtifactId = $state<string | undefined>(undefined);
    let lastSelectedAgentSessionId = $state<string | undefined>(undefined);

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
    const agentSessionTabs = $derived.by(() => {
        const tabs: AgentSessionEntity[] = [];
        for (const candidate of [...sessions, ...(session ? [session] : [])]) {
            if (
                tabs.some(
                    (agentSessionTab) => agentSessionTab.id === candidate.id,
                )
            ) {
                continue;
            }
            tabs.push(candidate);
        }
        return tabs.sort(compareAgentSessionTabs);
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
        const selectedAgentSessionId = session?.sessionId;
        const selectedAgentSessionChanged =
            selectedAgentSessionId !== lastSelectedAgentSessionId;
        if (selectedAgentSessionChanged) {
            lastSelectedAgentSessionId = selectedAgentSessionId;
        }

        if (agentSessionTabs.length === 0) {
            activeAgentSessionTab = "";
            return;
        }

        const selectedAgentSessionExists = Boolean(
            selectedAgentSessionId &&
                agentSessionTabs.some(
                    (candidate) => candidate.id === selectedAgentSessionId,
                ),
        );
        if (
            selectedAgentSessionChanged &&
            selectedAgentSessionId &&
            selectedAgentSessionExists
        ) {
            activeAgentSessionTab = selectedAgentSessionId;
            return;
        }

        if (selectedAgentSessionChanged && !selectedAgentSessionId) {
            activeAgentSessionTab = agentSessionTabs[0].id;
            return;
        }

        if (
            !agentSessionTabs.some(
                (candidate) => candidate.id === activeAgentSessionTab,
            )
        ) {
            activeAgentSessionTab = agentSessionTabs[0].id;
        }
    });

    function artifactTabLabel(artifact: ArtifactEntity): string {
        if (artifact.taskId && (!task || artifact.taskId === task.taskId)) {
            return "Task";
        }

        return artifact.label;
    }

    function agentSessionTabLabel(agentSession: AgentSessionEntity): string {
        const snapshot = agentSession.toData();
        const runnerLabel = snapshot.runnerId.trim();
        const startTime = formatAgentSessionStartTime(snapshot.createdAt);
        return startTime ? `${runnerLabel} ${startTime}` : runnerLabel;
    }

    function formatAgentSessionStartTime(
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

    function compareAgentSessionTabs(
        left: AgentSessionEntity,
        right: AgentSessionEntity,
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

        return getAgentSessionUpdatedAt(right) - getAgentSessionUpdatedAt(left);
    }

    function getAgentSessionUpdatedAt(
        agentSession: AgentSessionEntity,
    ): number {
        const snapshot = agentSession.toData();
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
                {agentRunners}
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
            {#if agentSessionTabs.length > 0}
                <Tabs.Root
                    bind:value={activeAgentSessionTab}
                    class="min-h-0 flex-1 overflow-hidden border bg-card/70 backdrop-blur-sm"
                >
                    <Tabs.List class="w-full overflow-x-auto overflow-y-hidden">
                        {#each agentSessionTabs as agentSessionTab (agentSessionTab.id)}
                            <Tabs.Trigger
                                value={agentSessionTab.id}
                                class="min-w-32 max-w-56 flex-none truncate"
                            >
                                <span class="truncate">
                                    {agentSessionTabLabel(agentSessionTab)}
                                </span>
                            </Tabs.Trigger>
                        {/each}
                    </Tabs.List>

                    {#each agentSessionTabs as agentSessionTab (agentSessionTab.id)}
                        <Tabs.Content
                            value={agentSessionTab.id}
                            class="min-h-0 overflow-hidden"
                        >
                            <AgentSession
                                {refreshNonce}
                                session={agentSessionTab}
                                {onCommandExecuted}
                            />
                        </Tabs.Content>
                    {/each}
                </Tabs.Root>
            {:else}
                <AgentSession
                    {refreshNonce}
                    session={undefined}
                    {onCommandExecuted}
                />
            {/if}
        </ResizablePane>
    </ResizablePaneGroup>
</section>
