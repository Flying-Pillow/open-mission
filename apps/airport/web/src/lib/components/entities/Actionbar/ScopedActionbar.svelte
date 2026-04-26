<script lang="ts">
    import { getScopedMissionContext } from "$lib/client/context/scoped-mission-context.svelte.js";
    import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import { Input } from "$lib/components/ui/input/index.js";
    import { Label } from "$lib/components/ui/label/index.js";
    import { cn } from "$lib/utils.js";
    import AlertTriangleIcon from "@tabler/icons-svelte/icons/alert-triangle";
    import CircleCheckIcon from "@tabler/icons-svelte/icons/circle-check";
    import HandStopIcon from "@tabler/icons-svelte/icons/hand-stop";
    import PlayerPauseIcon from "@tabler/icons-svelte/icons/player-pause";
    import PlayerPlayIcon from "@tabler/icons-svelte/icons/player-play";
    import RefreshIcon from "@tabler/icons-svelte/icons/refresh";
    import RocketIcon from "@tabler/icons-svelte/icons/rocket";
    import type { Icon } from "@tabler/icons-svelte";
    import { orderAvailableActions } from "@flying-pillow/mission-core/browser";
    import type {
        MissionStageIdData as MissionStageId,
        OperatorActionDescriptorData as OperatorActionDescriptor,
        OperatorActionExecutionStepData as OperatorActionExecutionStep,
        OperatorActionFlowStepData as OperatorActionFlowStep,
        OperatorActionListSnapshotData as OperatorActionListSnapshot,
        OperatorActionQueryContextData as OperatorActionQueryContext,
        OperatorActionTargetContextData as OperatorActionTargetContext,
    } from "../types";

    type ActionTransportContext = OperatorActionQueryContext & {
        repositoryRootPath: string;
    };

    let {
        refreshNonce,
        scope,
        stageId,
        taskId,
        artifactPath,
        sessionId,
        label,
        onActionExecuted,
        class: className,
        buttonClass = "",
        defaultVariant = "default",
        showEmptyState = true,
    }: {
        refreshNonce: number;
        scope: "mission" | "task" | "artifact" | "session";
        stageId?: MissionStageId;
        taskId?: string;
        artifactPath?: string;
        sessionId?: string;
        label?: string;
        onActionExecuted: () => Promise<void>;
        class?: string;
        buttonClass?: string;
        defaultVariant?: "default" | "outline" | "secondary";
        showEmptyState?: boolean;
    } = $props();

    let actionSnapshot = $state<OperatorActionListSnapshot | null>(null);
    let actionLoading = $state(false);
    let actionPending = $state<string | null>(null);
    let actionError = $state<string | null>(null);
    let flowAction = $state<OperatorActionDescriptor | null>(null);
    let flowOpen = $state(false);
    let flowError = $state<string | null>(null);
    let flowSelections = $state<Record<string, string[]>>({});
    let flowTexts = $state<Record<string, string>>({});
    let confirmationAction = $state<OperatorActionDescriptor | null>(null);
    let confirmationOpen = $state(false);
    let loadedContextKey = $state<string | null>(null);
    let lastRefreshNonce = $state<number | null>(null);
    let confirmationResolver: ((confirmed: boolean) => void) | null = null;
    const missionScope = getScopedMissionContext();
    const mission = $derived.by(() => {
        const activeMission = missionScope.mission;
        if (!activeMission) {
            throw new Error("Mission actions require a scoped mission context.");
        }

        return activeMission;
    });
    const activeRepository = $derived.by(() => {
        const repository = missionScope.repository;
        if (!repository) {
            throw new Error("Mission actions require a scoped repository context.");
        }

        return repository;
    });
    const missionId = $derived(mission.missionId);
    const repositoryId = $derived(activeRepository.repositoryId);
    const repositoryRootPath = $derived(
        mission.missionWorktreePath || activeRepository.repositoryRootPath,
    );

    const actionContext = $derived.by(
        () =>
            ({
                repositoryId,
                repositoryRootPath,
                ...(stageId ? { stageId } : {}),
                ...(taskId ? { taskId } : {}),
                ...(artifactPath ? { artifactPath } : {}),
                ...(sessionId ? { sessionId } : {}),
            }) satisfies ActionTransportContext,
    );
    const actionTargetContext = $derived.by(
        () =>
            ({
                repositoryId,
                ...(stageId ? { stageId } : {}),
                ...(taskId ? { taskId } : {}),
                ...(artifactPath ? { artifactPath } : {}),
                ...(sessionId ? { sessionId } : {}),
            }) satisfies OperatorActionTargetContext,
    );
    const actionContextKey = $derived(JSON.stringify(actionContext));
    const availableActions = $derived.by(() => {
        const snapshotActions = actionSnapshot?.actions ?? [];
        const orderedActions = orderAvailableActions(
            snapshotActions,
            actionTargetContext,
        );

        return orderedActions.filter(
            (action) =>
                action.scope === scope && action.enabled && !action.disabled,
        );
    });

    $effect(() => {
        if (lastRefreshNonce !== refreshNonce) {
            loadedContextKey = null;
            lastRefreshNonce = refreshNonce;
        }

        if (!missionId) {
            actionSnapshot = null;
            actionLoading = false;
            actionError = null;
            loadedContextKey = null;
            return;
        }

        if (scope === "task" && !taskId) {
            actionSnapshot = null;
            actionLoading = false;
            actionError = null;
            loadedContextKey = null;
            return;
        }

        if (scope === "artifact" && !artifactPath) {
            actionSnapshot = null;
            actionLoading = false;
            actionError = null;
            loadedContextKey = null;
            return;
        }

        if (scope === "session" && !sessionId) {
            actionSnapshot = null;
            actionLoading = false;
            actionError = null;
            loadedContextKey = null;
            return;
        }

        if (loadedContextKey === actionContextKey) {
            return;
        }

        void loadActions(actionContextKey, actionContext);
    });

    $effect(() => {
        if (!confirmationOpen && confirmationResolver && confirmationAction) {
            const resolveConfirmation = confirmationResolver;
            confirmationResolver = null;
            confirmationAction = null;
            resolveConfirmation(false);
        }
    });

    function actionVariant(
        action: OperatorActionDescriptor,
    ): "default" | "outline" | "secondary" | "destructive" {
        if (action.id.includes("panic") || action.id.includes("terminate")) {
            return "destructive";
        }

        return defaultVariant;
    }

    function getActionIcon(action: OperatorActionDescriptor): Icon {
        const actionId = action.id.toLowerCase();

        if (actionId.includes("resume") || actionId.includes("start")) {
            return PlayerPlayIcon;
        }

        if (actionId.includes("pause")) {
            return PlayerPauseIcon;
        }

        if (actionId.includes("panic") || actionId.includes("terminate")) {
            return AlertTriangleIcon;
        }

        if (actionId.includes("restart") || actionId.includes("reopen")) {
            return RefreshIcon;
        }

        if (actionId.includes("deliver") || actionId.includes("launch")) {
            return RocketIcon;
        }

        if (actionId.includes("block") || actionId.includes("cancel")) {
            return HandStopIcon;
        }

        return CircleCheckIcon;
    }

    async function loadActions(
        contextKey: string,
        context: ActionTransportContext,
    ): Promise<void> {
        actionLoading = true;
        actionError = null;
        try {
            if (!mission) {
                throw new Error("Mission actions are unavailable until the app context is synchronized.");
            }

            actionSnapshot = await mission.listAvailableActions({
                repositoryId: context.repositoryId,
                ...(context.stageId ? { stageId: context.stageId } : {}),
                ...(context.taskId ? { taskId: context.taskId } : {}),
                ...(context.artifactPath ? { artifactPath: context.artifactPath } : {}),
                ...(context.sessionId ? { sessionId: context.sessionId } : {}),
            });
            loadedContextKey = contextKey;
        } catch (loadError) {
            actionError =
                loadError instanceof Error
                    ? loadError.message
                    : String(loadError);
        } finally {
            actionLoading = false;
        }
    }

    async function executeAction(
        action: OperatorActionDescriptor,
    ): Promise<void> {
        if (actionPending || action.disabled || !action.enabled) {
            return;
        }

        if ((action.flow?.steps.length ?? 0) > 0) {
            openActionFlow(action);
            return;
        }

        if (!(await requestActionConfirmation(action))) {
            return;
        }

        await submitAction(action, []);
    }

    async function requestActionConfirmation(
        action: OperatorActionDescriptor,
    ): Promise<boolean> {
        if (!action.ui?.requiresConfirmation) {
            return true;
        }

        if (confirmationResolver) {
            resolveActionConfirmation(false);
        }

        confirmationAction = action;
        confirmationOpen = true;

        return await new Promise<boolean>((resolve) => {
            confirmationResolver = resolve;
        });
    }

    function resolveActionConfirmation(confirmed: boolean): void {
        const resolveConfirmation = confirmationResolver;
        confirmationResolver = null;
        confirmationAction = null;
        confirmationOpen = false;
        resolveConfirmation?.(confirmed);
    }

    function openActionFlow(action: OperatorActionDescriptor): void {
        const nextSelections: Record<string, string[]> = {};
        const nextTexts: Record<string, string> = {};

        for (const step of action.flow?.steps ?? []) {
            if (step.kind === "selection") {
                nextSelections[step.id] = [];
            } else {
                nextTexts[step.id] = step.initialValue ?? "";
            }
        }

        flowAction = action;
        flowSelections = nextSelections;
        flowTexts = nextTexts;
        flowError = null;
        flowOpen = true;
    }

    function closeActionFlow(): void {
        flowOpen = false;
        flowAction = null;
        flowSelections = {};
        flowTexts = {};
        flowError = null;
    }

    function isSelected(stepId: string, optionId: string): boolean {
        return (flowSelections[stepId] ?? []).includes(optionId);
    }

    function toggleSelection(
        step: Extract<OperatorActionFlowStep, { kind: "selection" }>,
        optionId: string,
    ): void {
        const currentSelection = flowSelections[step.id] ?? [];
        if (step.selectionMode === "single") {
            flowSelections = {
                ...flowSelections,
                [step.id]: [optionId],
            };
            return;
        }

        flowSelections = {
            ...flowSelections,
            [step.id]: currentSelection.includes(optionId)
                ? currentSelection.filter(
                      (currentOptionId) => currentOptionId !== optionId,
                  )
                : [...currentSelection, optionId],
        };
    }

    function buildFlowExecutionSteps(
        action: OperatorActionDescriptor,
    ): OperatorActionExecutionStep[] {
        const steps: OperatorActionExecutionStep[] = [];

        for (const step of action.flow?.steps ?? []) {
            if (step.kind === "selection") {
                steps.push({
                    kind: "selection",
                    stepId: step.id,
                    optionIds: flowSelections[step.id] ?? [],
                });
            } else {
                steps.push({
                    kind: "text",
                    stepId: step.id,
                    value: flowTexts[step.id] ?? "",
                });
            }
        }

        return steps;
    }

    function validateFlow(action: OperatorActionDescriptor): string | null {
        for (const step of action.flow?.steps ?? []) {
            if (step.kind === "selection") {
                if ((flowSelections[step.id] ?? []).length === 0) {
                    return `${step.label}: choose at least one option.`;
                }
            } else if ((flowTexts[step.id] ?? "").trim().length === 0) {
                return `${step.label}: enter a value.`;
            }
        }

        return null;
    }

    async function submitFlowAction(): Promise<void> {
        if (!flowAction) {
            return;
        }

        const validationError = validateFlow(flowAction);
        if (validationError) {
            flowError = validationError;
            return;
        }

        flowError = null;
        const succeeded = await submitAction(
            flowAction,
            buildFlowExecutionSteps(flowAction),
        );
        if (succeeded) {
            closeActionFlow();
        }
    }

    async function submitAction(
        action: OperatorActionDescriptor,
        steps: OperatorActionExecutionStep[],
    ): Promise<boolean> {
        actionPending = action.id;
        actionError = null;
        try {
            if (!mission) {
                throw new Error("Mission actions are unavailable until the app context is synchronized.");
            }

            await mission.executeAction({
                actionId: action.id,
                ...(steps.length > 0 ? { steps } : {}),
            });

            loadedContextKey = null;
            await onActionExecuted();
            return true;
        } catch (executeError) {
            const message =
                executeError instanceof Error
                    ? executeError.message
                    : String(executeError);
            actionError = message;
            flowError = message;
            return false;
        } finally {
            actionPending = null;
        }
    }
