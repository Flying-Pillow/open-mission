<!-- /apps/airport/web/src/routes/+page.svelte: Airport home route with repository management and daemon health summary. -->
<script lang="ts">
    import AirportHeader from "$lib/components/airport/airport-header.svelte";
    import AirportSidebar from "$lib/components/airport/airport-sidebar.svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Input } from "$lib/components/ui/input/index.js";
    import {
        SidebarInset,
        SidebarProvider,
    } from "$lib/components/ui/sidebar/index.js";
    import { enhance } from "$app/forms";

    let { data, form } = $props<{
        data: {
            appContext: {
                daemon: {
                    running: boolean;
                    startedByHook: boolean;
                    message: string;
                    endpointPath?: string;
                    lastCheckedAt: string;
                };
                githubStatus: "connected" | "disconnected" | "unknown";
                user?: {
                    githubStatus: "connected" | "disconnected" | "unknown";
                };
            };
            loginHref: string;
            airportHome: {
                operationalMode?: string;
                controlRoot?: string;
                currentBranch?: string;
                settingsComplete?: boolean;
                selectedRepositoryRoot?: string;
                repositories: Array<{
                    repositoryId: string;
                    repositoryRootPath: string;
                    label: string;
                    description: string;
                    githubRepository?: string;
                }>;
            };
        };
        form?: {
            addRepository?: {
                error?: string;
                success?: boolean;
                repositoryPath?: string;
            };
        };
    }>();
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
    const repositoryCountLabel = $derived(
        data.airportHome.repositories.length === 1
            ? "1 repository registered"
            : `${data.airportHome.repositories.length} repositories registered`,
    );
    const selectedRepository = $derived.by(() =>
        data.airportHome.repositories.find(
            (repository: (typeof data.airportHome.repositories)[number]) =>
                repository.repositoryRootPath ===
                data.airportHome.selectedRepositoryRoot,
        ),
    );

    syncAppContext();

    $effect(() => {
        syncAppContext();
    });

    function syncAppContext(): void {
        appContext.setRepositories(data.airportHome.repositories);
        appContext.setActiveRepository(
            selectedRepository
                ? {
                      repositoryId: selectedRepository.repositoryId,
                      repositoryRootPath: selectedRepository.repositoryRootPath,
                  }
                : undefined,
        );
        appContext.setActiveMission(undefined);
        appContext.setActiveMissionOutline(undefined);
        appContext.setActiveMissionSelectedNodeId(undefined);
    }
</script>

<svelte:head>
    <title>Flying-Pillow Mission</title>
    <meta
        name="description"
        content="Airport repository management surface for the Flying-Pillow Mission workspace."
    />
</svelte:head>

