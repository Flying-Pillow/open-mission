<script lang="ts">
    import Icon from "@iconify/svelte";
    import NavUser from "$lib/components/nav-user.svelte";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import { getAppContext } from "$lib/client/context/app-context.svelte";

    const app = getAppContext();

    const missionRepositoryUrl = "https://github.com/Flying-Pillow/mission";

    const daemonBadge = $derived.by(() => ({
        label: app.daemon.running ? "Daemon online" : "Daemon offline",
        detail: app.daemon.running ? "Connected" : app.daemon.message,
        className: app.daemon.running ? "text-emerald-600" : "text-red-600",
    }));
</script>

<header
    class="flex-none flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)"
>
    <div class="flex w-full items-center gap-2 px-4 lg:px-6">
        <Sidebar.Trigger class="-ml-1" />
        <Separator
            orientation="vertical"
            class="mx-2 data-[orientation=vertical]:h-4"
        />
        <div class="min-w-0">
            <p
                class="text-muted-foreground text-[0.7rem] font-medium uppercase tracking-[0.25em]"
            >
                Flying-Pillow
            </p>
            <h1 class="truncate text-sm font-semibold sm:text-base">Mission</h1>
        </div>
        <div class="ms-auto flex items-center gap-2">
            <div class="hidden items-center gap-2 lg:flex">
                <span
                    class={`inline-flex size-9 items-center justify-center rounded-full ${daemonBadge.className}`}
                    aria-label={daemonBadge.label}
                    title={daemonBadge.detail}
                >
                    {#if app.daemon.running}
                        <Icon icon="lucide:plug" class="size-4" />
                    {:else}
                        <Icon icon="lucide:unplug" class="size-4" />
                    {/if}
                </span>
            </div>
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
            <div class="w-56 max-w-[calc(100vw-8rem)]">
                <NavUser contentSide="bottom" />
            </div>
        </div>
    </div>
</header>
