<script lang="ts">
    import { onDestroy } from "svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import DaemonLogTail from "$lib/components/airport/DaemonLogTail.svelte";
    import AirportHeader from "$lib/components/airport/airport-header.svelte";
    import AirportSidebar from "$lib/components/airport/airport-sidebar.svelte";
    import {
        ResizableHandle,
        ResizablePane,
        ResizablePaneGroup,
    } from "$lib/components/ui/resizable";
    import {
        SidebarInset,
        SidebarProvider,
    } from "$lib/components/ui/sidebar/index.js";
    import type { Snippet } from "svelte";

    let { children }: { children: Snippet } = $props();
    const appContext = getAppContext();
    let daemonLogsOpen = $state(false);
    let sidebarOpen = $state(false);

    onDestroy(() => {
        appContext.application.clearAirportSelection();
    });
</script>

<SidebarProvider
    bind:open={sidebarOpen}
    class="has-data-[variant=inset]:bg-background"
    style="--sidebar-width: 19rem; --sidebar-width-mobile: 20rem; --sidebar-width-icon: 5rem;"
>
    <AirportSidebar variant="inset" />

    <SidebarInset
        class="min-h-0 overflow-hidden h-svh md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:my-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-0"
    >
        <AirportHeader bind:daemonLogsOpen />
        <ResizablePaneGroup
            direction="horizontal"
            autoSaveId="airport-shell"
            class="min-h-0 flex-1 overflow-hidden"
        >
            <ResizablePane
                defaultSize={76}
                minSize={48}
                class="flex h-full min-h-0 flex-col overflow-hidden"
            >
                {@render children()}
            </ResizablePane>

            {#if daemonLogsOpen}
                <ResizableHandle withHandle />

                <ResizablePane
                    defaultSize={24}
                    minSize={18}
                    maxSize={44}
                    class="flex h-full min-h-0 flex-col border-l bg-card/40"
                >
                    <div class="min-h-0 flex-1 overflow-hidden border bg-card">
                        <DaemonLogTail initiallyEnabled embedded fill />
                    </div>
                </ResizablePane>
            {/if}
        </ResizablePaneGroup>
    </SidebarInset>
</SidebarProvider>
