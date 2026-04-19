<script lang="ts">
    import type { Mission } from "$lib/client/entities/Mission";
    import { Badge } from "$lib/components/ui/badge/index.js";

    let {
        selectedMissionId,
        selectedMission,
    }: {
        selectedMissionId?: string;
        selectedMission?: Mission;
    } = $props();

    const workflowStages = $derived(selectedMission?.workflowStages ?? []);
    const completedStageCount = $derived(
        workflowStages.filter((stage) => stage.lifecycle === "completed")
            .length,
    );
    const progressPercent = $derived(
        workflowStages.length === 0
            ? 0
            : Math.round((completedStageCount / workflowStages.length) * 100),
    );

    function stageTone(stageLifecycle: string): string {
        switch (stageLifecycle) {
            case "completed":
                return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
            case "active":
                return "border-sky-500/40 bg-sky-500/10 text-sky-700";
            case "blocked":
                return "border-rose-500/40 bg-rose-500/10 text-rose-700";
            case "ready":
                return "border-amber-500/40 bg-amber-500/10 text-amber-700";
            default:
                return "border-muted bg-background/80 text-muted-foreground";
        }
    }
</script>

<section
    class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm overflow-auto"
>
    <div class="flex items-center justify-between gap-4">
        <h2 class="text-lg font-semibold text-foreground">Selected mission</h2>
        {#if selectedMissionId}
            <Badge variant="secondary">{selectedMissionId}</Badge>
        {/if}
    </div>

    {#if selectedMission}
        <div class="mt-4 space-y-4">
            <header class="rounded-xl border bg-background/70 p-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <p class="text-sm font-semibold text-foreground">
                        Lifecycle: {selectedMission.workflowLifecycle ??
                            "unknown"}
                    </p>
                    <p class="text-xs text-muted-foreground">
                        Updated: {selectedMission.workflowUpdatedAt ??
                            "Unknown"}
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
                        >{completedStageCount}/{workflowStages.length} stages complete</span
                    >
                    <span>{progressPercent}%</span>
                </div>
                <div class="mt-4 flex gap-2 overflow-x-auto pb-1">
                    {#each workflowStages as stage (stage.stageId)}
                        <div
                            class={`min-w-36 rounded-lg border px-3 py-2 ${stageTone(stage.lifecycle)}`}
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
                {#each workflowStages as stage (stage.stageId)}
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
                                {#if stage.tasks.length === 0}
                                    <p
                                        class="mt-2 text-sm text-muted-foreground"
                                    >
                                        No tasks available for this stage yet.
                                    </p>
                                {:else}
                                    <ul class="mt-2 space-y-2">
                                        {#each selectedMission.listTasksForStage(stage.stageId) as task (task.taskId)}
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
                    Agent sessions
                </p>
                {#if selectedMission.listSessions().length === 0}
                    <p class="mt-2 text-sm text-muted-foreground">
                        No live agent sessions are attached to this mission yet.
                    </p>
                {:else}
                    <div class="mt-3 grid gap-2">
                        {#each selectedMission.listSessions() as session (session.sessionId)}
                            <div
                                class="rounded-lg border bg-background px-3 py-2"
                            >
                                <div
                                    class="flex items-center justify-between gap-2"
                                >
                                    <p
                                        class="text-sm font-medium text-foreground"
                                    >
                                        {session.sessionId}
                                    </p>
                                    <Badge variant="outline"
                                        >{session.lifecycleState}</Badge
                                    >
                                </div>
                                {#if session.currentTurnTitle}
                                    <p
                                        class="mt-1 text-sm text-muted-foreground"
                                    >
                                        {session.currentTurnTitle}
                                    </p>
                                {/if}
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
