<script lang="ts">
    import {
        type AgentConnectionTestResultType,
        type AgentType,
    } from "@flying-pillow/mission-core/entities/Agent/AgentSchema";
    import Icon from "@iconify/svelte";
    import { Button } from "$lib/components/ui/button/index.js";

    type AgentConnectionTestState =
        | { status: "idle" }
        | { status: "running"; agentId: string }
        | {
              status: "done";
              agentId: string;
              result: AgentConnectionTestResultType;
          };

    let {
        agent,
        enabled,
        isDefault,
        canTest,
        connectionTestState,
        onToggleEnabled,
        onChooseDefault,
        onTestConnection,
    }: {
        agent: AgentType;
        enabled: boolean;
        isDefault: boolean;
        canTest: boolean;
        connectionTestState: AgentConnectionTestState;
        onToggleEnabled: (agentId: string, enabled: boolean) => void;
        onChooseDefault: (agentId: string) => void;
        onTestConnection: (agent: AgentType) => Promise<void> | void;
    } = $props();

    const available = $derived(agent.availability.available);
    const running = $derived(connectionTestState.status === "running");
    const testing = $derived(
        connectionTestState.status === "running" &&
            connectionTestState.agentId === agent.agentId,
    );
</script>

<article
    class={`grid min-h-36 min-w-0 grid-rows-[auto_1fr_auto_auto] gap-3 rounded-lg border p-3 transition ${isDefault ? "border-primary/45 bg-primary/5 shadow-sm" : "border-border bg-background"} ${available ? "" : "opacity-70"}`}
>
    <div class="flex min-w-0 items-start justify-between gap-2.5">
        <div class="flex min-w-0 flex-1 items-start gap-2.5">
            <div
                class={`grid size-8 flex-none place-items-center rounded-md border ${isDefault ? "border-primary/35 bg-primary/15 text-primary" : "border-border bg-muted/30 text-muted-foreground"}`}
            >
                <Icon icon={agent.icon} class="size-4" />
            </div>
            <div class="min-w-0 flex-1">
                <h4 class="truncate text-sm font-semibold text-foreground">
                    {agent.displayName}
                </h4>
                <p class="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {agent.agentId}
                </p>
            </div>
        </div>

        <div class="flex flex-none items-center gap-1">
            <button
                type="button"
                aria-pressed={enabled}
                aria-label={enabled ? "Disable Agent" : "Enable Agent"}
                title={enabled ? "Disable Agent" : "Enable Agent"}
                disabled={!available}
                class="inline-flex size-7 items-center justify-center rounded-md border border-border bg-muted/15 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary disabled:pointer-events-none disabled:opacity-50"
                onclick={() => onToggleEnabled(agent.agentId, !enabled)}
            >
                <Icon icon="lucide:power" class="size-3" />
            </button>
            <button
                type="button"
                aria-pressed={isDefault}
                aria-label={isDefault ? "Default Agent" : "Make Default Agent"}
                title={isDefault ? "Default Agent" : "Make Default Agent"}
                disabled={!available}
                class="inline-flex size-7 items-center justify-center rounded-md border border-border bg-muted/15 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary disabled:pointer-events-none disabled:opacity-50"
                onclick={() => {
                    if (!isDefault) {
                        onChooseDefault(agent.agentId);
                    }
                }}
            >
                <Icon icon="lucide:star" class="size-3" />
            </button>
        </div>
    </div>

    <div class="min-h-6">
        {#if agent.availability.reason}
            <p class="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                {agent.availability.reason}
            </p>
        {/if}
    </div>

    <div class="flex items-center justify-between gap-2 border-t pt-2">
        <span
            class={`inline-flex h-6 items-center rounded-full px-2 text-[11px] font-medium ${available ? "bg-emerald-950/30 text-emerald-300" : "bg-rose-950/30 text-rose-300"}`}
        >
            {available ? "Ready" : "Off"}
        </span>
        <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-8 px-3 text-xs"
            disabled={!canTest || running}
            onclick={() => onTestConnection(agent)}
        >
            {testing ? "Testing" : "Test"}
        </Button>
    </div>

    {#if connectionTestState.status === "done" && connectionTestState.agentId === agent.agentId}
        <div
            class={`rounded-md border px-3 py-2 text-xs ${connectionTestState.result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}
        >
            <p class="font-medium">{connectionTestState.result.summary}</p>
            {#if connectionTestState.result.detail}
                <p class="mt-1 line-clamp-3 opacity-90">
                    {connectionTestState.result.detail}
                </p>
            {/if}
            {#if connectionTestState.result.sampleOutput}
                <p class="mt-1 truncate opacity-80">
                    {connectionTestState.result.sampleOutput}
                </p>
            {/if}
        </div>
    {/if}
</article>
