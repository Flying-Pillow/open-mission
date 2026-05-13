<script lang="ts">
    import Icon from "@iconify/svelte";
    import { app } from "$lib/client/Application.svelte.js";
    import EntityCommandbar from "$lib/components/entities/Entity/EntityCommandbar.svelte";
    import type { Stage } from "$lib/components/entities/Stage/Stage.svelte.js";
    import type { Task } from "$lib/components/entities/Task/Task.svelte.js";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Checkbox } from "$lib/components/ui/checkbox/index.js";
    import { cn } from "$lib/utils.js";

    let {
        refreshNonce,
        class: className,
        onTaskAutostartChange,
        onCommandExecuted,
    }: {
        refreshNonce: number;
        class?: string;
        onTaskAutostartChange?: (
            taskId: string,
            autostart: boolean,
        ) => void | Promise<void>;
        onCommandExecuted: () => Promise<void>;
    } = $props();

    let selectedStageOverrideId = $state<string | undefined>();

    const stages = $derived(app.mission?.listStages() ?? []);
    const currentStageId = $derived(
        app.mission?.controlData?.workflow?.currentStageId,
    );
    const defaultStageId = $derived(
        stages.find((stage) => stage.stageId === currentStageId)?.stageId ??
            stages[0]?.stageId,
    );
    const selectedStageId = $derived(
        selectedStageOverrideId &&
            stages.some((stage) => stage.stageId === selectedStageOverrideId)
            ? selectedStageOverrideId
            : defaultStageId,
    );
    const selectedStage = $derived(
        stages.find((stage) => stage.stageId === selectedStageId) ?? stages[0],
    );
    const selectedStageIndex = $derived(
        selectedStage
            ? stages.findIndex(
                  (stage) => stage.stageId === selectedStage.stageId,
              )
            : -1,
    );
    const stageTasks = $derived(selectedStage?.listTasks() ?? []);

    function stageFocusId(stageId: string): string {
        return `stage:${stageId}`;
    }

    function taskFocusId(taskId: string): string {
        return `task:${taskId}`;
    }

    function selectStage(stage: Stage | undefined): void {
        if (!stage) {
            return;
        }

        selectedStageOverrideId = stage.stageId;
        app.selectStage(stage);
    }

    function selectTask(task: Task): void {
        selectedStageOverrideId = task.stageId;
        app.selectTask(task);
    }

    function selectRelativeStage(offset: number): void {
        if (stages.length === 0) {
            return;
        }

        const baseIndex = selectedStageIndex >= 0 ? selectedStageIndex : 0;
        const nextIndex = Math.min(
            stages.length - 1,
            Math.max(0, baseIndex + offset),
        );
        selectStage(stages[nextIndex]);
    }

    function normalizeStatusLabel(statusLabel: string | undefined): string {
        return statusLabel?.trim().toLowerCase() ?? "";
    }

    function statusBadgeClass(statusLabel: string | undefined): string {
        switch (normalizeStatusLabel(statusLabel)) {
            case "running":
                return "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300";
            case "ready":
            case "queued":
            case "starting":
            case "awaiting input":
                return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
            case "completed":
            case "delivered":
                return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
            case "failed":
                return "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300";
            case "cancelled":
            case "terminated":
            case "paused":
                return "border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300";
            default:
                return "border-border bg-background text-muted-foreground";
        }
    }

    function statusIcon(statusLabel: string | undefined): string {
        switch (normalizeStatusLabel(statusLabel)) {
            case "running":
            case "starting":
                return "lucide:loader-circle";
            case "ready":
            case "queued":
                return "lucide:play-circle";
            case "completed":
            case "delivered":
                return "lucide:check-circle-2";
            case "failed":
                return "lucide:circle-alert";
            case "cancelled":
            case "terminated":
            case "paused":
                return "lucide:circle-pause";
            default:
                return "lucide:circle";
        }
    }

    function toggleTaskAutostart(task: Task, value: boolean): void {
        void onTaskAutostartChange?.(task.taskId, value);
    }
</script>

<section
    class={cn(
        "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border bg-card/70 backdrop-blur-sm",
        className,
    )}
