<script lang="ts">
    import type { Snippet } from "svelte";
    import Icon from "@iconify/svelte";
    import { app } from "$lib/client/Application.svelte.js";
    import EntityCommandbar from "$lib/components/entities/Entity/EntityCommandbar.svelte";
    import RepositoryRemoveConfirmation from "$lib/components/entities/Repository/RepositoryRemoveConfirmation.svelte";
    import RepositorySettings from "$lib/components/entities/Repository/RepositorySettings.svelte";
    import type { Repository } from "$lib/components/entities/Repository/Repository.svelte.js";
    import type { RepositoryRemovalSummaryType } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import type { EntityCommandDescriptorType } from "@flying-pillow/mission-core/entities/Entity/EntitySchema";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";

    let {
        repository,
        onCommandExecuted,
        class: className,
        showEmptyState = false,
        showCodeIntelligenceToggle = false,
        leadingAction,
    }: {
        repository?: Repository;
        onCommandExecuted: () => Promise<void>;
        class?: string;
        showEmptyState?: boolean;
        showCodeIntelligenceToggle?: boolean;
        leadingAction?: Snippet;
    } = $props();

    let refreshNonce = $state(0);
    let settingsOpen = $state(false);

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

        if (!repository || !app.resolveRepository(repository.id)) {
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

    async function handleSettingsSaved(): Promise<void> {
        await onCommandExecuted();
        settingsOpen = false;
        refreshNonce += 1;
    }

    async function loadCommandConfirmationContext(
        command: EntityCommandDescriptorType,
    ): Promise<RepositoryRemovalSummaryType | undefined> {
        if (!repository || command.commandId !== "remove") {
            return undefined;
        }

        return await repository.readRemovalSummary();
    }

    function asRemovalSummary(
        input: unknown,
    ): RepositoryRemovalSummaryType | undefined {
        return input as RepositoryRemovalSummaryType | undefined;
    }

    function toggleCodeIntelligencePane(): void {
        window.dispatchEvent(
            new CustomEvent("mission:toggle-code-intelligence-pane"),
        );
    }
</script>

<div class="flex flex-wrap items-center gap-2">
    {@render leadingAction?.()}
    {#if showCodeIntelligenceToggle}
        <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={!repository}
            aria-label="Toggle code intelligence graph"
            title="Toggle code intelligence graph"
            onclick={toggleCodeIntelligencePane}
        >
            <Icon icon="lucide:git-fork" class="size-4" />
        </Button>
    {/if}
    <Dialog.Root bind:open={settingsOpen}>
        <Dialog.Trigger>
            {#snippet child({ props })}
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!repository}
                    aria-label="Repository agent settings"
                    title="Repository agent settings"
                    {...props}
                >
                    <Icon
                        icon="lucide:settings-2"
                        class="size-4"
                        data-icon="inline-start"
                    />
                    <span>Settings</span>
                </Button>
            {/snippet}
        </Dialog.Trigger>
        <Dialog.Content
            class="flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] flex-col gap-0 overflow-hidden rounded-none p-0 md:h-[82dvh] md:max-h-[82dvh] md:w-[88dvw] md:max-w-6xl md:rounded-4xl"
        >
            {#if repository}
                <RepositorySettings
                    {repository}
                    onCancel={() => {
                        settingsOpen = false;
                    }}
                    onSaved={handleSettingsSaved}
                />
            {/if}
        </Dialog.Content>
    </Dialog.Root>
    <EntityCommandbar
        {refreshNonce}
        entity={repository}
        class={className}
        defaultVariant="outline"
        {loadCommandConfirmationContext}
        presentation="responsive"
        menuLabel="Repository commands"
        {showEmptyState}
        onCommandExecuted={handleCommandExecuted}
    >
        {#snippet commandConfirmationDetails({
            command,
            loading,
            error,
            context,
        })}
            {#if command.commandId === "remove"}
                <RepositoryRemoveConfirmation
                    summary={asRemovalSummary(context)}
                    {loading}
                    {error}
                />
            {/if}
        {/snippet}
    </EntityCommandbar>
</div>