</script>

<AlertDialog.Root bind:open={confirmationOpen}>
    <AlertDialog.Content>
        <AlertDialog.Header>
            <AlertDialog.Title>Confirm action</AlertDialog.Title>
            <AlertDialog.Description>
                {confirmationAction?.ui?.confirmationPrompt ??
                    (confirmationAction
                        ? `Execute '${confirmationAction.label}'?`
                        : "Confirm this action to continue.")}
            </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
            <AlertDialog.Cancel
                onclick={() => resolveActionConfirmation(false)}
            >
                Cancel
            </AlertDialog.Cancel>
            <AlertDialog.Action
                variant={confirmationAction
                    ? actionVariant(confirmationAction)
                    : "default"}
                onclick={() => resolveActionConfirmation(true)}
            >
                Continue
            </AlertDialog.Action>
        </AlertDialog.Footer>
    </AlertDialog.Content>
</AlertDialog.Root>

<div class={cn("space-y-2", className)}>
    <div class="flex min-h-9 flex-wrap items-center gap-2">
        {#if label}
            <Button variant="secondary" size="sm" disabled>{label}</Button>
        {/if}

        {#if actionLoading && availableActions.length === 0 && showEmptyState}
            <Button variant="outline" size="sm" disabled
                >Loading actions...</Button
            >
        {:else if availableActions.length === 0 && showEmptyState}
            <Button variant="outline" size="sm" disabled
                >No actions available</Button
            >
        {:else}
            {#each availableActions as action (action.id)}
                {@const Icon = getActionIcon(action)}
                <Button
                    variant={actionVariant(action)}
                    size="sm"
                    disabled={actionPending !== null}
                    class={buttonClass}
                    onclick={() => void executeAction(action)}
                    title={action.disabledReason ||
                        action.reason ||
                        action.label}
                >
                    <Icon class="size-4" data-icon="inline-start" />
                    <span>
                        {actionPending === action.id
                            ? `${action.ui?.toolbarLabel ?? action.label}...`
                            : (action.ui?.toolbarLabel ?? action.label)}
                    </span>
                </Button>
            {/each}
        {/if}
    </div>

    {#if actionError}
        <p class="text-sm text-rose-600">{actionError}</p>
    {/if}
</div>

<Dialog.Root bind:open={flowOpen}>
    <Dialog.Content
        class="w-full max-w-3xl p-0 sm:max-w-3xl"
        onInteractOutside={() => actionPending === null && closeActionFlow()}
    >
        {#if flowAction}
            <div class="flex h-full flex-col">
                <Dialog.Header class="border-b px-6 py-5 text-left">
                    <Dialog.Title>
                        {flowAction.flow?.actionLabel ?? flowAction.label}
                    </Dialog.Title>
                    <Dialog.Description>
                        {flowAction.flow?.targetLabel
                            ? `Complete the daemon action flow for ${flowAction.flow.targetLabel.toLowerCase()}.`
                            : "Complete the action flow."}
                    </Dialog.Description>
                </Dialog.Header>

                <div class="flex-1 space-y-6 overflow-y-auto px-6 py-5">
                    {#each flowAction.flow?.steps ?? [] as step (step.id)}
                        <section class="space-y-3">
                            <div class="space-y-1">
                                <h3
                                    class="text-sm font-semibold tracking-wide text-foreground"
                                >
                                    {step.title}
                                </h3>
                                <p class="text-sm text-muted-foreground">
                                    {step.helperText}
                                </p>
                            </div>

                            {#if step.kind === "selection"}
                                <div class="space-y-2">
                                    {#if step.options.length === 0}
                                        <p
                                            class="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground"
                                        >
                                            {step.emptyLabel}
                                        </p>
                                    {:else}
                                        {#each step.options as option (option.id)}
                                            <button
                                                type="button"
                                                class={cn(
                                                    "w-full rounded-3xl border px-4 py-3 text-left transition-colors",
                                                    isSelected(
                                                        step.id,
                                                        option.id,
                                                    )
                                                        ? "border-primary bg-primary/8"
                                                        : "border-border bg-background hover:bg-muted/40",
                                                )}
                                                onclick={() =>
                                                    toggleSelection(
                                                        step,
                                                        option.id,
                                                    )}
                                            >
                                                <div
                                                    class="flex items-start justify-between gap-3"
                                                >
                                                    <div class="space-y-1">
                                                        <div
                                                            class="text-sm font-medium text-foreground"
                                                        >
                                                            {option.label}
                                                        </div>
                                                        <div
                                                            class="text-sm text-muted-foreground"
                                                        >
                                                            {option.description}
                                                        </div>
                                                    </div>
                                                    <div
                                                        class="pt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                                                    >
                                                        {step.selectionMode ===
                                                        "multiple"
                                                            ? isSelected(
                                                                  step.id,
                                                                  option.id,
                                                              )
                                                                ? "Selected"
                                                                : "Select"
                                                            : isSelected(
                                                                    step.id,
                                                                    option.id,
                                                                )
                                                              ? "Chosen"
                                                              : "Choose"}
                                                    </div>
                                                </div>
                                            </button>
                                        {/each}
                                    {/if}
                                </div>
                            {:else}
                                <div class="space-y-2">
                                    <Label for={`flow-${step.id}`}
                                        >{step.label}</Label
                                    >
                                    {#if step.inputMode === "compact"}
                                        <Input
                                            id={`flow-${step.id}`}
                                            class="h-11 rounded-2xl"
                                            placeholder={step.placeholder}
                                            value={flowTexts[step.id] ?? ""}
                                            oninput={(event) => {
                                                flowTexts = {
                                                    ...flowTexts,
                                                    [step.id]:
                                                        event.currentTarget
                                                            .value,
                                                };
                                            }}
                                        />
                                    {:else}
                                        <textarea
                                            id={`flow-${step.id}`}
                                            class="bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-32 w-full rounded-3xl border px-4 py-3 text-sm outline-none focus-visible:ring-[3px]"
                                            placeholder={step.placeholder}
                                            value={flowTexts[step.id] ?? ""}
                                            oninput={(event) => {
                                                flowTexts = {
                                                    ...flowTexts,
                                                    [step.id]:
                                                        event.currentTarget
                                                            .value,
                                                };
                                            }}
                                        ></textarea>
                                    {/if}
                                </div>
                            {/if}
                        </section>
                    {/each}

                    {#if flowError}
                        <p class="text-sm text-rose-600">{flowError}</p>
                    {/if}
                </div>

                <Dialog.Footer class="border-t px-6 py-4 sm:justify-between">
                    <Button
                        variant="outline"
                        onclick={closeActionFlow}
                        disabled={actionPending !== null}
                    >
                        Cancel
                    </Button>
                    <Button
                        onclick={() => void submitFlowAction()}
                        disabled={actionPending !== null}
                    >
                        {actionPending === flowAction.id
                            ? `${flowAction.flow?.actionLabel ?? flowAction.label}...`
                            : (flowAction.flow?.actionLabel ??
                              flowAction.label)}
                    </Button>
                </Dialog.Footer>
            </div>
        {/if}
    </Dialog.Content>
</Dialog.Root>
