<script lang="ts">
    import type { Repository } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Checkbox } from "$lib/components/ui/checkbox/index.js";
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

    const agentsQuery = $derived(repository.findAgentsQuery());
    const agents = $derived(repository.readAgentsQueryCurrent(agentsQuery));
    const loading = $derived(agentsQuery.loading ?? false);
    const loadError = $derived.by(() => {
        const error = agentsQuery.error;
        if (!error) {
            return null;
        }

        return error instanceof Error ? error.message : String(error);
    });

    const availableAgents = $derived(
        agents.filter((agent) => agent.availability.available),
    );
    const canSaveAgentSettings = $derived(
        Boolean(
            selectedEnabledAgentAdapters.length > 0 &&
                selectedEnabledAgentAdapters.includes(
                    selectedDefaultAgentAdapter,
                ),
        ),
    );
    const canSaveSettings = $derived(
        availableAgents.length === 0 || canSaveAgentSettings,
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

    $effect(() => {
        const availableAgentIds = availableAgents.map((agent) => agent.agentId);
        if (availableAgentIds.length === 0) {
            return;
        }

        const normalizedEnabledAgentAdapters = [
            ...new Set(
                selectedEnabledAgentAdapters.filter((agentId) =>
                    availableAgentIds.includes(agentId),
                ),
            ),
        ];
        const nextEnabledAgentAdapters =
            normalizedEnabledAgentAdapters.length > 0
                ? normalizedEnabledAgentAdapters
                : [...availableAgentIds];
        const nextDefaultAgentAdapter = nextEnabledAgentAdapters.includes(
            selectedDefaultAgentAdapter,
        )
            ? selectedDefaultAgentAdapter
            : (nextEnabledAgentAdapters[0] ?? "");

        if (
            !sameStringList(
                selectedEnabledAgentAdapters,
                nextEnabledAgentAdapters,
            )
        ) {
            selectedEnabledAgentAdapters = nextEnabledAgentAdapters;
        }
        if (selectedDefaultAgentAdapter !== nextDefaultAgentAdapter) {
            selectedDefaultAgentAdapter = nextDefaultAgentAdapter;
        }
    });

    function sameStringList(left: string[], right: string[]): boolean {
        return (
            left.length === right.length &&
            left.every((value, index) => value === right[index])
        );
    }

    function toggleAgent(agentId: string, checked: boolean): void {
        if (checked) {
            selectedEnabledAgentAdapters = [
                ...new Set([...selectedEnabledAgentAdapters, agentId]),
            ];
            if (!selectedDefaultAgentAdapter) {
                selectedDefaultAgentAdapter = agentId;
            }
            return;
        }

        selectedEnabledAgentAdapters = selectedEnabledAgentAdapters.filter(
            (candidate) => candidate !== agentId,
        );
        if (selectedDefaultAgentAdapter === agentId) {
            selectedDefaultAgentAdapter = selectedEnabledAgentAdapters[0] ?? "";
        }
    }

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
            if (availableAgents.length > 0) {
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

            {#if loading}
                <p class="text-sm text-muted-foreground">Loading agents...</p>
            {:else if loadError}
                <p class="text-sm text-rose-600">{loadError}</p>
            {:else if agents.length === 0}
                <p class="text-sm text-muted-foreground">
                    No runtime agents were discovered for this repository.
                </p>
            {:else}
                {#each agents as agent (agent.id)}
                    <div class="rounded-lg border px-3 py-3">
                        <div class="flex items-start justify-between gap-3">
                            <label class="flex min-w-0 items-start gap-3">
                                <Checkbox
                                    checked={selectedEnabledAgentAdapters.includes(
                                        agent.agentId,
                                    )}
                                    disabled={!agent.availability.available}
                                    onCheckedChange={(checked) =>
                                        toggleAgent(
                                            agent.agentId,
                                            checked === true,
                                        )}
                                />
                                <div class="min-w-0">
                                    <div class="flex items-center gap-2">
                                        <span
                                            class="text-sm font-medium text-foreground"
                                        >
                                            {agent.displayName}
                                        </span>
                                        <span
                                            class={`text-xs ${agent.availability.available ? "text-emerald-600" : "text-rose-600"}`}
                                        >
                                            {agent.availability.available
                                                ? "Available"
                                                : "Unavailable"}
                                        </span>
                                    </div>
                                    <p class="text-xs text-muted-foreground">
                                        {agent.agentId}
                                    </p>
                                    {#if agent.availability.reason}
                                        <p
                                            class="mt-1 text-xs text-muted-foreground"
                                        >
                                            {agent.availability.reason}
                                        </p>
                                    {/if}
                                </div>
                            </label>

                            <Button
                                type="button"
                                variant={selectedDefaultAgentAdapter ===
                                agent.agentId
                                    ? "default"
                                    : "outline"}
                                size="sm"
                                disabled={!selectedEnabledAgentAdapters.includes(
                                    agent.agentId,
                                )}
                                onclick={() => {
                                    selectedDefaultAgentAdapter = agent.agentId;
                                }}
                            >
                                Default
                            </Button>
                        </div>
                    </div>
                {/each}
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
            disabled={!canSaveSettings ||
                saving ||
                (loading && availableAgents.length > 0)}
            onclick={saveSettings}
        >
            {saving ? "Saving..." : "Save"}
        </Button>
    </Dialog.Footer>
</div>
