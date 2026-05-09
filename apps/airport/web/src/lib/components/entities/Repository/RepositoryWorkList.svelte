<script lang="ts">
    import { goto } from "$app/navigation";
    import type {
        RepositoryIssueDetailType,
        TrackedIssueSummaryType,
    } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import type { MissionCatalogEntryType } from "@flying-pillow/mission-core/entities/Mission/MissionSchema";
    import Icon from "@iconify/svelte";
    import { getScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
    import BriefForm from "$lib/components/entities/Brief/BriefForm.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import * as Tooltip from "$lib/components/ui/tooltip/index.js";

    let {
        selectedIssue = $bindable<RepositoryIssueDetailType | null>(null),
        issuePreviewOpen = $bindable(false),
        issueError = $bindable<string | null>(null),
        issueLoadingNumber = $bindable<number | null>(null),
    }: {
        selectedIssue?: RepositoryIssueDetailType | null;
        issuePreviewOpen?: boolean;
        issueError?: string | null;
        issueLoadingNumber?: number | null;
    } = $props();

    const repositoryScope = getScopedRepositoryContext();
    const activeRepository = $derived.by(() => {
        const repository = repositoryScope.repository;
        if (!repository) {
            throw new Error(
                "Repository work list requires a scoped repository context.",
            );
        }

        return repository;
    });

    let remoteStartFromIssueError = $state<string | null>(null);
    let createMissionOpen = $state(false);

    const missions = $derived(activeRepository.missions ?? []);
    const missionStatuses = $derived(activeRepository.missionStatuses);
    const repositoryIssuesQuery = $derived(activeRepository.listIssuesQuery());
    const repositoryIssues = $derived(
        (repositoryIssuesQuery.current as
            | TrackedIssueSummaryType[]
            | undefined) ?? [],
    );
    const repositoryIssuesLoading = $derived(
        repositoryIssuesQuery.loading ?? false,
    );
    const repositoryIssueLoadError = $derived.by(() => {
        const error = repositoryIssuesQuery.error;
        if (!error) {
            return null;
        }

        return error instanceof Error ? error.message : String(error);
    });
    const missionIssueNumbers = $derived.by(
        () =>
            new Set(
                missions
                    .map((mission) => mission.issueId)
                    .filter(
                        (issueId): issueId is number =>
                            typeof issueId === "number" &&
                            Number.isInteger(issueId),
                    ),
            ),
    );
    const unmatchedIssues = $derived.by(() =>
        repositoryIssues.filter(
            (issue) => !missionIssueNumbers.has(issue.number),
        ),
    );
    const combinedItemsEmpty = $derived(
        missions.length === 0 && unmatchedIssues.length === 0,
    );

    function normalizeStatus(statusLabel: string | undefined): string {
        return statusLabel?.trim().toLowerCase() ?? "";
    }

    function missionTone(statusLabel: string | undefined): string {
        switch (normalizeStatus(statusLabel)) {
            case "running":
                return "border-sky-500/40 bg-sky-500/12 text-sky-950 dark:border-sky-400/35 dark:bg-sky-500/12 dark:text-sky-100";
            case "completed":
            case "delivered":
                return "border-emerald-500/40 bg-emerald-500/12 text-emerald-950 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-100";
            case "failed":
                return "border-rose-500/40 bg-rose-500/12 text-rose-950 dark:border-rose-400/35 dark:bg-rose-500/12 dark:text-rose-100";
            case "paused":
            case "cancelled":
            case "terminated":
                return "border-slate-500/35 bg-slate-500/12 text-slate-900 dark:border-slate-400/30 dark:bg-slate-500/12 dark:text-slate-100";
            default:
                return "border-amber-500/40 bg-amber-500/12 text-amber-950 dark:border-amber-400/35 dark:bg-amber-500/12 dark:text-amber-100";
        }
    }

    function missionStatusBadgeTone(statusLabel: string | undefined): string {
        switch (normalizeStatus(statusLabel)) {
            case "running":
                return "border-sky-500/30 bg-sky-500/15 text-sky-800 dark:text-sky-200";
            case "completed":
            case "delivered":
                return "border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200";
            case "failed":
                return "border-rose-500/30 bg-rose-500/15 text-rose-800 dark:text-rose-200";
            case "paused":
            case "cancelled":
            case "terminated":
                return "border-slate-500/30 bg-slate-500/15 text-slate-700 dark:text-slate-200";
            default:
                return "border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-200";
        }
    }

    function issueTone(index: number): string {
        if (index % 3 === 0) {
            return "border-zinc-300/80 bg-zinc-50/80 text-zinc-950 dark:border-zinc-700/70 dark:bg-zinc-900/60 dark:text-zinc-100";
        }

        if (index % 3 === 1) {
            return "border-stone-300/80 bg-stone-50/80 text-stone-950 dark:border-stone-700/70 dark:bg-stone-900/60 dark:text-stone-100";
        }

        return "border-neutral-300/80 bg-neutral-50/80 text-neutral-950 dark:border-neutral-700/70 dark:bg-neutral-900/60 dark:text-neutral-100";
    }

    function issueType(issue: TrackedIssueSummaryType): string {
        const normalizedLabels = issue.labels.map((label) =>
            label.trim().toLowerCase(),
        );

        if (normalizedLabels.some((label) => label === "bug")) {
            return "bug";
        }

        if (
            normalizedLabels.some(
                (label) =>
                    label === "feature" ||
                    label === "enhancement" ||
                    label === "feat",
            )
        ) {
            return "feature";
        }

        if (
            normalizedLabels.some(
                (label) =>
                    label === "docs" ||
                    label === "documentation" ||
                    label === "doc",
            )
        ) {
            return "docs";
        }

        if (
            normalizedLabels.some(
                (label) =>
                    label === "task" ||
                    label === "chore" ||
                    label === "maintenance",
            )
        ) {
            return "task";
        }

        return "default";
    }

    function issueTypeBadgeTone(issue: TrackedIssueSummaryType): string {
        switch (issueType(issue)) {
            case "bug":
                return "border-rose-500/25 bg-rose-500/12 text-rose-800 dark:text-rose-200";
            case "feature":
                return "border-sky-500/25 bg-sky-500/12 text-sky-800 dark:text-sky-200";
            case "docs":
                return "border-emerald-500/25 bg-emerald-500/12 text-emerald-800 dark:text-emerald-200";
            case "task":
                return "border-amber-500/25 bg-amber-500/12 text-amber-800 dark:text-amber-200";
            default:
                return "border-zinc-500/20 bg-zinc-500/10 text-zinc-700 dark:text-zinc-200";
        }
    }

    async function viewIssue(issueNumber: number): Promise<void> {
        issueLoadingNumber = issueNumber;
        issueError = null;

        try {
            selectedIssue = await activeRepository.getIssue(issueNumber);
            issuePreviewOpen = true;
        } catch (error) {
            issueError = error instanceof Error ? error.message : String(error);
        } finally {
            issueLoadingNumber = null;
        }
    }

    async function startFromIssue(
        issue: TrackedIssueSummaryType,
    ): Promise<void> {
        issueLoadingNumber = issue.number;
        remoteStartFromIssueError = null;

        try {
            if (!activeRepository.data.isInitialized) {
                throw new Error(
                    "Complete Repository initialization before starting regular missions.",
                );
            }

            const result = await activeRepository.startMissionFromIssue(
                issue.number,
            );
            await goto(result.redirectTo);
        } catch (error) {
            remoteStartFromIssueError =
                error instanceof Error ? error.message : String(error);
        } finally {
            issueLoadingNumber = null;
        }
    }

    function missionStatus(
        mission: MissionCatalogEntryType,
    ): string | undefined {
        return missionStatuses[mission.missionId];
    }
</script>

<section class="flex h-full min-h-[20rem] w-full flex-col overflow-hidden">
    <div class="px-1 py-1">
        <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
                <h2
                    class="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
                >
                    Repository work
                </h2>
                <p class="mt-1 text-xs text-muted-foreground">
                    {missions.length} mission{missions.length === 1 ? "" : "s"}
                    and {unmatchedIssues.length} issue{unmatchedIssues.length ===
                    1
                        ? ""
                        : "s"} without a mission
                </p>
            </div>

            <Dialog.Root bind:open={createMissionOpen}>
                <Dialog.Trigger>
                    {#snippet child({ props })}
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            class="h-8 rounded-full px-2.5 text-xs text-muted-foreground"
                            {...props}
                        >
                            <Icon icon="lucide:plus" class="size-4" />
                            New mission
                        </Button>
                    {/snippet}
                </Dialog.Trigger>
                <Dialog.Content
                    class="min-h-[80dvh] overflow-hidden sm:max-w-3xl flex flex-col"
                >
                    <div class="border-b bg-muted/25 px-5 py-4">
                        <div class="min-w-0 space-y-3 pr-10">
                            <div
                                class="flex items-center gap-2 text-muted-foreground"
                            >
                                <Icon icon="lucide:plus" class="size-4" />
                                <p
                                    class="text-xs font-medium uppercase tracking-[0.16em]"
                                >
                                    Workflow
                                </p>
                            </div>
                            <Dialog.Title
                                class="text-lg font-semibold text-foreground"
                            >
                                Start from brief
                            </Dialog.Title>
                            <div class="flex min-w-0 items-center gap-3">
                                <Dialog.Description
                                    class="min-w-0 text-sm leading-6 text-muted-foreground"
                                >
                                    Create a new mission from an authored brief
                                    when the work is not tied to a tracked
                                    repository issue.
                                </Dialog.Description>
                            </div>
                        </div>
                    </div>

                    <BriefForm embedded />
                </Dialog.Content>
            </Dialog.Root>
        </div>
    </div>

    {#if issueError || remoteStartFromIssueError || repositoryIssueLoadError}
        <div class="px-1 pt-3">
            <p class="text-sm text-rose-600">
                {issueError ??
                    remoteStartFromIssueError ??
                    repositoryIssueLoadError}
            </p>
        </div>
    {/if}

    <ScrollArea class="min-h-0 flex-1">
        <Tooltip.Provider delayDuration={100}>
            <div class="grid gap-3 px-1 pb-2 pt-1">
                {#if repositoryIssuesLoading}
                    <div
                        class="rounded-2xl border border-dashed border-border/70 bg-background/35 px-4 py-6 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]"
                    >
                        Loading repository work items...
                    </div>
                {:else if repositoryIssueLoadError}
                    <div
                        class="rounded-2xl border border-dashed border-rose-300/60 bg-rose-50/60 px-4 py-6 text-sm text-rose-600 dark:border-rose-400/40 dark:bg-rose-950/20 dark:text-rose-300"
                    >
                        {repositoryIssueLoadError}
                    </div>
                {:else if combinedItemsEmpty}
                    <div
                        class="rounded-2xl border border-dashed border-border/70 bg-background/35 px-4 py-6 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]"
                    >
                        No active missions or tracked issues are available for
                        this repository.
                    </div>
                {:else}
                    {#each missions as mission, index (mission.missionId)}
                        {@const missionLifecycle = missionStatus(mission)}
                        <article
                            class={`flex flex-col gap-4 rounded-2xl border px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.1)] ${index % 2 === 0 ? "rotate-[0.25deg]" : "-rotate-[0.2deg]"} ${missionTone(missionLifecycle)}`}
                        >
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0 flex-1">
                                    <div
                                        class="flex flex-wrap items-center gap-2"
                                    >
                                        <h3
                                            class="truncate text-sm font-semibold"
                                        >
                                            {mission.title}
                                        </h3>
                                        {#if mission.issueId}
                                            <Badge
                                                variant="outline"
                                                class="rounded-full border-current/15 bg-white/35 text-current dark:bg-black/10"
                                            >
                                                #{mission.issueId}
                                            </Badge>
                                        {/if}
                                        <Badge
                                            variant="outline"
                                            class={`rounded-full ${missionStatusBadgeTone(missionLifecycle)}`}
                                        >
                                            {missionLifecycle ?? "pending"}
                                        </Badge>
                                    </div>
                                    <p class="mt-2 truncate text-xs opacity-80">
                                        {mission.branchRef}
                                    </p>
                                    <p
                                        class="mt-1 truncate font-mono text-[11px] opacity-70"
                                    >
                                        {mission.missionId}
                                    </p>
                                </div>
                            </div>

                            <div
                                class="mt-auto flex items-center justify-between gap-3 border-t border-current/10 pt-3"
                            >
                                <p
                                    class="text-[11px] uppercase tracking-[0.18em] opacity-70"
                                >
                                    Mission
                                </p>
                                <div class="flex items-center gap-1.5">
                                    <Tooltip.Root>
                                        <Tooltip.Trigger>
                                            {#snippet child({ props })}
                                                <Button
                                                    href={`/airport/${encodeURIComponent(activeRepository.id)}/${encodeURIComponent(mission.missionId)}`}
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    class="rounded-full"
                                                    aria-label={`Open mission ${mission.title}`}
                                                    {...props}
                                                >
                                                    <Icon
                                                        icon="lucide:arrow-up-right"
                                                        class="size-4"
                                                    />
                                                </Button>
                                            {/snippet}
                                        </Tooltip.Trigger>
                                        <Tooltip.Content
                                            >Open mission</Tooltip.Content
                                        >
                                    </Tooltip.Root>
                                </div>
                            </div>
                        </article>
                    {/each}

                    {#each unmatchedIssues as issue, index (issue.number)}
                        <article
                            class={`flex flex-col gap-4 rounded-2xl border px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.08)] ${index % 2 === 0 ? "-rotate-[0.18deg]" : "rotate-[0.15deg]"} ${issueTone(index)}`}
                        >
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0 flex-1">
                                    <div
                                        class="flex flex-wrap items-center gap-2"
                                    >
                                        <h3 class="text-sm font-semibold">
                                            #{issue.number}
                                        </h3>
                                        <Badge
                                            variant="outline"
                                            class={`rounded-full ${issueTypeBadgeTone(issue)}`}
                                        >
                                            {issueType(issue)}
                                        </Badge>
                                        {#each issue.labels.slice(0, 2) as label (`${issue.number}:${label}`)}
                                            <Badge
                                                variant="secondary"
                                                class="rounded-full bg-white/60 text-current shadow-none dark:bg-white/10"
                                            >
                                                {label}
                                            </Badge>
                                        {/each}
                                    </div>
                                    <p
                                        class="mt-2 line-clamp-2 text-sm opacity-90"
                                    >
                                        {issue.title}
                                    </p>
                                    <p class="mt-2 text-xs opacity-70">
                                        {issue.updatedAt ??
                                            "Unknown update time"}
                                    </p>
                                </div>
                            </div>

                            <div
                                class="mt-auto flex items-center justify-between gap-3 border-t border-current/10 pt-3"
                            >
                                <p
                                    class="text-[11px] uppercase tracking-[0.18em] opacity-70"
                                >
                                    GitHub issue
                                </p>
                                <div class="flex items-center gap-1.5">
                                    <Tooltip.Root>
                                        <Tooltip.Trigger>
                                            {#snippet child({ props })}
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    class="rounded-full"
                                                    onclick={() =>
                                                        void viewIssue(
                                                            issue.number,
                                                        )}
                                                    disabled={issueLoadingNumber ===
                                                        issue.number}
                                                    aria-label={`View issue ${issue.number}`}
                                                    {...props}
                                                >
                                                    <Icon
                                                        icon="lucide:eye"
                                                        class="size-4"
                                                    />
                                                </Button>
                                            {/snippet}
                                        </Tooltip.Trigger>
                                        <Tooltip.Content>
                                            {issueLoadingNumber === issue.number
                                                ? "Loading issue"
                                                : "View issue"}
                                        </Tooltip.Content>
                                    </Tooltip.Root>

                                    <Tooltip.Root>
                                        <Tooltip.Trigger>
                                            {#snippet child({ props })}
                                                <Button
                                                    type="button"
                                                    size="icon-sm"
                                                    class="rounded-full"
                                                    onclick={() =>
                                                        void startFromIssue(
                                                            issue,
                                                        )}
                                                    disabled={issueLoadingNumber ===
                                                        issue.number ||
                                                        !activeRepository.data
                                                            .isInitialized}
                                                    aria-label={`Start mission from issue ${issue.number}`}
                                                    {...props}
                                                >
                                                    <Icon
                                                        icon="lucide:play"
                                                        class="size-4"
                                                    />
                                                </Button>
                                            {/snippet}
                                        </Tooltip.Trigger>
                                        <Tooltip.Content>
                                            {activeRepository.data.isInitialized
                                                ? issueLoadingNumber ===
                                                  issue.number
                                                    ? "Starting mission"
                                                    : "Start mission"
                                                : "Repository initialization required"}
                                        </Tooltip.Content>
                                    </Tooltip.Root>
                                </div>
                            </div>
                        </article>
                    {/each}
                {/if}
            </div>
        </Tooltip.Provider>
    </ScrollArea>
</section>
