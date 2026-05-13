<script lang="ts">
    import Icon from "@iconify/svelte";
    import AirportContextToolbar from "$lib/components/airport/airport-context-toolbar.svelte";
    import NavUser from "$lib/components/nav-user.svelte";
    import AirportNotificationsBell from "$lib/components/airport/airport-notifications-bell.svelte";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import { app } from "$lib/client/Application.svelte.js";
    import { getAppContext } from "$lib/client/context/app-context.svelte";

    let { daemonLogsOpen = $bindable(false) } = $props();

    const context = getAppContext();

    const missionRepositoryUrl =
        "https://github.com/Flying-Pillow/open-mission";
    const hasActiveContext = $derived(Boolean(app.mission || app.repository));

    const daemonBadge = $derived.by(() => ({
        label: context.daemon.running ? "Daemon online" : "Daemon offline",
        detail: context.daemon.running ? "Connected" : context.daemon.message,
        className: context.daemon.running ? "text-emerald-600" : "text-red-600",
    }));
</script>

<header
    class="flex-none flex h-(--header-height) shrink-0 items-center gap-2 pt-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)"
>
    <div class="flex w-full items-center gap-2 px-4 lg:px-5 py-2">
        <Sidebar.Trigger class="pr-18" />
        {#if hasActiveContext}
            <AirportContextToolbar />
        {:else}
            <div class="min-w-0">
                <p
                    class="text-muted-foreground text-[0.7rem] font-medium uppercase tracking-[0.25em]"
                >
                    Flying-Pillow
                </p>
                <h1 class="truncate text-sm font-semibold sm:text-base">
                    Mission
                </h1>
            </div>
        {/if}
        <div class="ms-auto flex items-center gap-2">
            <button
                type="button"
                class={`inline-flex size-9 items-center justify-center rounded-full border border-transparent transition-colors hover:border-border hover:bg-muted/60 ${daemonLogsOpen ? "bg-muted/80" : ""} ${daemonBadge.className}`}
                aria-pressed={daemonLogsOpen}
                aria-label={`${daemonBadge.label}. ${daemonLogsOpen ? "Hide" : "Show"} daemon logs`}
                title={`${daemonBadge.detail}. ${daemonLogsOpen ? "Hide" : "Show"} daemon logs.`}
                onclick={() => {
                    daemonLogsOpen = !daemonLogsOpen;
                }}
            >
                {#if context.daemon.running}
                    <Icon icon="lucide:plug" class="size-4" />
                {:else}
                    <Icon icon="lucide:unplug" class="size-4" />
                {/if}
            </button>
            <AirportNotificationsBell />
            <a
                href={missionRepositoryUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open the Mission GitHub repository"
                title="Open Mission on GitHub"
                class="text-muted-foreground hover:text-foreground inline-flex size-9 items-center justify-center rounded-full border border-transparent transition-colors hover:border-border hover:bg-muted/60"
            >
                <Icon icon="lucide:github" class="size-4" />
            </a>
            <NavUser avatarOnly contentSide="bottom" />
        </div>
    </div>
</header>
