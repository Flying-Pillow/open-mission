<script lang="ts">
    import {
        AgentFindResultSchema,
        type AgentDataType,
    } from "@flying-pillow/mission-core/entities/Agent/AgentSchema";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Checkbox } from "$lib/components/ui/checkbox/index.js";
    import { qry } from "../../../../routes/api/entities/remote/query.remote";

    let {
        repositoryRootPath,
        enabledAgentAdapters = $bindable<string[]>([]),
        defaultAgentAdapter = $bindable(""),
        canSave = $bindable(false),
        availableAgentCount = $bindable(0),
        title = "Agents",
        description = "Choose which agents are enabled and which one is the default.",
        emptyRootPathMessage = "Enter a repositories root to load available agents.",
    }: {
        repositoryRootPath: string;
        enabledAgentAdapters?: string[];
        defaultAgentAdapter?: string;
        canSave?: boolean;
        availableAgentCount?: number;
        title?: string;
        description?: string;
        emptyRootPathMessage?: string;
    } = $props();

    const trimmedRepositoryRootPath = $derived(repositoryRootPath.trim());
    const agentsQuery = $derived.by(() => {
        if (!trimmedRepositoryRootPath) {
            return undefined;
        }

        return qry({
            entity: "Agent",
            method: "find",
            payload: {
                repositoryRootPath: trimmedRepositoryRootPath,
            },
        });
    });
    const agents = $derived.by((): AgentDataType[] => {
        const current = agentsQuery?.current;
        return Array.isArray(current)
            ? AgentFindResultSchema.parse(current)
            : [];
    });
    const loading = $derived(agentsQuery?.loading ?? false);
    const loadError = $derived.by(() => {
        const error = agentsQuery?.error;
        if (!error) {
            return null;
        }

        return error instanceof Error ? error.message : String(error);
    });
    const availableAgents = $derived(
        agents.filter((agent) => agent.availability.available),
    );

    $effect(() => {
        availableAgentCount = availableAgents.length;
        canSave =
            availableAgents.length === 0 ||
            (enabledAgentAdapters.length > 0 &&
                enabledAgentAdapters.includes(defaultAgentAdapter));
    });

    $effect(() => {
        const availableAgentIds = availableAgents.map((agent) => agent.agentId);
        if (availableAgentIds.length === 0) {
            return;
        }

        const normalizedEnabledAgentAdapters = [
            ...new Set(
                enabledAgentAdapters.filter((agentId) =>
                    availableAgentIds.includes(agentId),
                ),
            ),
        ];
        const nextEnabledAgentAdapters =
            normalizedEnabledAgentAdapters.length > 0
                ? normalizedEnabledAgentAdapters
                : [...availableAgentIds];
        const nextDefaultAgentAdapter = nextEnabledAgentAdapters.includes(
            defaultAgentAdapter,
        )
            ? defaultAgentAdapter
            : (nextEnabledAgentAdapters[0] ?? "");

        if (!sameStringList(enabledAgentAdapters, nextEnabledAgentAdapters)) {
            enabledAgentAdapters = nextEnabledAgentAdapters;
        }
        if (defaultAgentAdapter !== nextDefaultAgentAdapter) {
            defaultAgentAdapter = nextDefaultAgentAdapter;
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
            enabledAgentAdapters = [
                ...new Set([...enabledAgentAdapters, agentId]),
            ];
            if (!defaultAgentAdapter) {
                defaultAgentAdapter = agentId;
            }
            return;
        }

        const nextEnabledAgentAdapters = enabledAgentAdapters.filter(
            (candidate) => candidate !== agentId,
        );
        enabledAgentAdapters = nextEnabledAgentAdapters;
        if (defaultAgentAdapter === agentId) {
            defaultAgentAdapter = nextEnabledAgentAdapters[0] ?? "";
        }
    }
</script>

<div class="grid gap-3">
    <div class="grid gap-1">
        <h3 class="text-sm font-semibold text-foreground">{title}</h3>
        <p class="text-sm text-muted-foreground">{description}</p>
    </div>

    {#if !trimmedRepositoryRootPath}
        <p class="text-sm text-muted-foreground">{emptyRootPathMessage}</p>
    {:else if loading}
        <p class="text-sm text-muted-foreground">Loading agents...</p>
    {:else if loadError}
        <p class="text-sm text-rose-600">{loadError}</p>
    {:else if agents.length === 0}
        <p class="text-sm text-muted-foreground">
            No runtime agents were discovered for this surface.
        </p>
    {:else}
        {#each agents as agent (agent.id)}
            <div class="rounded-lg border px-3 py-3">
                <div class="flex items-start justify-between gap-3">
                    <label class="flex min-w-0 items-start gap-3">
                        <Checkbox
                            checked={enabledAgentAdapters.includes(
                                agent.agentId,
                            )}
                            disabled={!agent.availability.available}
                            onCheckedChange={(checked) =>
                                toggleAgent(agent.agentId, checked === true)}
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
                                <p class="mt-1 text-xs text-muted-foreground">
                                    {agent.availability.reason}
                                </p>
                            {/if}
                        </div>
                    </label>

                    <Button
                        type="button"
                        variant={defaultAgentAdapter === agent.agentId
                            ? "default"
                            : "outline"}
                        size="sm"
                        disabled={!enabledAgentAdapters.includes(agent.agentId)}
                        onclick={() => {
                            defaultAgentAdapter = agent.agentId;
                        }}
                    >
                        Default
                    </Button>
                </div>
            </div>
        {/each}
    {/if}
</div>
