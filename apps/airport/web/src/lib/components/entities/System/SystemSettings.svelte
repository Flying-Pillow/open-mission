<script lang="ts">
    import { invalidateAll } from "$app/navigation";
    import { app } from "$lib/client/Application.svelte.js";
    import {
        SystemConfigureSchema,
        type SystemConfigureType,
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
    let selectedDefaultAgentMode = $state<
        "interactive" | "autonomous" | undefined
    >(undefined);
    let canSaveAgentSettings = $state(false);
    let availableAgentCount = $state(0);
    let saveError = $state<string | null>(null);
    let saving = $state(false);
    let initializedSettingsKey = $state("");

    const trimmedRepositoriesRoot = $derived(repositoriesRoot.trim());
    const settingsLoaded = $derived(initializedSettingsKey.length > 0);

    $effect(() => {
        const config = currentConfig;
        if (!config) {
            return;
        }

        const nextKey = `${config.repositoriesRoot}:${config.defaultAgentAdapter}:${config.enabledAgentAdapters.join(",")}:${config.defaultAgentMode ?? ""}`;
        if (initializedSettingsKey === nextKey) {
            return;
        }

        initializedSettingsKey = nextKey;
        repositoriesRoot = config.repositoriesRoot;
        selectedEnabledAgentAdapters = [...config.enabledAgentAdapters];
        selectedDefaultAgentAdapter = config.defaultAgentAdapter;
        selectedDefaultAgentMode = config.defaultAgentMode;
    });

    const parsedRepositorySettings = $derived.by(() =>
        SystemConfigureSchema.safeParse({
            repositoriesRoot: trimmedRepositoriesRoot,
        } satisfies SystemConfigureType),
    );
    const canSaveSettings = $derived(
        parsedRepositorySettings.success &&
            (availableAgentCount === 0 || canSaveAgentSettings),
    );
    const validationMessage = $derived.by(() => {
        if (!trimmedRepositoriesRoot || parsedRepositorySettings.success) {
            return null;
        }

        const issue = parsedRepositorySettings.error.issues[0];
        const field = issue?.path[0];
        if (field === "repositoriesRoot") {
            return "Enter a repositories root to continue.";
        }

        return issue?.message ?? "Repository root settings are invalid.";
    });

    async function saveSettings(): Promise<void> {
        if (
            !settingsLoaded ||
            !parsedRepositorySettings.success ||
            !canSaveSettings
        ) {
            return;
        }

        saving = true;
        saveError = null;
        try {
            await app.system?.configure(parsedRepositorySettings.data);
            if (availableAgentCount > 0) {
                await app.system?.configureAgent({
                    defaultAgentAdapter: selectedDefaultAgentAdapter,
                    enabledAgentAdapters: [...selectedEnabledAgentAdapters],
                    ...(selectedDefaultAgentMode
                        ? { defaultAgentMode: selectedDefaultAgentMode }
                        : {}),
                });
            }
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
        {#if !settingsLoaded}
            <p class="text-sm text-muted-foreground">
                Loading system settings...
            </p>
        {:else}
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
                        This root is used for the repositories system surface
                        and agent availability checks.
                    </p>
                </div>

                <AgentSettings
                    agentResolutionRootPath={trimmedRepositoriesRoot}
                    testWorkingDirectory={trimmedRepositoriesRoot}
                    bind:enabledAgentAdapters={selectedEnabledAgentAdapters}
                    bind:defaultAgentAdapter={selectedDefaultAgentAdapter}
                    bind:defaultAgentMode={selectedDefaultAgentMode}
                    bind:canSave={canSaveAgentSettings}
                    bind:availableAgentCount
                    title="System agents"
                    description="Choose which agents the system owner may use and how its Agent executions should start."
                />

                {#if validationMessage}
                    <p class="text-sm text-rose-600">
                        {validationMessage}
                    </p>
                {/if}

                {#if saveError}
                    <p class="text-sm text-rose-600">{saveError}</p>
                {/if}
            </div>
        {/if}
    </div>

    <Dialog.Footer class="border-t px-6 py-4">
        <Button type="button" variant="outline" onclick={onCancel}
            >Cancel</Button
        >
        <Button
            type="button"
            disabled={!settingsLoaded || !canSaveSettings || saving}
            onclick={saveSettings}
        >
            {saving ? "Saving..." : "Save"}
        </Button>
    </Dialog.Footer>
</div>