<SidebarProvider>
    <AirportSidebar variant="inset" />

    <SidebarInset>
        <AirportHeader />
        <div class="px-4 pb-4 pt-2">
            <div class="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
                <section
                    class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
                >
                    <div
                        class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
                    >
                        <div class="grid gap-3 sm:grid-cols-2">
                            <div
                                class="rounded-xl border bg-background/70 px-4 py-3"
                            >
                                <p
                                    class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                                >
                                    Daemon
                                </p>
                                <div class="mt-2 flex items-center gap-2">
                                    <span
                                        class={`inline-flex size-2.5 rounded-full ${daemonStatusTone === "connected" ? "bg-emerald-500" : "bg-rose-500"}`}
                                    ></span>
                                    <p
                                        class="text-sm font-medium text-foreground"
                                    >
                                        {daemonStatusTone === "connected"
                                            ? "Connected"
                                            : "Unavailable"}
                                    </p>
                                </div>
                                <p class="mt-1 text-sm text-muted-foreground">
                                    {appContext.daemon.message}
                                </p>
                            </div>
                            <div
                                class="rounded-xl border bg-background/70 px-4 py-3"
                            >
                                <p
                                    class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                                >
                                    GitHub
                                </p>
                                <div class="mt-2 flex items-center gap-2">
                                    <span
                                        class={`inline-flex size-2.5 rounded-full ${githubStatusTone === "connected" ? "bg-emerald-500" : githubStatusTone === "disconnected" ? "bg-amber-500" : "bg-slate-400"}`}
                                    ></span>
                                    <p
                                        class="text-sm font-medium text-foreground"
                                    >
                                        {githubAccountLabel}
                                    </p>
                                </div>
                                <p class="mt-1 text-sm text-muted-foreground">
                                    {githubStatusTone === "connected"
                                        ? "GitHub authentication is available for repository-backed workflows."
                                        : "Sign in with GitHub to enable Mission daemon workflows and repository controls."}
                                </p>
                            </div>
                        </div>
                        <Button href={data.loginHref} size="lg">
                            {githubStatusTone === "connected"
                                ? "Manage GitHub login"
                                : "Login with GitHub"}
                        </Button>
                    </div>
                </section>

                <section
                    class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
                >
                    <div class="flex items-start justify-between gap-4">
                        <div>
                            <p
                                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                            >
                                Airport Home
                            </p>
                            <h2
                                class="mt-2 text-lg font-semibold text-foreground"
                            >
                                Repository management
                            </h2>
                            <p class="mt-1 text-sm text-muted-foreground">
                                Register local repositories so Airport can
                                project missions, artifacts, and agent sessions
                                from the daemon.
                            </p>
                        </div>
                        {#if data.airportHome.operationalMode}
                            <Badge variant="outline"
                                >{data.airportHome.operationalMode}</Badge
                            >
                        {/if}
                    </div>

                    <div class="mt-4 grid gap-3 sm:grid-cols-2">
                        <div
                            class="rounded-xl border bg-background/70 px-4 py-3"
                        >
                            <p
                                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                            >
                                Workspace
                            </p>
                            <p class="mt-2 text-sm font-medium text-foreground">
                                {data.airportHome.controlRoot ?? "Unavailable"}
                            </p>
                            <p class="mt-1 text-sm text-muted-foreground">
                                {data.airportHome.currentBranch
                                    ? `Current branch: ${data.airportHome.currentBranch}`
                                    : "No repository branch detected yet."}
                            </p>
                        </div>
                        <div
                            class="rounded-xl border bg-background/70 px-4 py-3"
                        >
                            <p
                                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                            >
                                Repositories
                            </p>
                            <p class="mt-2 text-sm font-medium text-foreground">
                                {repositoryCountLabel}
                            </p>
                            <p class="mt-1 text-sm text-muted-foreground">
                                {data.airportHome.settingsComplete === false
                                    ? "Mission setup is incomplete for the current workspace."
                                    : "Airport can use any registered local repository as an active surface."}
                            </p>
                        </div>
                    </div>
                </section>
            </div>

            <div class="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <section
                    class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
                >
                    <div class="flex items-center justify-between gap-4">
                        <div>
                            <h2 class="text-lg font-semibold text-foreground">
                                Registered repositories
                            </h2>
                            <p class="mt-1 text-sm text-muted-foreground">
                                Select a repository here before routing Tower,
                                Briefing Room, and Runway into mission-specific
                                views.
                            </p>
                        </div>
                        <Badge variant="secondary">{repositoryCountLabel}</Badge
                        >
                    </div>

                    <div class="mt-4 grid gap-3">
                        {#if data.airportHome.repositories.length === 0}
                            <div
                                class="rounded-xl border border-dashed bg-background/60 px-4 py-8 text-sm text-muted-foreground"
                            >
                                No repositories are registered yet. Add one from
                                the form to start using Airport as a
                                multi-repository control surface.
                            </div>
                        {:else}
                            {#each data.airportHome.repositories as repository}
                                <article
                                    class="rounded-xl border bg-background/70 px-4 py-4"
                                >
                                    <div
                                        class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
                                    >
                                        <div>
                                            <div
                                                class="flex flex-wrap items-center gap-2"
                                            >
                                                <h3
                                                    class="text-sm font-semibold text-foreground"
                                                >
                                                    {repository.label}
                                                </h3>
                                                {#if repository.repositoryRootPath === data.airportHome.selectedRepositoryRoot}
                                                    <Badge variant="outline"
                                                        >Current</Badge
                                                    >
                                                {/if}
                                                {#if repository.githubRepository}
                                                    <Badge variant="secondary"
                                                        >{repository.githubRepository}</Badge
                                                    >
                                                {/if}
                                            </div>
                                            <p
                                                class="mt-1 text-sm text-muted-foreground"
                                            >
                                                {repository.description}
                                            </p>
                                            <p
                                                class="mt-2 font-mono text-xs text-muted-foreground"
                                            >
                                                {repository.repositoryRootPath}
                                            </p>
                                            <div class="mt-3">
                                                <Button
                                                    href={`/repository/${encodeURIComponent(repository.repositoryId)}`}
                                                    variant="outline"
                                                    size="sm"
                                                >
                                                    Open repository
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </article>
                            {/each}
                        {/if}
                    </div>
                </section>

                <section
                    class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
                >
                    <h2 class="text-lg font-semibold text-foreground">
                        Add repository
                    </h2>
                    <p class="mt-1 text-sm text-muted-foreground">
                        Register a local git working tree so the daemon can
                        expose it through Airport.
                    </p>

                    <form
                        method="POST"
                        action="?/addRepository"
                        use:enhance
                        class="mt-4 grid gap-3"
                    >
                        <div class="grid gap-2">
                            <label
                                class="text-sm font-medium text-foreground"
                                for="repositoryPath"
                            >
                                Repository path
                            </label>
                            <Input
                                id="repositoryPath"
                                name="repositoryPath"
                                placeholder="/workspace/my-repository"
                                value={form?.addRepository?.repositoryPath ??
                                    ""}
                            />
                        </div>

                        {#if form?.addRepository?.error}
                            <p class="text-sm text-rose-600">
                                {form.addRepository.error}
                            </p>
                        {/if}

                        {#if form?.addRepository?.success}
                            <p class="text-sm text-emerald-600">
                                Repository registered: {form.addRepository
                                    .repositoryPath}
                            </p>
                        {/if}

                        <Button type="submit" class="w-full"
                            >Register repository</Button
                        >
                    </form>
                </section>
            </div>
        </div>
    </SidebarInset>
</SidebarProvider>
