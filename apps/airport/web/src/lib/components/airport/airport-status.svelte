<script lang="ts">
    import Icon from "@iconify/svelte";
    import { app } from "$lib/client/Application.svelte.js";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";

    const appContext = getAppContext();
    const daemonStatusTone = $derived(
        appContext.daemon.running ? "connected" : "disconnected",
    );
    const githubStatusTone = $derived(
        app.system?.github.authenticated
            ? "connected"
            : appContext.githubStatus,
    );
    const githubAccountLabel = $derived(
        app.system?.github.user ??
            appContext.user?.name ??
            (githubStatusTone === "connected"
                ? "Authenticated GitHub account"
                : "No authenticated GitHub account"),
    );
    const daemonMessage = $derived(appContext.daemon.message);
    const loginHref = "/login?redirectTo=/airport";
    const isGitHubConnected = $derived(githubStatusTone === "connected");
    const systemDetail = $derived(
        app.system?.github.detail ?? "Daemon system status is pending.",
    );
</script>

<section class="rounded-lg border bg-card p-5 shadow-sm">
    <div
        class="grid gap-5 2xl:grid-cols-[minmax(0,1.15fr)_minmax(27rem,0.85fr)]"
    >
        <div class="min-w-0 space-y-4">
            <div class="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Airport</Badge>
                <Badge variant="secondary">
                    {appContext.daemon.running
                        ? "Daemon connected"
                        : "Daemon unavailable"}
                </Badge>
                <Badge variant="outline">
                    {app.system
                        ? "System schema loaded"
                        : "System schema pending"}
                </Badge>
            </div>

            <div class="max-w-3xl space-y-2">
                <h1
                    class="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
                >
                    Airport surface connected to daemon authority.
                </h1>
                <p class="text-sm leading-6 text-muted-foreground">
                    Daemon health and system identity are loaded from the
                    authoritative runtime boundary.
                </p>
            </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-3 2xl:grid-cols-1">
            <div class="rounded-lg border bg-background p-4 shadow-xs">
                <div class="flex items-center justify-between gap-3">
                    <p
                        class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
                    >
                        Daemon
                    </p>
                    <Icon
                        icon="lucide:plug"
                        class="size-4 text-muted-foreground"
                    />
                </div>
                <div class="mt-3 flex items-center gap-2">
                    <span
                        class={`inline-flex size-2.5 rounded-full ${daemonStatusTone === "connected" ? "bg-emerald-500" : "bg-rose-500"}`}
                    ></span>
                    <p class="text-sm font-medium text-foreground">
                        {daemonStatusTone === "connected"
                            ? "Connected"
                            : "Unavailable"}
                    </p>
                </div>
                <p class="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {daemonMessage}
                </p>
            </div>

            <div class="rounded-lg border bg-background p-4 shadow-xs">
                <div class="flex items-center justify-between gap-3">
                    <p
                        class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
                    >
                        GitHub
                    </p>
                    <Icon
                        icon="lucide:github"
                        class="size-4 text-muted-foreground"
                    />
                </div>
                <div class="mt-3 flex items-center gap-2">
                    <span
                        class={`inline-flex size-2.5 rounded-full ${githubStatusTone === "connected" ? "bg-emerald-500" : githubStatusTone === "disconnected" ? "bg-amber-500" : "bg-slate-400"}`}
                    ></span>
                    <p
                        class="min-w-0 truncate text-sm font-medium text-foreground"
                    >
                        {githubAccountLabel}
                    </p>
                </div>
                <p class="mt-2 text-sm text-muted-foreground">
                    {systemDetail}
                </p>
            </div>

            <div class="rounded-lg border bg-background p-4 shadow-xs">
                <div class="flex items-center justify-between gap-3">
                    <p
                        class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
                    >
                        System
                    </p>
                    <Icon
                        icon="lucide:server"
                        class="size-4 text-muted-foreground"
                    />
                </div>
                <div class="mt-3 flex items-center gap-2">
                    <Icon icon="lucide:activity" class="size-4 text-primary" />
                    <p class="text-sm font-medium text-foreground">
                        {app.system ? "Schema available" : "Waiting"}
                    </p>
                </div>
                <p class="mt-2 text-sm text-muted-foreground">
                    The Airport route is reading daemon-owned system state.
                </p>
            </div>

            {#if !isGitHubConnected}
                <Button
                    href={loginHref}
                    size="lg"
                    class="sm:col-span-3 2xl:col-span-1"
                >
                    <Icon icon="lucide:github" class="size-4" />
                    Login with GitHub
                </Button>
            {/if}
        </div>
    </div>
</section>
