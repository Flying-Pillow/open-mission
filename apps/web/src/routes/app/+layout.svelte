<script lang="ts">
    import { page } from "$app/state";
    import { onMount } from "svelte";
    import { onDestroy } from "svelte";
    import { app } from "$lib/client/Application.svelte.js";
    import {
        createAppContext,
        setAppContext,
    } from "$lib/client/context/app-context.svelte";
    import DaemonLogTail from "$lib/components/app-shell/DaemonLogTail.svelte";
    import AppHeader from "$lib/components/app-shell/app-header.svelte";
    import AppSidebar from "$lib/components/app-shell/app-sidebar.svelte";
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
    import type { LayoutData } from "./$types";

    let { data, children }: { data: LayoutData; children: Snippet } = $props();
    let daemonLogsOpen = $state(false);
    let sidebarOpen = $state(false);

    const appContext = createAppContext(() => ({
        ...data.appContext,
        systemState: data.systemState,
    }));
    setAppContext(appContext);

    onMount(() => {
        void (async () => {
            await app.initialize();
            await app.loadAppRepositories();
        })().catch(() => undefined);
    });

    onDestroy(() => {
        app.clearAppSelection();
    });

    $effect(() => {
        appContext.syncServerContext({
            ...data.appContext,
            systemState: data.systemState,
        });
    });
</script>

<SidebarProvider
    bind:open={sidebarOpen}
    class="has-data-[variant=inset]:bg-background"
    style="--sidebar-width: 19rem; --sidebar-width-mobile: 20rem; --sidebar-width-icon: 5rem;"
>
    <AppSidebar variant="inset" />

    <SidebarInset
        class="min-h-0 overflow-hidden h-svh md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:my-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-0"
    >
        <AppHeader bind:daemonLogsOpen />
        <ResizablePaneGroup
            direction="horizontal"
            autoSaveId="app-shell"
            class="min-h-0 flex-1 overflow-hidden"
        >
            <ResizablePane
                defaultSize={76}
                minSize={48}
                class="flex h-full min-h-0 flex-col overflow-hidden"
            >
                {#key page.url.pathname}
                    {@render children()}
                {/key}
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
