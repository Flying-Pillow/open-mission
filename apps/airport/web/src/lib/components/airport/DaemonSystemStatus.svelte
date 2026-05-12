<script lang="ts">
    import Icon from "@iconify/svelte";
    import { app } from "$lib/client/Application.svelte.js";
    import type { SystemState } from "@flying-pillow/mission-core/entities/System/SystemSchema";

    const STATUS_REFRESH_MS = 5_000;

    let { fill = false }: { fill?: boolean } = $props();

    let statusErrorMessage = $state<string | undefined>();
    let systemState = $state<SystemState | undefined>();

    const daemonUptime = $derived(
        systemState ? formatDuration(systemState.daemon.uptimeMs) : "pending",
    );
    const heapUsage = $derived(
        systemState
            ? `${formatBytes(systemState.host.memory.heapUsed)} / ${formatBytes(systemState.host.memory.heapTotal)}`
            : "pending",
    );
    const systemMemoryFree = $derived(
        systemState
            ? `${formatBytes(systemState.host.memory.systemFree)} free`
            : "pending",
    );
    const runtimeSummary = $derived(
        systemState
            ? `${systemState.runtime.loadedMissions} missions, ${systemState.runtime.activeAgentExecutions} agents`
            : "pending",
    );
    const runtimeHealthSummary = $derived(
        systemState
            ? systemState.runtime.reconciliationRequired
                ? `${systemState.runtime.degradedAgentExecutions} degraded, ${systemState.runtime.orphanedRuntimeLeases} orphaned`
                : "runtime reconciled"
            : "Waiting",
    );

    function formatBytes(value: number): string {
        if (!Number.isFinite(value) || value < 0) {
            return "0 B";
        }
        const units = ["B", "KB", "MB", "GB"];
        let unitIndex = 0;
        let nextValue = value;
        while (nextValue >= 1024 && unitIndex < units.length - 1) {
            nextValue /= 1024;
            unitIndex += 1;
        }
        return `${nextValue >= 10 || unitIndex === 0 ? nextValue.toFixed(0) : nextValue.toFixed(1)} ${units[unitIndex]}`;
    }

    function formatDuration(value: number): string {
        const totalSeconds = Math.max(0, Math.floor(value / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m ${totalSeconds % 60}s`;
    }

    async function refreshSystemStatus(): Promise<void> {
        try {
            const response = await fetch("/api/runtime/daemon/status", {
                headers: { accept: "application/json" },
            });
            if (!response.ok) {
                throw new Error(`status ${response.status}`);
            }
            const payload = (await response.json()) as {
                systemState?: SystemState | null;
            };
            systemState = payload.systemState ?? undefined;
            app.setSystemState(systemState);
            statusErrorMessage = systemState
                ? undefined
                : "System status unavailable";
        } catch {
            statusErrorMessage = "System status unavailable";
        }
    }

    $effect(() => {
        void refreshSystemStatus();
        const interval = setInterval(() => {
            void refreshSystemStatus();
        }, STATUS_REFRESH_MS);

        return () => clearInterval(interval);
    });
</script>

<div class={fill ? "mt-3 grid gap-2 px-3" : "mt-3 grid gap-2"}>
    <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div class="border bg-background px-3 py-2">
            <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-medium text-muted-foreground">Daemon</p>
                <Icon
                    icon="lucide:server"
                    class="size-3.5 text-muted-foreground"
                />
            </div>
            <p class="mt-1 truncate text-sm font-medium text-foreground">
                {systemState ? `pid ${systemState.daemon.pid}` : "Pending"}
            </p>
            <p class="mt-0.5 text-xs text-muted-foreground">
                {daemonUptime}
            </p>
        </div>

        <div class="border bg-background px-3 py-2">
            <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-medium text-muted-foreground">Runtime</p>
                <Icon
                    icon="lucide:network"
                    class="size-3.5 text-muted-foreground"
                />
            </div>
            <p class="mt-1 truncate text-sm font-medium text-foreground">
                {runtimeSummary}
            </p>
            <p class="mt-0.5 text-xs text-muted-foreground">
                {runtimeHealthSummary}
            </p>
        </div>

        <div class="border bg-background px-3 py-2">
            <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-medium text-muted-foreground">Host</p>
                <Icon
                    icon="lucide:cpu"
                    class="size-3.5 text-muted-foreground"
                />
            </div>
            <p class="mt-1 truncate text-sm font-medium text-foreground">
                {systemState
                    ? `${systemState.host.platform}/${systemState.host.arch}`
                    : "Pending"}
            </p>
            <p class="mt-0.5 text-xs text-muted-foreground">
                load {systemState?.host.loadAverage[0]?.toFixed(2) ?? "-"}
            </p>
        </div>

        <div class="border bg-background px-3 py-2">
            <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-medium text-muted-foreground">Memory</p>
                <Icon
                    icon="lucide:memory-stick"
                    class="size-3.5 text-muted-foreground"
                />
            </div>
            <p class="mt-1 truncate text-sm font-medium text-foreground">
                {heapUsage}
            </p>
            <p class="mt-0.5 text-xs text-muted-foreground">
                {systemMemoryFree}
            </p>
        </div>
    </div>
    {#if statusErrorMessage}
        <p class="text-xs text-amber-600">{statusErrorMessage}</p>
    {/if}
</div>
