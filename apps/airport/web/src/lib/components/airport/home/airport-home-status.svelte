<script lang="ts">
    import { goto } from "$app/navigation";
    import BrandGithubIcon from "@tabler/icons-svelte/icons/brand-github";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";

    const appContext = getAppContext();
    const airportHomeState = $derived(appContext.application.airportHomeState);
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
    const loginHref = $derived(
        airportHomeState?.loginHref ?? "/login?redirectTo=/airport",
    );
    const githubRepositories = $derived(
        appContext.application.githubRepositoriesState,
    );
    const repositories = $derived(
        airportHomeState?.airportHome.repositories ?? [],
    );
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
                airportHomeState?.airportHome.selectedRepositoryRoot,
        ),
    );
    const isGitHubConnected = $derived(githubStatusTone === "connected");
    let logoutPending = $state(false);

    async function handleLogout(): Promise<void> {
        logoutPending = true;

        try {
            await goto(await appContext.application.logout());
        } finally {
            logoutPending = false;
        }
    }
</script>

<section
    class="relative overflow-hidden rounded-[2rem] border bg-card/80 p-6 backdrop-blur-sm"
>
    <div
        class="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.12),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.14),transparent_30%)]"
    ></div>
    <div class="relative grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div class="space-y-4">
            <div class="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Airport home</Badge>
                <Badge variant="secondary">{repositoryCountLabel}</Badge>
                <Badge variant="outline">{githubRepositoryCountLabel}</Badge>
            </div>

            <div class="max-w-2xl space-y-3">
                <h1
                    class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
                >
                    Get your missions ready in a few clicks.
                </h1>
                <p class="text-sm leading-6 text-muted-foreground sm:text-base">
                    Connect GitHub, add a local repository, and jump back into
                    work without digging through setup screens.
                </p>
            </div>

            {#if selectedRepository}
                <div class="rounded-3xl border bg-background/70 p-4 shadow-sm">
                    <p
                        class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground"
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

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
            <div class="rounded-3xl border bg-background/75 p-4 shadow-sm">
                <p
                    class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                >
                    Daemon
                </p>
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
                <p class="mt-2 text-sm text-muted-foreground">
                    {daemonMessage}
                </p>
            </div>

            <div class="rounded-3xl border bg-background/75 p-4 shadow-sm">
                <p
                    class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                >
                    GitHub
                </p>
                <div class="mt-3 flex items-center gap-2">
                    <span
                        class={`inline-flex size-2.5 rounded-full ${githubStatusTone === "connected" ? "bg-emerald-500" : githubStatusTone === "disconnected" ? "bg-amber-500" : "bg-slate-400"}`}
                    ></span>
                    <p class="text-sm font-medium text-foreground">
                        {githubAccountLabel}
                    </p>
                </div>
                <p class="mt-2 text-sm text-muted-foreground">
                    {isGitHubConnected
                        ? "You're signed in and ready to pick a repository."
                        : "Sign in with GitHub to browse your repos and add one faster."}
                </p>

                <div class="mt-4">
                    {#if isGitHubConnected}
                        <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            class="w-full justify-center"
                            disabled={logoutPending}
                            onclick={() => {
                                void handleLogout();
                            }}
                        >
                            {logoutPending ? "Logging out..." : "Log out"}
                        </Button>
                    {:else}
                        <Button
                            href={loginHref}
                            size="lg"
                            class="w-full justify-center"
                        >
                            <BrandGithubIcon class="size-4" />
                            Login with GitHub
                        </Button>
                    {/if}
                </div>
            </div>
        </div>
    </div>
</section>
