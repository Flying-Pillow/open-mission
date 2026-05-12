<script lang="ts">
    import { invalidateAll } from "$app/navigation";
    import { app } from "$lib/client/Application.svelte.js";
    import {
        systemConfigSchema,
        type SystemConfig,
    } from "@flying-pillow/mission-core/entities/System/SystemSchema";
    import AgentSettings from "$lib/components/entities/Agent/AgentSettings.svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import FolderPicker from "$lib/components/ui/folder-picker.svelte";

    let {
        onCancel,
        onSaved,
    }: {
        onCancel: () => void;
        onSaved: () => Promise<void> | void;
    } = $props();

    const currentConfig = $derived(app.system?.config);

    let repositoriesRoot = $state("");
    let selectedEnabledAgentAdapters = $state<string[]>([]);
    let selectedDefaultAgentAdapter = $state("");
    let canSaveAgentSettings = $state(false);
    let availableAgentCount = $state(0);
    let saveError = $state<string | null>(null);
    let saving = $state(false);
    let initializedSettingsKey = $state("");

    $effect(() => {
        const config = currentConfig;
        if (!config) {
            return;
        }

        const nextKey = `${config.repositoriesRoot}:${config.defaultAgentAdapter}:${config.enabledAgentAdapters.join(",")}`;
        if (initializedSettingsKey === nextKey) {
            return;
        }

        initializedSettingsKey = nextKey;
        repositoriesRoot = config.repositoriesRoot;
        selectedEnabledAgentAdapters = [...config.enabledAgentAdapters];
        selectedDefaultAgentAdapter = config.defaultAgentAdapter;
    });

    const parsedConfig = $derived.by(() =>
        systemConfigSchema.safeParse({
            repositoriesRoot,
            defaultAgentAdapter: selectedDefaultAgentAdapter,
            enabledAgentAdapters: selectedEnabledAgentAdapters,
        } satisfies SystemConfig),
    );
    const canSaveSettings = $derived(
        parsedConfig.success &&
            (availableAgentCount === 0 || canSaveAgentSettings),
    );

    async function saveSettings(): Promise<void> {
        if (!parsedConfig.success || !canSaveSettings) {
            return;
        }

        saving = true;
        saveError = null;
        try {
            await app.system?.configure(parsedConfig.data);
            await invalidateAll();
            await onSaved();
        } catch (error) {
            saveError = error instanceof Error ? error.message : String(error);
        } finally {
            saving = false;
        }
    }
</script>

<Dialog.Header class="flex-none border-b px-6 py-4">
    <Dialog.Title>System Settings</Dialog.Title>
    <Dialog.Description>
        Configure the repositories root and the agents available for the system
        surface.
    </Dialog.Description>
</Dialog.Header>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div class="grid gap-4">
            <div class="grid gap-2 rounded-lg border px-3 py-3">
                <label
                    class="text-sm font-medium text-foreground"
                    for="repositories-root"
                >
                    Repositories root
                </label>
                <FolderPicker
                    id="repositories-root"
                    bind:value={repositoriesRoot}
                    placeholder="/home/user/repositories"
                    browseLabel="Browse folders"
                    helperText="Browse the runtime filesystem, then use the current folder or choose a child folder."
                />
                <p class="text-xs text-muted-foreground">
                    This root is used for the repositories system surface and
                    agent availability checks.
                </p>
            </div>

            <div class="rounded-lg border px-3 py-3">
                <AgentSettings
                    repositoryRootPath={repositoriesRoot}
                    bind:enabledAgentAdapters={selectedEnabledAgentAdapters}
                    bind:defaultAgentAdapter={selectedDefaultAgentAdapter}
                    bind:canSave={canSaveAgentSettings}
                    bind:availableAgentCount
                    title="System agents"
                    description="Choose which agents the repositories system surface may use."
                />
            </div>

            {#if !parsedConfig.success}
                <p class="text-sm text-rose-600">
                    {parsedConfig.error.issues[0]?.message ??
                        "System settings are invalid."}
                </p>
            {/if}

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
