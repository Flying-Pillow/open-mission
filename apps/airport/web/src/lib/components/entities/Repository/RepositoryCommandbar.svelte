<script lang="ts">
    import { goto } from "$app/navigation";
    import EntityCommandbar from "$lib/components/entities/Commandbar/EntityCommandbar.svelte";
    import type { Repository } from "$lib/components/entities/Repository/Repository.svelte.js";
    import type { EntityCommandDescriptorType } from "@flying-pillow/mission-core/entities/Entity/EntitySchema";
    import { RepositoryPrepareResultSchema } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";

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
    let loadError = $state<string | null>(null);

    $effect(() => {
        if (!repository) {
            return;
        }

        let cancelled = false;
        loadError = null;

        void repository
            .refreshCommands()
            .then(() => {
                if (!cancelled) {
                    refreshNonce += 1;
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    loadError =
                        error instanceof Error ? error.message : String(error);
                }
            });

        return () => {
            cancelled = true;
        };
    });

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

        if (command.commandId === "repository.prepare" && repository) {
            const preparation = RepositoryPrepareResultSchema.parse(result);
            await repository.refresh();
            await repository.refreshCommands();
            refreshNonce += 1;
            await onCommandExecuted();
            await goto(
                `/airport/${encodeURIComponent(repository.id)}/${encodeURIComponent(preparation.id)}`,
            );
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

    {#if loadError}
        <p class="text-sm text-rose-600">{loadError}</p>
    {/if}
</div>
