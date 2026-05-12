<script lang="ts">
    import type { Repository } from "$lib/components/entities/Repository/Repository.svelte.js";
    import AgentSettings from "$lib/components/entities/Agent/AgentSettings.svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import IconPicker from "$lib/components/ui/icon-picker.svelte";

    let {
        repository,
        onCancel,
        onSaved,
    }: {
        repository: Repository;
        onCancel: () => void;
        onSaved: () => Promise<void> | void;
    } = $props();

    let saveError = $state<string | null>(null);
    let saving = $state(false);
    let selectedRepositoryIcon = $state("");
    let selectedEnabledAgentAdapters = $state<string[]>([]);
    let selectedDefaultAgentAdapter = $state("");
    let initializedSettingsKey = $state("");
    let canSaveAgentSettings = $state(false);
    let availableAgentCount = $state(0);

    const canSaveSettings = $derived(
        availableAgentCount === 0 || canSaveAgentSettings,
    );

    $effect(() => {
        const nextRepositoryKey = `${repository.id}:${repository.data.repositoryRootPath}:${repository.data.settings.enabledAgentAdapters.join(",")}:${repository.data.settings.agentAdapter}:${repository.data.settings.icon ?? ""}`;
        if (initializedSettingsKey === nextRepositoryKey) {
            return;
        }

        initializedSettingsKey = nextRepositoryKey;
        selectedRepositoryIcon = repository.data.settings.icon ?? "";
        selectedEnabledAgentAdapters = [
            ...repository.data.settings.enabledAgentAdapters,
        ];
        selectedDefaultAgentAdapter = repository.data.settings.agentAdapter;
    });

    async function saveSettings(): Promise<void> {
        if (!canSaveSettings) {
            return;
        }

        saving = true;
        saveError = null;
        try {
            await repository.configureDisplay({
                icon: selectedRepositoryIcon.trim() || null,
            });
            if (availableAgentCount > 0) {
                await repository.configureAgents({
                    defaultAgentAdapter: selectedDefaultAgentAdapter,
                    enabledAgentAdapters: [...selectedEnabledAgentAdapters],
                });
            }
            await onSaved();
        } catch (error) {
            saveError = error instanceof Error ? error.message : String(error);
        } finally {
            saving = false;
        }
    }
</script>

<Dialog.Header class="flex-none border-b px-6 py-4">
    <Dialog.Title>Repository Settings</Dialog.Title>
    <Dialog.Description>
        Choose a repository icon and configure the agents this repository may
        use.
    </Dialog.Description>
</Dialog.Header>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div class="grid gap-3">
            <div class="rounded-lg border px-3 py-3">
                <IconPicker
                    bind:value={selectedRepositoryIcon}
                    label="Select icon"
                />
            </div>

            <div class="rounded-lg border px-3 py-3">
                <AgentSettings
                    repositoryRootPath={repository.data.repositoryRootPath}
                    bind:enabledAgentAdapters={selectedEnabledAgentAdapters}
                    bind:defaultAgentAdapter={selectedDefaultAgentAdapter}
                    bind:canSave={canSaveAgentSettings}
                    bind:availableAgentCount
                    title="Repository agents"
                    description="Choose which agents this repository may use and which one should start by default."
                />
            </div>

            {#if saveError}
                <p class="text-sm text-rose-600">{saveError}</p>
            {/if}
        </div>
    </div>

    <Dialog.Footer class="border-t px-6 py-4">
        <Button type="button" variant="outline" onclick={onCancel}
            >Cancel</Button
        >
        <Button
            type="button"
            disabled={!canSaveSettings || saving}
            onclick={saveSettings}
        >
            {saving ? "Saving..." : "Save"}
        </Button>
    </Dialog.Footer>
</div>
