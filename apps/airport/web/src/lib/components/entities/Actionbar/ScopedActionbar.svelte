<script lang="ts">
    import { getScopedMissionContext } from "$lib/client/context/scoped-mission-context.svelte.js";
    import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { cn } from "$lib/utils.js";
    import AlertTriangleIcon from "@tabler/icons-svelte/icons/alert-triangle";
    import CircleCheckIcon from "@tabler/icons-svelte/icons/circle-check";
    import HandStopIcon from "@tabler/icons-svelte/icons/hand-stop";
    import PlayerPauseIcon from "@tabler/icons-svelte/icons/player-pause";
    import PlayerPlayIcon from "@tabler/icons-svelte/icons/player-play";
    import RefreshIcon from "@tabler/icons-svelte/icons/refresh";
    import RocketIcon from "@tabler/icons-svelte/icons/rocket";
    import type { Icon } from "@tabler/icons-svelte";
    import type {
        MissionActionDescriptor,
        MissionActionListSnapshot,
        MissionActionQueryContext,
        OperatorActionExecutionStep,
    } from "@flying-pillow/mission-core/schemas";

    type ActionTransportContext = MissionActionQueryContext & {
        repositoryRootPath: string;
        artifactPath?: string;
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
        stageId?: string;
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

    let actionSnapshot = $state<MissionActionListSnapshot | null>(null);
    let actionLoading = $state(false);
    let actionPending = $state<string | null>(null);
    let actionError = $state<string | null>(null);
    let confirmationAction = $state<MissionActionDescriptor | null>(null);
    let confirmationOpen = $state(false);
    let loadedContextKey = $state<string | null>(null);
    let lastRefreshNonce = $state<number | null>(null);
    let confirmationResolver: ((confirmed: boolean) => void) | null = null;
    const missionScope = getScopedMissionContext();
    const mission = $derived.by(() => {
        const activeMission = missionScope.mission;
        if (!activeMission) {
            throw new Error(
                "Mission actions require a scoped mission context.",
            );
        }

        return activeMission;
    });
    const activeRepository = $derived.by(() => {
        const repository = missionScope.repository;
        if (!repository) {
            throw new Error(
                "Mission actions require a scoped repository context.",
            );
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
    const actionContextKey = $derived(JSON.stringify(actionContext));
    const availableActions = $derived.by(() => {
        const snapshotActions = actionSnapshot?.actions ?? [];
        return snapshotActions.filter((action) => !action.disabled);
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
        action: MissionActionDescriptor,
    ): "default" | "outline" | "secondary" | "destructive" {
        if (
            action.actionId.includes("panic") ||
            action.actionId.includes("terminate")
        ) {
            return "destructive";
        }

        return defaultVariant;
    }

    function getActionIcon(action: MissionActionDescriptor): Icon {
        const actionId = action.actionId.toLowerCase();

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
                throw new Error(
                    "Mission actions are unavailable until the app context is synchronized.",
                );
            }

            actionSnapshot = await mission.listAvailableActions(
                {
                    repositoryId: context.repositoryId,
                    ...(context.stageId ? { stageId: context.stageId } : {}),
                    ...(context.taskId ? { taskId: context.taskId } : {}),
                    ...(context.artifactPath
                        ? { artifactPath: context.artifactPath }
                        : {}),
                    ...(context.sessionId
                        ? { sessionId: context.sessionId }
                        : {}),
                },
                { executionContext: "render" },
            );
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
        action: MissionActionDescriptor,
    ): Promise<void> {
        if (actionPending || action.disabled) {
            return;
        }

        if (!(await requestActionConfirmation(action))) {
            return;
        }

        await submitAction(action, []);
    }

    async function requestActionConfirmation(
        action: MissionActionDescriptor,
    ): Promise<boolean> {
        if (confirmationResolver) {
            resolveActionConfirmation(false);
        }
        return true;
    }

    function resolveActionConfirmation(confirmed: boolean): void {
        const resolveConfirmation = confirmationResolver;
        confirmationResolver = null;
        confirmationAction = null;
        confirmationOpen = false;
        resolveConfirmation?.(confirmed);
    }

    async function submitAction(
        action: MissionActionDescriptor,
        steps: OperatorActionExecutionStep[],
    ): Promise<boolean> {
        actionPending = action.actionId;
        actionError = null;
        try {
            if (!mission) {
                throw new Error(
                    "Mission actions are unavailable until the app context is synchronized.",
                );
            }

            await mission.executeAction({
                actionId: action.actionId,
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
                {confirmationAction
                    ? `Execute '${confirmationAction.label}'?`
                    : "Confirm this action to continue."}
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
            {#each availableActions as action (action.actionId)}
                {@const Icon = getActionIcon(action)}
                <Button
                    variant={actionVariant(action)}
                    size="sm"
                    disabled={actionPending !== null || action.disabled}
                    class={buttonClass}
                    onclick={() => void executeAction(action)}
                    title={action.disabledReason ||
                        action.description ||
                        action.label}
                >
                    <Icon class="size-4" data-icon="inline-start" />
                    <span>
                        {actionPending === action.actionId
                            ? `${action.label}...`
                            : action.label}
                    </span>
                </Button>
            {/each}
        {/if}
    </div>

    {#if actionError}
        <p class="text-sm text-rose-600">{actionError}</p>
    {/if}
</div>
