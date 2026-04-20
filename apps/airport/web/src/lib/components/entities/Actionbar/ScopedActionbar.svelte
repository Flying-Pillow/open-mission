<script lang="ts">
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
    import { orderAvailableActions } from "@flying-pillow/mission-core/browser";
    import type {
        MissionStageId,
        OperatorActionDescriptor,
        OperatorActionListSnapshot,
        OperatorActionQueryContext,
        OperatorActionTargetContext,
    } from "@flying-pillow/mission-core/types.js";

    let {
        missionId,
        repositoryId,
        refreshNonce,
        scope,
        stageId,
        taskId,
        sessionId,
        label,
        onActionExecuted,
        class: className,
        buttonClass = "",
        defaultVariant = "default",
        showEmptyState = true,
    }: {
        missionId: string;
        repositoryId: string;
        refreshNonce: number;
        scope: "mission" | "task" | "session";
        stageId?: MissionStageId;
        taskId?: string;
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
    let loadedContextKey = $state<string | null>(null);
    let lastRefreshNonce = $state<number | null>(null);

    const actionContext = $derived.by(
        () =>
            ({
                repositoryId,
                ...(stageId ? { stageId } : {}),
                ...(taskId ? { taskId } : {}),
                ...(sessionId ? { sessionId } : {}),
            }) satisfies OperatorActionQueryContext,
    );
    const actionContextKey = $derived(JSON.stringify(actionContext));
    const availableActions = $derived.by(() => {
        const snapshotActions = actionSnapshot?.actions ?? [];
        const orderedActions = orderAvailableActions(
            snapshotActions,
            actionContext as OperatorActionTargetContext,
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
        context: OperatorActionQueryContext,
    ): Promise<void> {
        actionLoading = true;
        actionError = null;
        try {
            const query = new URLSearchParams();
            if (context.repositoryId) {
                query.set("repositoryId", context.repositoryId);
            }
            if (context.stageId) {
                query.set("stageId", context.stageId);
            }
            if (context.taskId) {
                query.set("taskId", context.taskId);
            }
            if (context.sessionId) {
                query.set("sessionId", context.sessionId);
            }

            const response = await fetch(
                `/api/runtime/missions/${encodeURIComponent(missionId)}/actions?${query.toString()}`,
            );
            if (!response.ok) {
                throw new Error(
                    `Action list load failed (${response.status}).`,
                );
            }

            actionSnapshot =
                (await response.json()) as OperatorActionListSnapshot;
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

        actionPending = action.id;
        actionError = null;
        try {
            const response = await fetch(
                `/api/runtime/missions/${encodeURIComponent(missionId)}/actions`,
                {
                    method: "POST",
                    headers: {
                        accept: "application/json",
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({
                        actionId: action.id,
                        steps: [],
                    }),
                },
            );
            if (!response.ok) {
                throw new Error(
                    `Action '${action.label}' failed (${response.status}).`,
                );
            }

            loadedContextKey = null;
            await onActionExecuted();
        } catch (executeError) {
            actionError =
                executeError instanceof Error
                    ? executeError.message
                    : String(executeError);
        } finally {
            actionPending = null;
        }
    }
</script>

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
                    onclick={() => executeAction(action)}
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
