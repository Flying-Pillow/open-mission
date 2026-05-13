<script lang="ts">
    import {
        type AgentConnectionTestResultType,
        type AgentType,
    } from "@flying-pillow/open-mission-core/entities/Agent/AgentSchema";
    import AgentCard from "$lib/components/entities/Agent/Agent.svelte";
    import { Agent as AgentEntity } from "$lib/components/entities/Agent/Agent.svelte.js";

    type AgentConnectionTestState =
        | { status: "idle" }
        | { status: "running"; agentId: string }
        | {
              status: "done";
              agentId: string;
              result: AgentConnectionTestResultType;
          };

    let {
        agents,
        availableAgents,
        enabledAgentAdapters,
        defaultAgentAdapter,
        connectionTestState,
        canTestAgent,
        onToggleEnabled,
        onChooseDefault,
        onTestConnection,
    }: {
        agents: AgentType[];
        availableAgents: AgentType[];
        enabledAgentAdapters: string[];
        defaultAgentAdapter: string;
        connectionTestState: AgentConnectionTestState;
        canTestAgent: (agent: AgentType) => boolean;
        onToggleEnabled: (agentId: string, enabled: boolean) => void;
        onChooseDefault: (agentId: string) => void;
        onTestConnection: (agent: AgentType) => Promise<void> | void;
    } = $props();
</script>

<div class="text-xs text-muted-foreground">
    {availableAgents.length} available of {agents.length} discovered
</div>

<section class="grid grid-cols-1 gap-2.5 md:grid-cols-3">
    {#each agents as agent (agent.id)}
        {@const isDefault = AgentEntity.isDefaultAgent(
            { defaultAgentAdapter },
            agent.agentId,
        )}
        <AgentCard
            {agent}
            enabled={AgentEntity.isAgentEnabled(
                { enabledAgentAdapters },
                agent.agentId,
            )}
            {isDefault}
            canTest={canTestAgent(agent)}
            {connectionTestState}
            {onToggleEnabled}
            {onChooseDefault}
            {onTestConnection}
        />
    {/each}
</section>
