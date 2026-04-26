<script lang="ts">
    import ActivityIcon from "@tabler/icons-svelte/icons/activity";
    import BrandGithubIcon from "@tabler/icons-svelte/icons/brand-github";
    import FolderIcon from "@tabler/icons-svelte/icons/folder";
    import PlugConnectedIcon from "@tabler/icons-svelte/icons/plug-connected";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";

    const appContext = getAppContext();
    const daemonStatusTone = $derived(
        appContext.daemon.running ? "connected" : "disconnected",
    );
    const githubStatusTone = $derived(appContext.githubStatus);
    const githubAccountLabel = $derived(
        appContext.user?.name ??
            (githubStatusTone === "connected"
                ? "Authenticated GitHub account"
                : "No authenticated GitHub account"),
    );
    const daemonMessage = $derived(appContext.daemon.message);
    const loginHref = "/login?redirectTo=/airport";
    const githubRepositories = $derived(
        appContext.application.githubRepositoriesState,
    );
    const repositories = $derived(appContext.airport.repositories);
    const repositoryCountLabel = $derived(
        repositories.length === 1
            ? "1 repository registered"
            : `${repositories.length} repositories registered`,
    );
    const githubRepositoryCountLabel = $derived(
        githubRepositories.length === 1
            ? "1 visible GitHub repository"
            : `${githubRepositories.length} visible GitHub repositories`,
    );
    const selectedRepository = $derived.by(() =>
        repositories.find(
            (repository) =>
                repository.repositoryRootPath ===
                appContext.airport.activeRepositoryRootPath,
        ),
    );
    const isGitHubConnected = $derived(githubStatusTone === "connected");
</script>

<section class="rounded-lg border bg-card p-5 shadow-sm">
    <div
        class="grid gap-5 2xl:grid-cols-[minmax(0,1.15fr)_minmax(27rem,0.85fr)]"
    >
        <div class="min-w-0 space-y-4">
            <div class="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Airport</Badge>
                <Badge variant="secondary">{repositoryCountLabel}</Badge>
                <Badge variant="outline">{githubRepositoryCountLabel}</Badge>
            </div>

            <div class="max-w-3xl space-y-2">
                <h1
                    class="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
                >
                    Repository control, ready for mission work.
                </h1>
                <p class="text-sm leading-6 text-muted-foreground">
                    Keep local repositories, GitHub access, and daemon health in
                    one compact operations surface.
                </p>
            </div>

            {#if selectedRepository}
                <div class="rounded-lg border bg-muted/35 p-4">
                    <p
                        class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
                    >
                        Current focus
                    </p>
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                        <p class="text-base font-semibold text-foreground">
                            {selectedRepository.label}
                        </p>
                        {#if selectedRepository.githubRepository}
                            <Badge variant="secondary">
                                {selectedRepository.githubRepository}
                            </Badge>
                        {/if}
                    </div>
                    <p class="mt-2 font-mono text-xs text-muted-foreground">
                        {selectedRepository.repositoryRootPath}
                    </p>
                </div>
            {/if}
        </div>

        <div class="grid gap-3 sm:grid-cols-3 2xl:grid-cols-1">
            <div class="rounded-lg border bg-background p-4 shadow-xs">
                <div class="flex items-center justify-between gap-3">
                    <p
                        class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
                    >
                        Daemon
                    </p>
                    <PlugConnectedIcon class="size-4 text-muted-foreground" />
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
                    <BrandGithubIcon class="size-4 text-muted-foreground" />
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
                    {isGitHubConnected
                        ? "Signed in and ready to browse repositories."
                        : "Sign in to browse repositories faster."}
                </p>
            </div>

            <div class="rounded-lg border bg-background p-4 shadow-xs">
                <div class="flex items-center justify-between gap-3">
                    <p
                        class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
                    >
                        Registered
                    </p>
                    <FolderIcon class="size-4 text-muted-foreground" />
                </div>
                <div class="mt-3 flex items-center gap-2">
                    <ActivityIcon class="size-4 text-primary" />
                    <p class="text-sm font-medium text-foreground">
                        {repositoryCountLabel}
                    </p>
                </div>
                <p class="mt-2 text-sm text-muted-foreground">
                    Local workspaces available to Airport.
                </p>
            </div>

            {#if !isGitHubConnected}
                <Button
                    href={loginHref}
                    size="lg"
                    class="sm:col-span-3 2xl:col-span-1"
                >
                    <BrandGithubIcon class="size-4" />
                    Login with GitHub
                </Button>
            {/if}
        </div>
    </div>
</section>
