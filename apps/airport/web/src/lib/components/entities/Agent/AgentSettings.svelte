<script lang="ts">
    import {
        type AgentConnectionTestResultType,
        type AgentType,
        type AgentOwnerSettingsType,
    } from "@flying-pillow/mission-core/entities/Agent/AgentSchema";
    import AgentList from "$lib/components/entities/Agent/AgentList.svelte";
    import { Agent } from "$lib/components/entities/Agent/Agent.svelte.js";

    let {
        agentResolutionRootPath = "",
        testWorkingDirectory,
        enabledAgentAdapters = $bindable<string[]>([]),
        defaultAgentAdapter = $bindable(""),
        defaultAgentMode = $bindable<
            AgentOwnerSettingsType["defaultAgentMode"]
        >(undefined),
        canSave = $bindable(false),
        availableAgentCount = $bindable(0),
        title = "Agent defaults",
        description = "Choose which agents this owner may use and how new Agent executions should start.",
    }: {
        agentResolutionRootPath?: string;
        testWorkingDirectory?: string;
        enabledAgentAdapters?: string[];
        defaultAgentAdapter?: string;
        defaultAgentMode?: AgentOwnerSettingsType["defaultAgentMode"];
        canSave?: boolean;
        availableAgentCount?: number;
        title?: string;
        description?: string;
    } = $props();

    const trimmedRootPath = $derived(agentResolutionRootPath.trim());
    const agentsQuery = $derived.by(() =>
        Agent.findQuery(
            trimmedRootPath ? { repositoryRootPath: trimmedRootPath } : {},
        ),
    );
    const agents = $derived.by((): AgentType[] =>
        Agent.readFindQueryCurrent(agentsQuery),
    );
    const loading = $derived(Agent.readQueryLoading(agentsQuery));
    const loadError = $derived(Agent.readQueryError(agentsQuery));
    const availableAgents = $derived(Agent.availableAgents(agents));
    const effectiveMode = $derived(defaultAgentMode ?? "interactive");

    let connectionTestState = $state<
        | { status: "idle" }
        | { status: "running"; agentId: string }
        | {
              status: "done";
              agentId: string;
              result: AgentConnectionTestResultType;
          }
    >({ status: "idle" });

    $effect(() => {
        availableAgentCount = availableAgents.length;
        canSave = Agent.canSaveOwnerSettings({
            availableAgents,
            settings: currentSettings(),
        });
    });

    $effect(() => {
        const nextSettings = Agent.normalizeOwnerSettings({
            availableAgents,
            settings: currentSettings(),
        });

        if (
            !sameStringList(
                enabledAgentAdapters,
                nextSettings.enabledAgentAdapters,
            )
        ) {
            enabledAgentAdapters = nextSettings.enabledAgentAdapters;
        }
        if (defaultAgentAdapter !== nextSettings.defaultAgentAdapter) {
            defaultAgentAdapter = nextSettings.defaultAgentAdapter;
        }
        if (defaultAgentMode !== nextSettings.defaultAgentMode) {
            defaultAgentMode = nextSettings.defaultAgentMode;
        }
    });

    $effect(() => {
        defaultAgentAdapter;
        connectionTestState = { status: "idle" };
    });

    function currentSettings(): AgentOwnerSettingsType {
        return {
            defaultAgentAdapter,
            enabledAgentAdapters,
            ...(defaultAgentMode ? { defaultAgentMode } : {}),
        };
    }

    function applySettings(settings: AgentOwnerSettingsType): void {
        defaultAgentAdapter = settings.defaultAgentAdapter;
        enabledAgentAdapters = settings.enabledAgentAdapters;
        defaultAgentMode = settings.defaultAgentMode;
    }

    function sameStringList(left: string[], right: string[]): boolean {
        return (
            left.length === right.length &&
            left.every((value, index) => value === right[index])
        );
    }

    function toggleAgent(agentId: string, checked: boolean): void {
        applySettings(
            Agent.toggleEnabledAgentSettings({
                settings: currentSettings(),
                agentId,
                enabled: checked,
            }),
        );
    }

    function chooseDefaultAgent(agentId: string): void {
        applySettings(
            Agent.chooseDefaultAgentSettings({
                settings: currentSettings(),
                agentId,
            }),
        );
    }

    function canTestAgent(agent: AgentType): boolean {
        return agent.availability.available && !!effectiveMode;
    }

    async function testConnection(agent: AgentType): Promise<void> {
        if (!canTestAgent(agent)) {
            return;
        }

        const workingDirectory =
            testWorkingDirectory?.trim() || trimmedRootPath || undefined;
        connectionTestState = { status: "running", agentId: agent.agentId };
        const result = await Agent.testConnection({
            agentId: agent.agentId,
            agentName: agent.displayName,
            ...(trimmedRootPath ? { repositoryRootPath: trimmedRootPath } : {}),
            ...(workingDirectory ? { workingDirectory } : {}),
            launchMode: effectiveMode,
        });
        connectionTestState = {
            status: "done",
            agentId: agent.agentId,
            result,
        };
    }
</script>

<div class="grid gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="grid gap-1">
            <h3 class="text-sm font-semibold text-foreground">{title}</h3>
            <p class="max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
        {#if agents.length > 0}
            <label
                class="flex items-center gap-2 text-xs font-medium text-muted-foreground"
            >
                <span>Launch mode</span>
                <select
                    class="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
                    value={effectiveMode}
                    onchange={(event) => {
                        defaultAgentMode = event.currentTarget
                            .value as AgentOwnerSettingsType["defaultAgentMode"];
                    }}
                >
                    <option value="interactive">Interactive</option>
                    <option value="autonomous">Autonomous</option>
                </select>
            </label>
        {/if}
    </div>

    {#if loading}
        <p class="text-sm text-muted-foreground">Loading agents...</p>
    {:else if loadError}
        <p class="text-sm text-rose-600">{loadError}</p>
    {:else if agents.length === 0}
        <p class="text-sm text-muted-foreground">
            No runtime agents were discovered for this owner.
        </p>
    {:else}
        <AgentList
            {agents}
            {availableAgents}
            {enabledAgentAdapters}
            {defaultAgentAdapter}
            {connectionTestState}
            {canTestAgent}
            onToggleEnabled={toggleAgent}
            onChooseDefault={chooseDefaultAgent}
            onTestConnection={testConnection}
        />
    {/if}
</div>
