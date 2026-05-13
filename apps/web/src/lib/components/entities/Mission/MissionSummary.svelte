<script lang="ts">
    import { app } from "$lib/client/Application.svelte.js";
    import type { Mission } from "$lib/components/entities/Mission/Mission.svelte.js";
    import type { Stage } from "$lib/components/entities/Stage/Stage.svelte.js";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";

    const mission = $derived.by(() => {
        const resolvedMission = app.mission;
        if (!resolvedMission) {
            throw new Error("Mission summary requires app.mission.");
        }

        return resolvedMission;
    });
    const missionId = $derived(mission.missionId);

    const stages = $derived<Stage[]>(mission.listStages());
    const completedStageCount = $derived(
        stages.filter((stage) => stage.lifecycle === "completed").length,
    );
    const progressPercent = $derived(
        stages.length === 0
            ? 0
            : Math.round((completedStageCount / stages.length) * 100),
    );
    let missionCommandPending = $state<string | null>(null);
    let itemCommandPending = $state<string | null>(null);
    let commandError = $state<string | null>(null);

    function stageTone(stage: Stage): string {
        switch (stage.lifecycle) {
            case "completed":
                return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
            case "running":
                return "border-sky-500/40 bg-sky-500/10 text-sky-700";
            case "ready":
                return "border-amber-500/40 bg-amber-500/10 text-amber-700";
            default:
                return "border-muted bg-background/80 text-muted-foreground";
        }
    }

    async function runMissionCommand(
        commandId: string,
        run: () => Promise<unknown>,
    ): Promise<void> {
        commandError = null;
        missionCommandPending = commandId;
        try {
            await run();
        } catch (error) {
            commandError =
                error instanceof Error ? error.message : String(error);
        } finally {
            missionCommandPending = null;
        }
    }

    async function runItemCommand(
        commandId: string,
        run: () => Promise<unknown>,
    ): Promise<void> {
        commandError = null;
        itemCommandPending = commandId;
        try {
            await run();
        } catch (error) {
            commandError =
                error instanceof Error ? error.message : String(error);
        } finally {
            itemCommandPending = null;
        }
    }
</script>

<section
    class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm overflow-auto"