>
    {#if app.mission && stages.length > 0 && selectedStage}
        <header class="border-b p-2">
            <div class="flex items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    disabled={selectedStageIndex <= 0}
                    aria-label="Previous stage"
                    title="Previous stage"
                    onclick={() => selectRelativeStage(-1)}
                >
                    <Icon icon="lucide:chevron-left" class="size-4" />
                </Button>

                <button
                    type="button"
                    class={cn(
                        "min-w-0 flex-1 rounded-md border bg-background/70 px-2 py-1.5 text-left transition-colors hover:bg-accent/50",
                        app.focusId === stageFocusId(selectedStage.stageId) &&
                            "bg-accent/70 ring-1 ring-border/60",
                    )}
                    onclick={() => selectStage(selectedStage)}
                >
                    <span class="flex min-w-0 items-center gap-2">
                        <span
                            class="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
                        >
                            {selectedStage.stageId}
                        </span>
                        <Badge
                            variant="outline"
                            class={cn(
                                "shrink-0 rounded-full px-2 text-[0.6875rem] leading-5",
                                statusBadgeClass(selectedStage.lifecycle),
                            )}
                        >
                            {selectedStage.stageId === currentStageId
                                ? "active"
                                : selectedStage.lifecycle}
                        </Badge>
                    </span>
                </button>

                <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    disabled={selectedStageIndex < 0 ||
                        selectedStageIndex >= stages.length - 1}
                    aria-label="Next stage"
                    title="Next stage"
                    onclick={() => selectRelativeStage(1)}
                >
                    <Icon icon="lucide:chevron-right" class="size-4" />
                </Button>
            </div>
        </header>

        <div class="min-h-0 overflow-auto p-2">
            {#if stageTasks.length > 0}
                <div class="space-y-2">
                    {#each stageTasks as task (task.taskId)}
                        {@const selected =
                            app.focusId === taskFocusId(task.taskId)}
                        <article
                            class={cn(
                                "rounded-lg border bg-background/70 p-2 shadow-sm transition-colors",
                                selected &&
                                    "border-primary/40 bg-accent/60 ring-1 ring-primary/20",
                            )}
                        >
                            <div class="flex min-w-0 items-start gap-2">
                                <Checkbox
                                    checked={task.autostart}
                                    disabled={!onTaskAutostartChange}
                                    onCheckedChange={(
                                        value: boolean | "indeterminate",
                                    ) =>
                                        toggleTaskAutostart(
                                            task,
                                            value === true,
                                        )}
                                    aria-label={`Toggle autostart for ${task.title}`}
                                    class="mt-1"
                                />

                                <button
                                    type="button"
                                    class="min-w-0 flex-1 text-left"
                                    onclick={() => selectTask(task)}
                                >
                                    <span
                                        class="flex min-w-0 items-start gap-2"
                                    >
                                        <Icon
                                            icon={statusIcon(task.lifecycle)}
                                            class={cn(
                                                "mt-0.5 size-4 shrink-0 text-muted-foreground",
                                                normalizeStatusLabel(
                                                    task.lifecycle,
                                                ) === "running" &&
                                                    "animate-spin text-sky-500",
                                            )}
                                        />
                                        <span class="min-w-0 flex-1">
                                            <span
                                                class="block truncate text-sm font-medium text-foreground"
                                            >
                                                {task.title}
                                            </span>
                                            <span
                                                class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                                            >
                                                <Badge
                                                    variant="outline"
                                                    class={cn(
                                                        "rounded-full px-2 text-[0.6875rem] leading-5",
                                                        statusBadgeClass(
                                                            task.lifecycle,
                                                        ),
                                                    )}
                                                >
                                                    {task.lifecycle}
                                                </Badge>
                                                <span class="truncate">
                                                    {task.agentAdapter}
                                                    {task.model
                                                        ? ` / ${task.model}`
                                                        : ""}
                                                </span>
                                            </span>
                                        </span>
                                    </span>
                                </button>

                                <EntityCommandbar
                                    {refreshNonce}
                                    entity={task}
                                    defaultVariant="outline"
                                    buttonClass="shadow-sm"
                                    showEmptyState={false}
                                    iconOnly={true}
                                    {onCommandExecuted}
                                />
                            </div>
                        </article>
                    {/each}
                </div>
            {:else}
                <div
                    class="rounded-xl border border-dashed bg-background/60 px-4 py-8 text-sm text-muted-foreground"
                >
                    This stage has no tasks.
                </div>
            {/if}
        </div>
    {:else}
        <div class="p-2">
            <div
                class="rounded-xl border border-dashed bg-background/60 px-4 py-8 text-sm text-muted-foreground"
            >
                Mission tasks will appear once the control view is available.
            </div>
        </div>
    {/if}
</section>
