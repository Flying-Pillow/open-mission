<script lang="ts">
    import type { EntityCommandDescriptorType } from "@flying-pillow/open-mission-core/entities/Entity/EntitySchema";
    import type { ButtonVariant } from "$lib/components/ui/button/index.js";
    import EntityCommandbar from "./EntityCommandbar.svelte";
    import type { CommandableEntity } from "./CommandableEntity";

    let {
        refreshNonce,
        entityName,
        commandInput,
        commands = [],
        executeCommand,
        onCommandExecuted,
        class: className,
        buttonClass = "",
        defaultVariant = "default",
        showEmptyState = false,
        loading = false,
        loadError,
    }: {
        refreshNonce: number;
        entityName: string;
        commandInput?: unknown;
        commands?: EntityCommandDescriptorType[];
        executeCommand: (
            commandId: string,
            input?: unknown,
        ) => Promise<unknown>;
        onCommandExecuted: (
            result: unknown,
            command: EntityCommandDescriptorType,
        ) => Promise<void>;
        class?: string;
        buttonClass?: string;
        defaultVariant?: ButtonVariant;
        showEmptyState?: boolean;
        loading?: boolean;
        loadError?: string;
    } = $props();

    const commandEntity = $derived<CommandableEntity>({
        entityName,
        entityId: entityName,
        commands,
        executeCommand: async (commandId, input) => {
            return await executeCommand(commandId, input ?? commandInput);
        },
    });
</script>

<div class="space-y-2">
    <EntityCommandbar
        {refreshNonce}
        entity={commandEntity}
        class={className}
        {buttonClass}
        {defaultVariant}
        showEmptyState={showEmptyState && !loading}
        {onCommandExecuted}
    />

    {#if loading}
        <p class="text-sm text-muted-foreground">Loading commands...</p>
    {/if}

    {#if loadError}
        <p class="text-sm text-rose-600">{loadError}</p>
    {/if}
</div>
