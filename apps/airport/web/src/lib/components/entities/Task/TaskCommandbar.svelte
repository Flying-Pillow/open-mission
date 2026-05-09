<script lang="ts">
    import Icon from "@iconify/svelte";
    import {
        type AgentDataType,
        type AgentIdType,
    } from "@flying-pillow/mission-core/entities/Agent/AgentSchema";
    import { type MissionReasoningEffortType } from "@flying-pillow/mission-core/entities/Mission/MissionSchema";
    import type { EntityCommandDescriptorType } from "@flying-pillow/mission-core/entities/Entity/EntitySchema";
    import {
        TaskCommandIds,
        type TaskConfigureCommandOptionsType,
        type TaskStartCommandOptionsType,
    } from "@flying-pillow/mission-core/entities/Task/TaskSchema";
    import EntityCommandbar from "$lib/components/entities/Commandbar/EntityCommandbar.svelte";
    import type { Task } from "$lib/components/entities/Task/Task.svelte.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
    import { Input } from "$lib/components/ui/input/index.js";

    type MenuOption<TValue extends string> = {
        value: TValue;
        label: string;
        description?: string;
    };

    type AgentOptionEntry = {
        id: AgentIdType;
        label: string;
        models: AgentDataType["optionCatalog"]["models"];
        reasoningEfforts: AgentDataType["optionCatalog"]["reasoningEfforts"];
        available: boolean;
    };

    const defaultSelectionOption = {
        value: "",
        label: "Task default",
        description: "Use task or repository settings",
    } as const;

    const allReasoningEffortOptions: MenuOption<
        "" | MissionReasoningEffortType
    >[] = [
        {
            value: "",
            label: "Task default",
            description: "Use task or repository settings",
        },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "xhigh", label: "XHigh" },
    ];

    let {
        refreshNonce,
        availableAgents = [],
        enabledAgentAdapters = [],
        task,
        onCommandExecuted,
    }: {
        refreshNonce: number;
        availableAgents?: AgentDataType[];
        enabledAgentAdapters?: AgentIdType[];
        task?: Task;
        onCommandExecuted: () => Promise<void>;
    } = $props();

    let initializedTaskKey = $state<string | undefined>(undefined);
    let persistedConfigurationSignature = $state<string | undefined>(undefined);
    let agentAdapter = $state<AgentIdType>("copilot-cli");
    let model = $state("");
    let customModel = $state("");
    let reasoningEffort = $state<"" | MissionReasoningEffortType>("");

    const discoveredAgents = $derived(availableAgents.map(toAgentOptionEntry));

    const enabledAgentIdSet = $derived(
        new Set(enabledAgentAdapters.map((agentId) => agentId.trim())),
    );
    const agentAdapterCatalog = $derived.by(() => {
        const catalog = discoveredAgents.filter(
            (candidate) =>
                candidate.available &&
                (enabledAgentIdSet.size === 0 ||
                    enabledAgentIdSet.has(candidate.id)),
        );
        const currentAgentId = task?.agentAdapter?.trim() || agentAdapter;
        const currentAgent = discoveredAgents.find(
            (candidate) => candidate.id === currentAgentId,
        );
        if (
            currentAgent &&
            !catalog.some((candidate) => candidate.id === currentAgent.id)
        ) {
            catalog.unshift(currentAgent);
        }
        if (catalog.length === 0) {
            catalog.push(createFallbackAgentOption(currentAgentId));
        }
        return catalog;
    });
    const agentAdapterOptions = $derived(
        agentAdapterCatalog.map((entry) => ({
            value: entry.id,
            label: entry.label,
        })),
    );
    const defaultAgentAdapter = $derived(agentAdapterCatalog[0]);
    const selectedAgentAdapter = $derived(
        agentAdapterCatalog.find((entry) => entry.id === agentAdapter) ??
            defaultAgentAdapter,
    );

    const availableModelOptions = $derived.by(() => {
        const taskModel = task?.model?.trim();
        const options: MenuOption<string>[] = [
            defaultSelectionOption,
            ...selectedAgentAdapter.models,
        ];
        if (
            taskModel &&
            !options.some((candidate) => candidate.value === taskModel)
        ) {
            options.splice(1, 0, {
                value: taskModel,
                label: taskModel,
                description: "Task configured model",
            });
        }
        if (model && !options.some((candidate) => candidate.value === model)) {
            options.splice(1, 0, {
                value: model,
                label: model,
                description: "Custom model",
            });
        }

        return options;
    });
    const reasoningEffortOptions = $derived.by(() => {
        const availableValues = new Set(selectedAgentAdapter.reasoningEfforts);
        return allReasoningEffortOptions.filter(
            (option) =>
                option.value === "" || availableValues.has(option.value),
        );
    });
    const selectedAgentAdapterOption = $derived(
        agentAdapterOptions.find((option) => option.value === agentAdapter) ??
            agentAdapterOptions[0],
    );
    const selectedModelOption = $derived(
        availableModelOptions.find((option) => option.value === model) ??
            defaultSelectionOption,
    );
    const selectedReasoningEffortOption = $derived(
        reasoningEffortOptions.find(
            (option) => option.value === reasoningEffort,
        ) ?? reasoningEffortOptions[0],
    );

    $effect(() => {
        const taskKey = `${task?.taskId ?? ""}:${agentAdapterCatalog.map((entry) => entry.id).join(",")}`;
        if (initializedTaskKey === taskKey) {
            return;
        }

        const taskAgentAdapter = task?.agentAdapter;
        agentAdapter =
            agentAdapterCatalog.find(
                (candidate) => candidate.id === taskAgentAdapter,
            )?.id ?? defaultAgentAdapter.id;
        model = task?.model ?? "";
        customModel = "";
        reasoningEffort = task?.reasoningEffort ?? "";
        initializedTaskKey = taskKey;
        persistedConfigurationSignature =
            buildConfigurationSignature(readConfigureInput());
    });

    $effect(() => {
        const selectedModelIsAvailable =
            model &&
            availableModelOptions.some((option) => option.value === model);
        if (model && !selectedModelIsAvailable) {
            model = "";
        }
        if (
            !reasoningEffortOptions.some(
                (option) => option.value === reasoningEffort,
            )
        ) {
            reasoningEffort = "";
        }
    });

    $effect(() => {
        if (!task || initializedTaskKey === undefined) {
            return;
        }

        const input = readConfigureInput();
        const signature = buildConfigurationSignature(input);
        if (signature === persistedConfigurationSignature) {
            return;
        }

        persistedConfigurationSignature = signature;
        void persistTaskConfiguration(task, input);
    });

    function resolveCommandInput(
        command: EntityCommandDescriptorType,
    ): TaskStartCommandOptionsType | undefined {
        if (command.commandId !== TaskCommandIds.start) {
            return undefined;
        }

        return {
            agentAdapter,
            ...(model ? { model } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
        };
    }

    function readConfigureInput(): TaskConfigureCommandOptionsType {
        return {
            agentAdapter,
            model: model || null,
            reasoningEffort: reasoningEffort || null,
            context: task?.context ?? [],
        };
    }

    function buildConfigurationSignature(
        input: TaskConfigureCommandOptionsType,
    ): string {
        return JSON.stringify(input);
    }

    async function persistTaskConfiguration(
        currentTask: Task,
        input: TaskConfigureCommandOptionsType,
    ): Promise<void> {
        try {
            await currentTask.configure(input);
            await onCommandExecuted();
        } catch (error) {
            console.error("Failed to persist task configuration.", error);
        }
    }

    function useCustomModel(): void {
        const nextModel = customModel.trim();
        if (!nextModel) {
            return;
        }

        model = nextModel;
    }

    function toAgentOptionEntry(agent: AgentDataType): AgentOptionEntry {
        return {
            id: agent.agentId,
            label: agent.displayName,
            models: agent.optionCatalog.models,
            reasoningEfforts: agent.optionCatalog.reasoningEfforts,
            available: agent.availability.available,
        };
    }

    function createFallbackAgentOption(
        fallbackAgentId: string | undefined,
    ): AgentOptionEntry {
        const fallbackId = (fallbackAgentId?.trim() || "codex") as AgentIdType;
        return {
            id: fallbackId,
            label: fallbackId,
            models: [],
            reasoningEfforts: [],
            available: false,
        };
    }
</script>

<div class="flex flex-wrap items-center gap-2">
    <DropdownMenu.Root>
        <DropdownMenu.Trigger>
            {#snippet child({ props })}
                <Button
                    variant="outline"
                    size="sm"
                    class="min-w-32 justify-between gap-2 bg-background/80"
                    disabled={!task}
                    aria-label="Agent adapter"
                    title="Agent adapter"
                    {...props}
                >
                    <Icon
                        icon="lucide:bot"
                        class="size-4"
                        data-icon="inline-start"
                    />
                    <span class="min-w-0 flex-1 truncate text-left">
                        {selectedAgentAdapterOption.label}
                    </span>
                    <Icon
                        icon="lucide:chevron-down"
                        class="size-4 opacity-60"
                    />
                </Button>
            {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
            align="end"
            sideOffset={6}
            class="min-w-56 rounded-lg"
        >
            <DropdownMenu.Label>Agent adapter</DropdownMenu.Label>
            <DropdownMenu.Separator />
            <DropdownMenu.RadioGroup bind:value={agentAdapter}>
                {#each agentAdapterOptions as option (option.value)}
                    <DropdownMenu.RadioItem value={option.value}>
                        <span>{option.label}</span>
                    </DropdownMenu.RadioItem>
                {/each}
            </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
    </DropdownMenu.Root>

    <DropdownMenu.Root>
        <DropdownMenu.Trigger>
            {#snippet child({ props })}
                <Button
                    variant="outline"
                    size="sm"
                    class="min-w-36 justify-between gap-2 bg-background/80"
                    disabled={!task}
                    aria-label="Model"
                    title="Model"
                    {...props}
                >
                    <Icon
                        icon="lucide:cpu"
                        class="size-4"
                        data-icon="inline-start"
                    />
                    <span class="min-w-0 flex-1 truncate text-left">
                        {selectedModelOption.label}
                    </span>
                    <Icon
                        icon="lucide:chevron-down"
                        class="size-4 opacity-60"
                    />
                </Button>
            {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
            align="end"
            sideOffset={6}
            class="min-w-64 rounded-lg"
        >
            <DropdownMenu.Label>Model</DropdownMenu.Label>
            <DropdownMenu.Separator />
            <div class="grid gap-2 px-2 py-2">
                <div class="flex items-center gap-2">
                    <Input
                        bind:value={customModel}
                        class="h-8 min-w-0 flex-1"
                        placeholder="Type model id"
                        aria-label="Custom model id"
                        onkeydown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                useCustomModel();
                            }
                        }}
                    />
                    <Button
                        variant="secondary"
                        size="sm"
                        class="h-8"
                        disabled={!customModel.trim()}
                        onclick={useCustomModel}
                    >
                        <Icon
                            icon="lucide:plus"
                            class="size-4"
                            data-icon="inline-start"
                        />
                        <span>Use</span>
                    </Button>
                </div>
            </div>
            <DropdownMenu.Separator />
            <DropdownMenu.RadioGroup bind:value={model}>
                {#each availableModelOptions as option (option.value)}
                    <DropdownMenu.RadioItem value={option.value}>
                        <span class="flex min-w-0 flex-col">
                            <span>{option.label}</span>
                            {#if option.description}
                                <span class="text-xs text-muted-foreground">
                                    {option.description}
                                </span>
                            {/if}
                        </span>
                    </DropdownMenu.RadioItem>
                {/each}
            </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
    </DropdownMenu.Root>

    <DropdownMenu.Root>
        <DropdownMenu.Trigger>
            {#snippet child({ props })}
                <Button
                    variant="outline"
                    size="sm"
                    class="min-w-32 justify-between gap-2 bg-background/80"
                    disabled={!task}
                    aria-label="Reasoning effort"
                    title="Reasoning effort"
                    {...props}
                >
                    <Icon
                        icon="lucide:gauge"
                        class="size-4"
                        data-icon="inline-start"
                    />
                    <span class="min-w-0 flex-1 truncate text-left">
                        {selectedReasoningEffortOption.label}
                    </span>
                    <Icon
                        icon="lucide:chevron-down"
                        class="size-4 opacity-60"
                    />
                </Button>
            {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
            align="end"
            sideOffset={6}
            class="min-w-56 rounded-lg"
        >
            <DropdownMenu.Label>Reasoning effort</DropdownMenu.Label>
            <DropdownMenu.Separator />
            <DropdownMenu.RadioGroup bind:value={reasoningEffort}>
                {#each reasoningEffortOptions as option (option.value)}
                    <DropdownMenu.RadioItem value={option.value}>
                        <span class="flex min-w-0 flex-col">
                            <span>{option.label}</span>
                            {#if option.description}
                                <span class="text-xs text-muted-foreground">
                                    {option.description}
                                </span>
                            {/if}
                        </span>
                    </DropdownMenu.RadioItem>
                {/each}
            </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
    </DropdownMenu.Root>

    <EntityCommandbar
        {refreshNonce}
        entity={task}
        defaultVariant="default"
        buttonClass="shadow-sm shadow-primary/10"
        showEmptyState={false}
        {resolveCommandInput}
        {onCommandExecuted}
    />
</div>
