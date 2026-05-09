<script lang="ts">
    import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
    import {
        Button,
        type ButtonVariant,
    } from "$lib/components/ui/button/index.js";
    import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
    import * as Tooltip from "$lib/components/ui/tooltip/index.js";
    import { cn } from "$lib/utils.js";
    import Icon from "@iconify/svelte";
    import type { EntityCommandDescriptorType } from "@flying-pillow/mission-core/entities/Entity/EntitySchema";
    import type { CommandableEntity } from "./CommandableEntity";

    let {
        refreshNonce,
        entity,
        label,
        onCommandExecuted,
        resolveCommandInput,
        class: className,
        buttonClass = "",
        defaultVariant = "default",
        showEmptyState = true,
        presentation = "buttons",
        menuLabel = "Commands",
        iconOnly = false,
    }: {
        refreshNonce: number;
        entity?: CommandableEntity;
        label?: string;
        onCommandExecuted: (
            result: unknown,
            command: EntityCommandDescriptorType,
        ) => Promise<void>;
        resolveCommandInput?: (command: EntityCommandDescriptorType) => unknown;
        class?: string;
        buttonClass?: string;
        defaultVariant?: ButtonVariant;
        showEmptyState?: boolean;
        presentation?: "buttons" | "menu" | "responsive";
        menuLabel?: string;
        iconOnly?: boolean;
    } = $props();

    let commandPending = $state<string | null>(null);
    let commandError = $state<string | null>(null);
    let confirmationCommand = $state<EntityCommandDescriptorType | null>(null);
    let confirmationOpen = $state(false);
    let commandMenuOpen = $state(false);
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
    ): ButtonVariant {
        return command.variant ?? defaultVariant;
    }

    function getCommandIcon(command: EntityCommandDescriptorType): string {
        const explicitIcon = command.icon?.trim();
        if (explicitIcon) {
            return explicitIcon.includes(":")
                ? explicitIcon
                : `lucide:${explicitIcon}`;
        }

        const commandId = command.commandId.toLowerCase();

        if (commandId.includes("resume") || commandId.includes("start")) {
            return "lucide:play";
        }

        if (commandId.includes("pause")) {
            return "lucide:pause";
        }

        if (commandId.includes("terminate")) {
            return "lucide:triangle-alert";
        }

        if (commandId.includes("restart") || commandId.includes("reopen")) {
            return "lucide:refresh-cw";
        }

        if (commandId.includes("deliver") || commandId.includes("launch")) {
            return "lucide:rocket";
        }

        if (commandId.includes("block") || commandId.includes("cancel")) {
            return "lucide:hand";
        }

        return "lucide:circle-check";
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

        commandMenuOpen = false;
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
            const result = await commandEntity.executeCommand(
                command.commandId,
                resolveCommandInput?.(command),
            );
            await onCommandExecuted(result, command);
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
    {#if presentation === "menu" || presentation === "responsive"}
        <div class={presentation === "responsive" ? "md:hidden" : undefined}>
            <DropdownMenu.Root bind:open={commandMenuOpen}>
                <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                        <Button
                            variant={defaultVariant}
                            size={presentation === "responsive"
                                ? "icon-sm"
                                : "sm"}
                            disabled={availableCommands.length === 0 ||
                                commandPending !== null}
                            class={buttonClass}
                            aria-label={menuLabel}
                            title={availableCommands.length === 0
                                ? "No commands available"
                                : menuLabel}
                            {...props}
                        >
                            <Icon
                                icon="lucide:more-horizontal"
                                class="size-4"
                                data-icon="inline-start"
                            />
                            {#if presentation === "menu"}
                                <span>{menuLabel}</span>
                            {/if}
                        </Button>
                    {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content
                    align="end"
                    sideOffset={6}
                    class="min-w-64 rounded-lg"
                >
                    <DropdownMenu.Label class="font-medium text-foreground">
                        {label ?? menuLabel}
                    </DropdownMenu.Label>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Group>
                        {#each availableCommands as command (command.commandId)}
                            <DropdownMenu.Item
                                variant={commandVariant(command) ===
                                "destructive"
                                    ? "destructive"
                                    : "default"}
                                disabled={commandPending !== null ||
                                    command.disabled}
                                onclick={() => void executeCommand(command)}
                                title={command.disabledReason ||
                                    command.description ||
                                    command.label}
                            >
                                <Icon
                                    icon={getCommandIcon(command)}
                                    class="size-4"
                                />
                                <span class="min-w-0 flex-1 truncate">
                                    {commandPending === command.commandId
                                        ? `${command.label}...`
                                        : command.label}
                                </span>
                            </DropdownMenu.Item>
                        {/each}
                    </DropdownMenu.Group>
                </DropdownMenu.Content>
            </DropdownMenu.Root>
        </div>
        {#if availableCommands.length === 0 && showEmptyState}
            <Button variant="outline" size="sm" disabled
                >No commands available</Button
            >
        {/if}
    {/if}

    {#if presentation === "buttons" || presentation === "responsive"}
        <div
            class={presentation === "responsive"
                ? "hidden min-h-8 flex-wrap items-center gap-2 md:flex"
                : "flex min-h-9 flex-wrap items-center gap-2"}
        >
            {#if label}
                <Button variant="secondary" size="sm" disabled>{label}</Button>
            {/if}

            {#if availableCommands.length === 0 && showEmptyState}
                <Button variant="outline" size="sm" disabled
                    >No commands available</Button
                >
            {:else}
                {#each availableCommands as command (command.commandId)}
                    {#if iconOnly}
                        <Tooltip.Root>
                            <Tooltip.Trigger>
                                {#snippet child({ props })}
                                    <Button
                                        variant={commandVariant(command)}
                                        size="icon-sm"
                                        disabled={commandPending !== null ||
                                            command.disabled}
                                        class={buttonClass}
                                        onclick={() =>
                                            void executeCommand(command)}
                                        aria-label={command.label}
                                        title={command.disabledReason ||
                                            command.description ||
                                            command.label}
                                        {...props}
                                    >
                                        <Icon
                                            icon={getCommandIcon(command)}
                                            class="size-4"
                                            data-icon="inline-start"
                                        />
                                    </Button>
                                {/snippet}
                            </Tooltip.Trigger>
                            <Tooltip.Content>
                                {commandPending === command.commandId
                                    ? `${command.label}...`
                                    : command.disabledReason ||
                                      command.description ||
                                      command.label}
                            </Tooltip.Content>
                        </Tooltip.Root>
                    {:else}
                        <Button
                            variant={commandVariant(command)}
                            size="sm"
                            disabled={commandPending !== null ||
                                command.disabled}
                            class={buttonClass}
                            onclick={() => void executeCommand(command)}
                            aria-label={command.label}
                            title={command.disabledReason ||
                                command.description ||
                                command.label}
                        >
                            <Icon
                                icon={getCommandIcon(command)}
                                class="size-4"
                                data-icon="inline-start"
                            />
                            <span>
                                {commandPending === command.commandId
                                    ? `${command.label}...`
                                    : command.label}
                            </span>
                        </Button>
                    {/if}
                {/each}
            {/if}
        </div>
    {/if}

    {#if commandError}
        <p class="text-sm text-rose-600">{commandError}</p>
    {/if}
</div>
