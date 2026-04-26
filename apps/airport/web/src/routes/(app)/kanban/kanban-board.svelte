<script lang="ts">
    import { onMount } from "svelte";
    import AlertCircleIcon from "@tabler/icons-svelte/icons/alert-circle";
    import BrandGithubIcon from "@tabler/icons-svelte/icons/brand-github";
    import CalendarIcon from "@tabler/icons-svelte/icons/calendar";
    import ExternalLinkIcon from "@tabler/icons-svelte/icons/external-link";
    import FolderIcon from "@tabler/icons-svelte/icons/folder";
    import GitBranchIcon from "@tabler/icons-svelte/icons/git-branch";
    import LayoutKanbanIcon from "@tabler/icons-svelte/icons/layout-kanban";
    import RefreshIcon from "@tabler/icons-svelte/icons/refresh";
    import RocketIcon from "@tabler/icons-svelte/icons/rocket";
    import SearchIcon from "@tabler/icons-svelte/icons/search";
    import TicketIcon from "@tabler/icons-svelte/icons/ticket";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Input } from "$lib/components/ui/input/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import type {
        IssueSummary,
        MissionSummary,
        SidebarRepositorySummary,
    } from "$lib/components/entities/types";

    type BoardRepository = SidebarRepositorySummary & {
        missions: MissionSummary[];
        issues: IssueSummary[];
        issueError?: string;
    };

    type BoardMission = MissionSummary & {
        repositoryId: string;
        repositoryLabel: string;
        githubRepository?: string;
    };

    type BoardIssue = IssueSummary & {
        repositoryId: string;
        repositoryLabel: string;
        githubRepository?: string;
    };

    type BoardLane = {
        id: string;
        title: string;
        metric: string;
        tone: "sky" | "emerald" | "amber" | "rose";
        items: Array<BoardIssue | BoardMission | BoardRepository>;
    };

    const appContext = getAppContext();

    let repositories = $state<BoardRepository[]>([]);
    let generatedAt = $state<string | null>(null);
    let boardLoading = $state(true);
    let boardLoadError = $state<string | null>(null);
    let searchQuery = $state("");

    onMount(() => {
        void loadBoardData();
    });

    const normalizedSearch = $derived(searchQuery.trim().toLowerCase());

    const missions = $derived.by<BoardMission[]>(() => {
        return repositories.flatMap((repository) =>
            repository.missions.map((mission) => ({
                ...mission,
                repositoryId: repository.repositoryId,
                repositoryLabel: repository.label,
                ...(repository.githubRepository
                    ? { githubRepository: repository.githubRepository }
                    : {}),
            })),
        );
    });

    const issues = $derived.by<BoardIssue[]>(() => {
        return repositories.flatMap((repository) =>
            repository.issues.map((issue) => ({
                ...issue,
                repositoryId: repository.repositoryId,
                repositoryLabel: repository.label,
                ...(repository.githubRepository
                    ? { githubRepository: repository.githubRepository }
                    : {}),
            })),
        );
    });

    const issueBackedMissions = $derived(
        missions.filter((mission) => typeof mission.issueId === "number"),
    );
    const briefMissions = $derived(
        missions.filter((mission) => typeof mission.issueId !== "number"),
    );
    const issueErrors = $derived(
        repositories.filter((repository) => repository.issueError),
    );
    const totalCards = $derived(
        repositories.length + missions.length + issues.length,
    );
    const lastSyncedLabel = $derived(
        generatedAt ? new Date(generatedAt).toLocaleTimeString() : "Pending",
    );

    const lanes = $derived<BoardLane[]>([
        {
            id: "repositories",
            title: "Repositories",
            metric: `${repositories.length}`,
            tone: "sky",
            items: repositories,
        },
        {
            id: "issues",
            title: "Tracked Issues",
            metric: `${issues.length}`,
            tone: "rose",
            items: issues,
        },
        {
            id: "issue-missions",
            title: "Issue Missions",
            metric: `${issueBackedMissions.length}`,
            tone: "emerald",
            items: issueBackedMissions,
        },
        {
            id: "brief-missions",
            title: "Brief Missions",
            metric: `${briefMissions.length}`,
            tone: "amber",
            items: briefMissions,
        },
    ]);
    const visibleLanes = $derived(
        lanes
            .map((lane) => ({
                ...lane,
                items: lane.items.filter((item) => matchesSearch(item)),
            }))
            .filter((lane) => lane.items.length > 0 || !normalizedSearch),
    );

    async function loadBoardData(): Promise<void> {
        boardLoading = true;
        boardLoadError = null;

        try {
            await appContext.application.initialize();
            const summaries = appContext.airport.repositories;

            repositories = summaries.map((repository) => ({
                ...repository,
                missions: repository.missions ?? [],
                issues: [],
            }));

            repositories = await Promise.all(
                summaries.map(async (summary): Promise<BoardRepository> => {
                    const repository = appContext.application.resolveRepository(summary.repositoryId)
                        ?? appContext.application.seedRepositoryFromSummary(summary);

                    try {
                        return {
                            ...summary,
                            missions: summary.missions ?? [],
                            issues: await repository.listIssues(),
                        };
                    } catch (error) {
                        return {
                            ...summary,
                            missions: summary.missions ?? [],
                            issues: [],
                            issueError: error instanceof Error ? error.message : String(error),
                        };
                    }
                }),
            );

            generatedAt = new Date().toISOString();
            appContext.setActiveRepository(undefined);
            appContext.setActiveMission(undefined);
            appContext.setActiveMissionOutline(undefined);
            appContext.setActiveMissionSelectedNodeId(undefined);
        } catch (error) {
            repositories = [];
            boardLoadError = error instanceof Error ? error.message : String(error);
        } finally {
            boardLoading = false;
        }
    }

    function matchesSearch(item: BoardIssue | BoardMission | BoardRepository): boolean {
        if (!normalizedSearch) {
            return true;
        }

        return getSearchText(item).includes(normalizedSearch);
    }

    function getSearchText(item: BoardIssue | BoardMission | BoardRepository): string {
        if ("number" in item) {
            return [
                item.title,
                item.repositoryLabel,
                String(item.number),
                item.labels.join(" "),
                item.assignees.join(" "),
            ].join(" ").toLowerCase();
        }

        if ("missionId" in item) {
            return [
                item.title,
                item.repositoryLabel,
                item.missionId,
                item.branchRef,
                item.issueId ? `#${item.issueId}` : "",
            ].join(" ").toLowerCase();
        }

        return [
            item.label,
            item.description,
            item.repositoryRootPath,
            item.githubRepository ?? "",
        ].join(" ").toLowerCase();
    }

    function formatDate(value: string | undefined): string {
        if (!value) {
            return "Unknown";
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
    }

    function getRepositoryUrl(repository: string | undefined): string | undefined {
        return repository?.trim()
            ? `https://github.com/${repository.trim()}`
            : undefined;
    }

    function getToneClasses(tone: BoardLane["tone"]): string {
        return {
            sky: "border-sky-300/60 bg-sky-500/10 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200",
            emerald: "border-emerald-300/60 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
            amber: "border-amber-300/60 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
            rose: "border-rose-300/60 bg-rose-500/10 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200",
        }[tone];
    }
</script>

<section class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
    <div
        class="relative isolate border-b bg-[linear-gradient(135deg,hsl(var(--background))_0%,hsl(var(--muted))_52%,hsl(var(--background))_100%)] px-4 py-4 lg:px-6"
    >
        <div
            class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:items-end"
        >
            <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span class="inline-flex size-9 items-center justify-center rounded-lg border bg-background shadow-sm">
                        <LayoutKanbanIcon class="size-5 text-foreground" />
                    </span>
                    <span>Mission Kanban</span>
                    <Badge variant="outline">{totalCards} cards</Badge>
                    {#if issueErrors.length > 0}
                        <Badge variant="destructive">
                            {issueErrors.length} issue feed {issueErrors.length === 1 ? "warning" : "warnings"}
                        </Badge>
                    {/if}
                </div>
                <h1 class="mt-3 text-3xl font-semibold text-foreground md:text-4xl">
                    Every repository, mission, and issue in one command surface.
                </h1>
            </div>

            <div class="grid gap-3 rounded-lg border bg-background/80 p-3 shadow-sm backdrop-blur">
                <div class="grid grid-cols-3 gap-2 text-center">
                    <div class="rounded-lg border bg-muted/30 p-3">
                        <p class="text-2xl font-semibold text-foreground">{repositories.length}</p>
                        <p class="text-xs text-muted-foreground">Repos</p>
                    </div>
                    <div class="rounded-lg border bg-muted/30 p-3">
                        <p class="text-2xl font-semibold text-foreground">{missions.length}</p>
                        <p class="text-xs text-muted-foreground">Missions</p>
                    </div>
                    <div class="rounded-lg border bg-muted/30 p-3">
                        <p class="text-2xl font-semibold text-foreground">{issues.length}</p>
                        <p class="text-xs text-muted-foreground">Issues</p>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="relative min-w-0 flex-1">
                        <SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            bind:value={searchQuery}
                            class="h-9 pl-9"
                            placeholder="Filter board"
                        />
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Refresh Kanban board"
                        title="Refresh Kanban board"
                        disabled={boardLoading}
                        onclick={() => void loadBoardData()}
                    >
                        <RefreshIcon class={`size-4 ${boardLoading ? "animate-spin" : ""}`} />
                    </Button>
                </div>
                <p class="text-xs text-muted-foreground">Synced {lastSyncedLabel}</p>
            </div>
        </div>
    </div>

    {#if boardLoading && repositories.length === 0}
        <div class="grid flex-1 place-items-center bg-muted/20 p-6">
            <div class="w-full max-w-md rounded-lg border bg-card p-5 shadow-sm">
                <div class="flex items-center gap-3">
                    <RefreshIcon class="size-5 animate-spin text-muted-foreground" />
                    <p class="text-sm font-medium text-foreground">Loading Kanban board...</p>
                </div>
            </div>
        </div>
    {:else if boardLoadError}
        <div class="grid flex-1 place-items-center bg-muted/20 p-6">
            <div class="w-full max-w-xl rounded-lg border bg-card p-5 shadow-sm">
                <div class="flex items-start gap-3">
                    <AlertCircleIcon class="mt-0.5 size-5 text-rose-600" />
                    <div>
                        <h2 class="text-lg font-semibold text-foreground">Kanban unavailable</h2>
                        <p class="mt-2 text-sm text-rose-600">{boardLoadError}</p>
                    </div>
                </div>
            </div>
        </div>
    {:else}
        <div class="min-h-0 flex-1 bg-muted/20 p-3 lg:p-4">
            <ScrollArea class="h-full rounded-lg border bg-background/75 shadow-sm">
                <div class="grid min-w-[78rem] grid-cols-4 gap-3 p-3 xl:min-w-0">
                    {#each visibleLanes as lane (lane.id)}
                        <section class="flex min-h-[34rem] flex-col rounded-lg border bg-card/80 shadow-sm">
                            <header class="border-b p-3">
                                <div class="flex items-center justify-between gap-3">
                                    <h2 class="truncate text-sm font-semibold text-foreground">
                                        {lane.title}
                                    </h2>
                                    <span class={`inline-flex min-w-8 items-center justify-center rounded-lg border px-2 py-1 text-xs font-semibold ${getToneClasses(lane.tone)}`}>
                                        {lane.metric}
                                    </span>
                                </div>
                            </header>

                            <div class="grid flex-1 content-start gap-3 p-3">
                                {#if lane.items.length === 0}
                                    <div class="rounded-lg border border-dashed bg-background/70 p-4 text-sm text-muted-foreground">
                                        Nothing is waiting here right now.
                                    </div>
                                {:else}
                                    {#each lane.items as item (`${lane.id}:${"repositoryId" in item ? item.repositoryId : ""}:${"missionId" in item ? item.missionId : ""}:${"number" in item ? item.number : ""}`)}
                                        {#if "number" in item}
                                            <article class="group rounded-lg border bg-background p-3 shadow-xs transition hover:-translate-y-0.5 hover:border-rose-300 hover:shadow-md dark:hover:border-rose-400/40">
                                                <div class="flex items-start justify-between gap-3">
                                                    <div class="min-w-0">
                                                        <div class="flex items-center gap-2 text-xs text-muted-foreground">
                                                            <TicketIcon class="size-4 text-rose-500" />
                                                            <span class="truncate">{item.repositoryLabel}</span>
                                                        </div>
                                                        <h3 class="mt-2 line-clamp-3 text-sm font-semibold leading-5 text-foreground">
                                                            #{item.number} {item.title}
                                                        </h3>
                                                    </div>
                                                    <Button
                                                        href={item.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        aria-label={`Open issue ${item.number}`}
                                                        title="Open issue"
                                                    >
                                                        <ExternalLinkIcon class="size-4" />
                                                    </Button>
                                                </div>
                                                <div class="mt-3 flex flex-wrap gap-1.5">
                                                    {#each item.labels.slice(0, 4) as label (`${item.repositoryId}:${item.number}:${label}`)}
                                                        <Badge variant="secondary">{label}</Badge>
                                                    {/each}
                                                </div>
                                                <p class="mt-3 text-xs text-muted-foreground">
                                                    Updated {formatDate(item.updatedAt)}
                                                </p>
                                            </article>
                                        {:else if "missionId" in item}
                                            <article class="group rounded-lg border bg-background p-3 shadow-xs transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md dark:hover:border-emerald-400/40">
                                                <div class="flex items-start justify-between gap-3">
                                                    <div class="min-w-0">
                                                        <div class="flex items-center gap-2 text-xs text-muted-foreground">
                                                            {#if item.issueId}
                                                                <RocketIcon class="size-4 text-emerald-500" />
                                                            {:else}
                                                                <GitBranchIcon class="size-4 text-amber-500" />
                                                            {/if}
                                                            <span class="truncate">{item.repositoryLabel}</span>
                                                        </div>
                                                        <h3 class="mt-2 line-clamp-3 text-sm font-semibold leading-5 text-foreground">
                                                            {item.title}
                                                        </h3>
                                                    </div>
                                                    <Button
                                                        href={`/repository/${encodeURIComponent(item.repositoryId)}/missions/${encodeURIComponent(item.missionId)}`}
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        aria-label={`Open mission ${item.title}`}
                                                        title="Open mission"
                                                    >
                                                        <ExternalLinkIcon class="size-4" />
                                                    </Button>
                                                </div>
                                                <div class="mt-3 flex flex-wrap gap-1.5">
                                                    {#if item.issueId}
                                                        <Badge variant="outline">Issue #{item.issueId}</Badge>
                                                    {/if}
                                                    <Badge variant="secondary">{item.branchRef}</Badge>
                                                </div>
                                                <p class="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                                                    <CalendarIcon class="size-3.5" />
                                                    Created {formatDate(item.createdAt)}
                                                </p>
                                            </article>
                                        {:else}
                                            {@const githubUrl = getRepositoryUrl(item.githubRepository)}
                                            <article class="group rounded-lg border bg-background p-3 shadow-xs transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md dark:hover:border-sky-400/40">
                                                <div class="flex items-start justify-between gap-3">
                                                    <div class="min-w-0">
                                                        <div class="flex items-center gap-2 text-xs text-muted-foreground">
                                                            <FolderIcon class="size-4 text-sky-500" />
                                                            <span>{item.missions.length} missions</span>
                                                            <span>{item.issues.length} issues</span>
                                                        </div>
                                                        <h3 class="mt-2 truncate text-sm font-semibold text-foreground">
                                                            {item.label}
                                                        </h3>
                                                        <p class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                                            {item.description}
                                                        </p>
                                                    </div>
                                                    <div class="flex items-center gap-1">
                                                        {#if githubUrl}
                                                            <Button
                                                                href={githubUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                variant="ghost"
                                                                size="icon-sm"
                                                                aria-label={`Open ${item.label} on GitHub`}
                                                                title="Open on GitHub"
                                                            >
                                                                <BrandGithubIcon class="size-4" />
                                                            </Button>
                                                        {/if}
                                                        <Button
                                                            href={`/repository/${encodeURIComponent(item.repositoryId)}`}
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            aria-label={`Open ${item.label}`}
                                                            title="Open repository"
                                                        >
                                                            <ExternalLinkIcon class="size-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                                {#if item.issueError}
                                                    <p class="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700 dark:border-rose-400/30 dark:bg-rose-950/20 dark:text-rose-200">
                                                        {item.issueError}
                                                    </p>
                                                {:else}
                                                    <p class="mt-3 break-all font-mono text-xs text-muted-foreground">
                                                        {item.repositoryRootPath}
                                                    </p>
                                                {/if}
                                            </article>
                                        {/if}
                                    {/each}
                                {/if}
                            </div>
                        </section>
                    {/each}
                </div>
            </ScrollArea>
        </div>
    {/if}
</section>