<script lang="ts">
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
    import type { EntityCommandDescriptor } from "@flying-pillow/mission-core/schemas";
    import type { ActionableEntity } from "./ActionableEntity";

    let {
        refreshNonce,
        entity,
        label,
        onActionExecuted,
        class: className,
        buttonClass = "",
        defaultVariant = "default",
        showEmptyState = true,
    }: {
        refreshNonce: number;
        entity?: ActionableEntity;
        label?: string;
        onActionExecuted: () => Promise<void>;
        class?: string;
        buttonClass?: string;
        defaultVariant?: "default" | "outline" | "secondary";
        showEmptyState?: boolean;
    } = $props();

    let commands = $state<EntityCommandDescriptor[]>([]);
    let actionLoading = $state(false);
    let actionPending = $state<string | null>(null);
    let actionError = $state<string | null>(null);
    let confirmationAction = $state<EntityCommandDescriptor | null>(null);
    let confirmationOpen = $state(false);
    let loadedEntityKey = $state<string | null>(null);
    let lastRefreshNonce = $state<number | null>(null);
    let confirmationResolver: ((confirmed: boolean) => void) | null = null;

    const entityKey = $derived(
        entity ? `${entity.entityName}:${entity.entityId}` : null,
    );
    const availableCommands = $derived(
        commands.filter((command) => !command.disabled),
    );

    $effect(() => {
        if (lastRefreshNonce !== refreshNonce) {
            loadedEntityKey = null;
            lastRefreshNonce = refreshNonce;
        }

        if (!entity || !entityKey) {
            commands = [];
            actionLoading = false;
            actionError = null;
            loadedEntityKey = null;
            return;
        }

        if (loadedEntityKey === entityKey) {
            return;
        }

        void loadCommands(entity, entityKey);
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
        action: EntityCommandDescriptor,
    ): "default" | "outline" | "secondary" | "destructive" {
        if (action.variant === "destructive") {
            return "destructive";
        }

        const commandId = action.commandId.toLowerCase();
        if (commandId.includes("panic") || commandId.includes("terminate")) {
            return "destructive";
        }

        return defaultVariant;
    }

    function getActionIcon(action: EntityCommandDescriptor): Icon {
        const commandId =
            `${action.iconHint ?? action.commandId}`.toLowerCase();

        if (commandId.includes("resume") || commandId.includes("start")) {
            return PlayerPlayIcon;
        }

        if (commandId.includes("pause")) {
            return PlayerPauseIcon;
        }

        if (commandId.includes("panic") || commandId.includes("terminate")) {
            return AlertTriangleIcon;
        }

        if (commandId.includes("restart") || commandId.includes("reopen")) {
            return RefreshIcon;
        }

        if (commandId.includes("deliver") || commandId.includes("launch")) {
            return RocketIcon;
        }

        if (commandId.includes("block") || commandId.includes("cancel")) {
            return HandStopIcon;
        }

        return CircleCheckIcon;
    }

    async function loadCommands(
        commandEntity: ActionableEntity,
        key: string,
    ): Promise<void> {
        actionLoading = true;
        actionError = null;
        try {
            commands = await commandEntity.listCommands({
                executionContext: "render",
            });
            loadedEntityKey = key;
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
        action: EntityCommandDescriptor,
    ): Promise<void> {
        if (!entity || actionPending || action.disabled) {
            return;
        }

        if (!(await requestActionConfirmation(action))) {
            return;
        }

        await submitAction(entity, action);
    }

    async function requestActionConfirmation(
        action: EntityCommandDescriptor,
    ): Promise<boolean> {
        if (!action.confirmation?.required) {
            return true;
        }

        if (confirmationResolver) {
            resolveActionConfirmation(false);
        }

        confirmationAction = action;
        confirmationOpen = true;
        return new Promise((resolve) => {
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

    async function submitAction(
        commandEntity: ActionableEntity,
        action: EntityCommandDescriptor,
    ): Promise<boolean> {
        actionPending = action.commandId;
        actionError = null;
        try {
            await commandEntity.executeCommand(action.commandId);
            loadedEntityKey = null;
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
                {confirmationAction?.confirmation?.prompt ??
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

        {#if actionLoading && availableCommands.length === 0 && showEmptyState}
            <Button variant="outline" size="sm" disabled
                >Loading actions...</Button
            >
        {:else if availableCommands.length === 0 && showEmptyState}
            <Button variant="outline" size="sm" disabled
                >No actions available</Button
            >
        {:else}
            {#each availableCommands as action (action.commandId)}
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
                        {actionPending === action.commandId
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