>
    <div class="flex items-center justify-between gap-4">
        <h2 class="text-lg font-semibold text-foreground">Selected mission</h2>
        {#if missionId}
            <Badge variant="secondary">{missionId}</Badge>
        {/if}
    </div>

    {#if mission}
        <div class="mt-4 space-y-4">
            <header class="rounded-xl border bg-background/70 p-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <p class="text-sm font-semibold text-foreground">
                        Lifecycle: {mission.workflowLifecycle ?? "unknown"}
                    </p>
                    <p class="text-xs text-muted-foreground">
                        Updated: {mission.workflowUpdatedAt ?? "Unknown"}
                    </p>
                </div>
                <div class="mt-3 h-2 rounded-full bg-muted">
                    <div
                        class="h-full rounded-full bg-primary transition-all"
                        style={`width: ${progressPercent}%`}
                    ></div>
                </div>
                <div
                    class="mt-2 flex items-center justify-between text-xs text-muted-foreground"
                >
                    <span
                        >{completedStageCount}/{stages.length} stages complete</span
                    >
                    <span>{progressPercent}%</span>
                </div>
                <div class="mt-4 flex flex-wrap gap-2">
                    {#each mission.commands as command (command.commandId)}
                        <Button
                            size="sm"
                            variant={command.variant ?? "outline"}
                            disabled={missionCommandPending !== null ||
                                !command.available}
                            title={command.unavailableReason}
                            onclick={() =>
                                runMissionCommand(command.commandId, () =>
                                    mission.executeCommand(command.commandId),
                                )}
                        >
                            {missionCommandPending === command.commandId
                                ? `${command.label}...`
                                : command.label}
                        </Button>
                    {/each}
                </div>
                {#if commandError}
                    <p class="mt-3 text-sm text-rose-600">{commandError}</p>
                {/if}
                <div class="mt-4 flex gap-2 overflow-x-auto pb-1">
                    {#each stages as stage (stage.stageId)}
                        <div
                            class={`min-w-36 rounded-lg border px-3 py-2 ${stageTone(stage)}`}
                        >
                            <p class="text-xs uppercase tracking-wide">
                                {stage.stageId}
                            </p>
                            <p class="text-xs">{stage.lifecycle}</p>
                        </div>
                    {/each}
                </div>
            </header>

            <section class="grid gap-3">
                {#each stages as stage (stage.stageId)}
                    <article class="rounded-xl border bg-background/70 p-4">
                        <div class="flex items-center justify-between gap-3">
                            <h3 class="text-sm font-semibold text-foreground">
                                {stage.stageId}
                            </h3>
                            <Badge
                                variant={stage.isCurrentStage
                                    ? "default"
                                    : "outline"}
                            >
                                {stage.isCurrentStage
                                    ? "Current"
                                    : stage.lifecycle}
                            </Badge>
                        </div>

                        <div class="mt-3 grid gap-3 lg:grid-cols-2">
                            <div class="rounded-lg border bg-background p-3">
                                <p
                                    class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
                                >
                                    Artifacts
                                </p>
                                {#if stage.artifacts.length === 0}
                                    <p
                                        class="mt-2 text-sm text-muted-foreground"
                                    >
                                        No artifacts mapped for this stage.
                                    </p>
                                {:else}
                                    <ul class="mt-2 space-y-1">
                                        {#each stage.artifacts as artifact (artifact.key)}
                                            <li class="text-sm text-foreground">
                                                {artifact.label}
                                                <span
                                                    class="text-muted-foreground"
                                                    >({artifact.fileName})</span
                                                >
                                            </li>
                                        {/each}
                                    </ul>
                                {/if}
                            </div>

                            <div class="rounded-lg border bg-background p-3">
                                <p
                                    class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
                                >
                                    Tasks
                                </p>
                                {#if stage.listTasks().length === 0}
                                    <p
                                        class="mt-2 text-sm text-muted-foreground"
                                    >
                                        No tasks available for this stage yet.
                                    </p>
                                {:else}
                                    <ul class="mt-2 space-y-2">
                                        {#each stage.listTasks() as task (task.taskId)}
                                            <li
                                                class="rounded-md border bg-card px-2 py-2"
                                            >
                                                <div
                                                    class="flex items-center justify-between gap-2"
                                                >
                                                    <p
                                                        class="text-sm font-medium text-foreground"
                                                    >
                                                        {task.title}
                                                    </p>
                                                    <Badge variant="outline"
                                                        >{task.lifecycle}</Badge
                                                    >
                                                </div>
                                                <div
                                                    class="mt-2 flex flex-wrap gap-2"
                                                >
                                                    {#each task.commands as command (command.commandId)}
                                                        {@const pendingCommandId = `${task.taskId}:${command.commandId}`}
                                                        <Button
                                                            size="sm"
                                                            variant={command.variant ??
                                                                "outline"}
                                                            disabled={itemCommandPending !==
                                                                null ||
                                                                !command.available}
                                                            title={command.unavailableReason}
                                                            onclick={() =>
                                                                runItemCommand(
                                                                    pendingCommandId,
                                                                    () =>
                                                                        task.executeCommand(
                                                                            command.commandId,
                                                                        ),
                                                                )}
                                                        >
                                                            {itemCommandPending ===
                                                            pendingCommandId
                                                                ? `${command.label}...`
                                                                : command.label}
                                                        </Button>
                                                    {/each}
                                                </div>
                                                <p
                                                    class="mt-1 font-mono text-xs text-muted-foreground"
                                                >
                                                    {task.taskId}
                                                </p>
                                            </li>
                                        {/each}
                                    </ul>
                                {/if}
                            </div>
                        </div>
                    </article>
                {/each}
            </section>

            <div class="rounded-xl border bg-background/70 px-4 py-3">
                <p
                    class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                >
                    Agent executions
                </p>
                {#if mission.listExecutions().length === 0}
                    <p class="mt-2 text-sm text-muted-foreground">
                        No live agent executions are attached to this mission
                        yet.
                    </p>
                {:else}
                    <div class="mt-3 grid gap-2">
                        {#each mission.listExecutions() as execution (execution.agentExecutionId)}
                            <div
                                class="rounded-lg border bg-background px-3 py-2"
                            >
                                <div
                                    class="flex items-center justify-between gap-2"
                                >
                                    <p
                                        class="text-sm font-medium text-foreground"
                                    >
                                        {execution.agentExecutionId}
                                    </p>
                                    <Badge variant="outline"
                                        >{execution.lifecycleState}</Badge
                                    >
                                </div>
                                {#if execution.currentTurnTitle}
                                    <p
                                        class="mt-1 text-sm text-muted-foreground"
                                    >
                                        {execution.currentTurnTitle}
                                    </p>
                                {/if}
                                <div class="mt-2 flex flex-wrap gap-2">
                                    {#each execution.commands as command (command.commandId)}
                                        {@const pendingCommandId = `${execution.agentExecutionId}:${command.commandId}`}
                                        <Button
                                            size="sm"
                                            variant={command.variant ??
                                                "outline"}
                                            disabled={itemCommandPending !==
                                                null || !command.available}
                                            title={command.unavailableReason}
                                            onclick={() =>
                                                runItemCommand(
                                                    pendingCommandId,
                                                    () =>
                                                        execution.executeCommand(
                                                            command.commandId,
                                                        ),
                                                )}
                                        >
                                            {itemCommandPending ===
                                            pendingCommandId
                                                ? `${command.label}...`
                                                : command.label}
                                        </Button>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    {:else}
        <p class="mt-4 text-sm text-muted-foreground">
            Select a mission below to inspect mission stages, tasks, and
            artifacts.
        </p>
    {/if}
</section>
