<script lang="ts">
    import { goto } from "$app/navigation";
    import Icon from "@iconify/svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import EntityCommandbar from "$lib/components/entities/Commandbar/EntityCommandbar.svelte";
    import type { Repository } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { Button } from "$lib/components/ui/button/index.js";
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

    const appContext = getAppContext();

    let refreshNonce = $state(0);

    const setupHref = $derived(
        repository
            ? `/airport/${encodeURIComponent(repository.id)}/setup`
            : undefined,
    );

    async function openSetup(): Promise<void> {
        if (!setupHref) {
            return;
        }

        await goto(setupHref);
    }

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

        await onCommandExecuted();

        if (
            !repository ||
            !appContext.application.resolveRepository(repository.id)
        ) {
            refreshNonce += 1;
            return;
        }

        if (repository) {
            await repository.refresh();
            await repository.refreshSyncStatus().catch(() => undefined);
            await repository.refreshCommands();
        }
        refreshNonce += 1;
    }
</script>

<div class="flex flex-wrap items-center gap-2">
    {#if repository}
        <Button
            variant="outline"
            size="sm"
            onclick={() => void openSetup()}
            aria-label="Open repository setup"
            title="Open repository setup"
        >
            <Icon
                icon="lucide:wrench"
                class="size-4"
                data-icon="inline-start"
            />
            <span>Setup</span>
        </Button>
    {/if}
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
