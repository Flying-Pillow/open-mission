<script lang="ts">
    import { asset } from "$app/paths";
    import BrandGithubIcon from "@tabler/icons-svelte/icons/brand-github";
    import PlugConnectedIcon from "@tabler/icons-svelte/icons/plug-connected";
    import PlugConnectedXIcon from "@tabler/icons-svelte/icons/plug-connected-x";
    import * as Avatar from "$lib/components/ui/avatar/index.js";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import { getAppContext } from "$lib/client/context/app-context.svelte";

    const app = getAppContext();

    type GithubStatus = "connected" | "disconnected" | "unknown";

    const fallbackAvatar = asset("/logo.png");
    const missionRepositoryUrl = "https://github.com/Flying-Pillow/mission";

    const headerIdentity = $derived.by(() => ({
        name: app.user?.name ?? "Mission Operator",
        avatar: app.user?.avatarUrl ?? fallbackAvatar,
    }));

    const daemonBadge = $derived.by(() => ({
        label: app.daemon.running ? "Daemon online" : "Daemon offline",
        detail: app.daemon.running ? "Connected" : app.daemon.message,
        className: app.daemon.running
            ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
            : "border-amber-200/80 bg-amber-50 text-amber-700",
    }));

    const githubBadge = $derived.by(() => ({
        label:
            app.githubStatus === "connected"
                ? "GitHub connected"
                : app.githubStatus === "disconnected"
                  ? "GitHub disconnected"
                  : "GitHub unknown",
        className:
            app.githubStatus === "connected"
                ? "border-sky-200/80 bg-sky-50 text-sky-700"
                : "border-zinc-200/80 bg-zinc-50 text-zinc-700",
    }));

    const userInitials = $derived.by(
        () =>
            headerIdentity.name
                .split(/[^A-Za-z0-9]+/u)
                .filter((segment) => segment.length > 0)
                .slice(0, 2)
                .map((segment) => segment[0]?.toUpperCase() ?? "")
                .join("") || "FP",
    );
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
                <div
                    class={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${daemonBadge.className}`}
                    title={daemonBadge.detail}
                >
                    {#if app.daemon.running}
                        <PlugConnectedIcon class="size-3.5" />
                    {:else}
                        <PlugConnectedXIcon class="size-3.5" />
                    {/if}
                    <span>{daemonBadge.label}</span>
                </div>
                <div
                    class={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${githubBadge.className}`}
                >
                    <BrandGithubIcon class="size-3.5" />
                    <span>{githubBadge.label}</span>
                </div>
            </div>
            <a
                href={missionRepositoryUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open the Mission GitHub repository"
                title="Open Mission on GitHub"
                class="text-muted-foreground hover:text-foreground inline-flex size-9 items-center justify-center rounded-full border border-transparent transition-colors hover:border-border hover:bg-muted/60"
            >
                <BrandGithubIcon class="size-4" />
            </a>
            {#if app.user}
                <div
                    class="flex items-center gap-3 rounded-full border bg-background/80 px-2.5 py-1.5"
                >
                    <Avatar.Root class="size-8 overflow-hidden rounded-full">
                        <Avatar.Image
                            src={headerIdentity.avatar}
                            alt={headerIdentity.name}
                        />
                        <Avatar.Fallback
                            class="rounded-full text-xs font-medium"
                        >
                            {userInitials}
                        </Avatar.Fallback>
                    </Avatar.Root>
                    <div class="hidden min-w-0 sm:block">
                        <p class="truncate text-sm font-medium text-foreground">
                            {headerIdentity.name}
                        </p>
                        <p class="truncate text-xs text-muted-foreground">
                            {githubBadge.label}
                        </p>
                    </div>
                    <form method="POST" action="?/logout">
                        <button
                            type="submit"
                            class="inline-flex h-9 items-center rounded-full border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
                        >
                            Log out
                        </button>
                    </form>
                </div>
            {:else}
                <a
                    href="/login?redirectTo=/airport"
                    class="inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
                >
                    Sign in with GitHub
                </a>
            {/if}
        </div>
    </div>
</header>
