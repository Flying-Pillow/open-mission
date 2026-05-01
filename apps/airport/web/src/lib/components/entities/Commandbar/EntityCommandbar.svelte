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
    import type { EntityCommandDescriptorType } from "@flying-pillow/mission-core/entities/Entity/EntitySchema";
    import type { CommandableEntity } from "./CommandableEntity";

    let {
        refreshNonce,
        entity,
        label,
        onCommandExecuted,
        class: className,
        buttonClass = "",
        defaultVariant = "default",
        showEmptyState = true,
    }: {
        refreshNonce: number;
        entity?: CommandableEntity;
        label?: string;
        onCommandExecuted: () => Promise<void>;
        class?: string;
        buttonClass?: string;
        defaultVariant?: "default" | "outline" | "secondary";
        showEmptyState?: boolean;
    } = $props();

    let commandPending = $state<string | null>(null);
    let commandError = $state<string | null>(null);
    let confirmationCommand = $state<EntityCommandDescriptorType | null>(null);
    let confirmationOpen = $state(false);
    let confirmationResolver: ((confirmed: boolean) => void) | null = null;

    const commands = $derived(entity?.commands ?? []);
    const availableCommands = $derived(
        commands.filter((command) => !command.disabled),
    );

    $effect(() => {
        refreshNonce;
        commandError = null;
    });

    $effect(() => {
        if (!confirmationOpen && confirmationResolver && confirmationCommand) {
            const resolveConfirmation = confirmationResolver;
            confirmationResolver = null;
            confirmationCommand = null;
            resolveConfirmation(false);
        }
    });

    function commandVariant(
        command: EntityCommandDescriptorType,
    ): "default" | "outline" | "secondary" | "destructive" {
        if (command.variant === "destructive") {
            return "destructive";
        }

        const commandId = command.commandId.toLowerCase();
        if (commandId.includes("panic") || commandId.includes("terminate")) {
            return "destructive";
        }

        return defaultVariant;
    }

    function getCommandIcon(command: EntityCommandDescriptorType): Icon {
        const commandId =
            `${command.iconHint ?? command.commandId}`.toLowerCase();

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

    async function executeCommand(
        command: EntityCommandDescriptorType,
    ): Promise<void> {
        if (!entity || commandPending || command.disabled) {
            return;
        }

        if (!(await requestCommandConfirmation(command))) {
            return;
        }

        await submitCommand(entity, command);
    }

    async function requestCommandConfirmation(
        command: EntityCommandDescriptorType,
    ): Promise<boolean> {
        if (!command.confirmation?.required) {
            return true;
        }

        if (confirmationResolver) {
            resolveCommandConfirmation(false);
        }

        confirmationCommand = command;
        confirmationOpen = true;
        return new Promise((resolve) => {
            confirmationResolver = resolve;
        });
    }

    function resolveCommandConfirmation(confirmed: boolean): void {
        const resolveConfirmation = confirmationResolver;
        confirmationResolver = null;
        confirmationCommand = null;
        confirmationOpen = false;
        resolveConfirmation?.(confirmed);
    }

    async function submitCommand(
        commandEntity: CommandableEntity,
        command: EntityCommandDescriptorType,
    ): Promise<boolean> {
        commandPending = command.commandId;
        commandError = null;
        try {
            await commandEntity.executeCommand(command.commandId);
            await onCommandExecuted();
            return true;
        } catch (executeError) {
            const message =
                executeError instanceof Error
                    ? executeError.message
                    : String(executeError);
            commandError = message;
            return false;
        } finally {
            commandPending = null;
        }
    }
</script>

<AlertDialog.Root bind:open={confirmationOpen}>
    <AlertDialog.Content>
        <AlertDialog.Header>
            <AlertDialog.Title>Confirm command</AlertDialog.Title>
            <AlertDialog.Description>
                {confirmationCommand?.confirmation?.prompt ??
                    (confirmationCommand
                        ? `Execute '${confirmationCommand.label}'?`
                        : "Confirm this command to continue.")}
            </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
            <AlertDialog.Cancel
                onclick={() => resolveCommandConfirmation(false)}
            >
                Cancel
            </AlertDialog.Cancel>
            <AlertDialog.Action
                variant={confirmationCommand
                    ? commandVariant(confirmationCommand)
                    : "default"}
                onclick={() => resolveCommandConfirmation(true)}
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

        {#if availableCommands.length === 0 && showEmptyState}
            <Button variant="outline" size="sm" disabled
                >No commands available</Button
            >
        {:else}
            {#each availableCommands as command (command.commandId)}
                {@const Icon = getCommandIcon(command)}
                <Button
                    variant={commandVariant(command)}
                    size="sm"
                    disabled={commandPending !== null || command.disabled}
                    class={buttonClass}
                    onclick={() => void executeCommand(command)}
                    title={command.disabledReason ||
                        command.description ||
                        command.label}
                >
                    <Icon class="size-4" data-icon="inline-start" />
                    <span>
                        {commandPending === command.commandId
                            ? `${command.label}...`
                            : command.label}
                    </span>
                </Button>
            {/each}
        {/if}
    </div>

    {#if commandError}
        <p class="text-sm text-rose-600">{commandError}</p>
    {/if}
</div>