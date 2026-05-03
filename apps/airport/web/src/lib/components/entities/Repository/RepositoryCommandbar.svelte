<script lang="ts">
    import EntityCommandbar from "$lib/components/entities/Commandbar/EntityCommandbar.svelte";
    import type { Repository } from "$lib/components/entities/Repository/Repository.svelte.js";
    import type { EntityCommandDescriptorType } from "@flying-pillow/mission-core/entities/Entity/EntitySchema";

    let {
        repository,
        onCommandExecuted,
        class: className,
        showEmptyState = false,
    }: {
        repository?: Repository;
        onCommandExecuted: () => Promise<void>;
        class?: string;
        showEmptyState?: boolean;
    } = $props();

    let refreshNonce = $state(0);

    async function handleCommandExecuted(
        result: unknown,
        command: EntityCommandDescriptorType,
    ): Promise<void> {
        if (
            repository &&
            typeof result === "object" &&
            result !== null &&
            "syncStatus" in result
        ) {
            repository.applySyncStatus(
                (result as { syncStatus: unknown }).syncStatus,
            );
        }

        if (command.commandId === "repository.remove") {
            refreshNonce += 1;
            return;
        }

        if (repository) {
            await repository.refresh();
            await repository.refreshSyncStatus().catch(() => undefined);
            await repository.refreshCommands();
        }
        refreshNonce += 1;
        await onCommandExecuted();
    }
</script>

<div class="space-y-2">
    <EntityCommandbar
        {refreshNonce}
        entity={repository}
        class={className}
        defaultVariant="outline"
        presentation="responsive"
        menuLabel="Repository commands"
        {showEmptyState}
        onCommandExecuted={handleCommandExecuted}
    />
</div>
