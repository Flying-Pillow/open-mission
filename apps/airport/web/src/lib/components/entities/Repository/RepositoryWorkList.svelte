<script lang="ts">
    import { goto } from "$app/navigation";
    import type {
        RepositoryIssueDetailType,
        TrackedIssueSummaryType,
    } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import type { MissionCatalogEntryType } from "@flying-pillow/mission-core/entities/Mission/MissionSchema";
    import Icon from "@iconify/svelte";
    import { app } from "$lib/client/Application.svelte.js";
    import BriefForm from "$lib/components/entities/Brief/BriefForm.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import SidebarMenu from "$lib/components/ui/sidebar/sidebar-menu.svelte";
    import SidebarMenuButton from "$lib/components/ui/sidebar/sidebar-menu-button.svelte";
    import SidebarMenuItem from "$lib/components/ui/sidebar/sidebar-menu-item.svelte";
    import * as Tooltip from "$lib/components/ui/tooltip/index.js";
    import { cn } from "$lib/utils.js";

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

    const repository = $derived.by(() => {
        const repository = app.repository;
        if (!repository) {
            throw new Error("Repository work list requires app.repository.");
        }

        return repository;
    });

    let remoteStartFromIssueError = $state<string | null>(null);
    let createMissionOpen = $state(false);

    const missions = $derived(repository.missions ?? []);
    const missionStatuses = $derived(repository.missionStatuses);
    const repositoryIssuesQuery = $derived(repository.listIssuesQuery());
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
    const trackedIssuesByNumber = $derived.by(
        () =>
            new Map(
                repositoryIssues.map((issue) => [issue.number, issue] as const),
            ),
    );
    const combinedItemsEmpty = $derived(
        missions.length === 0 && unmatchedIssues.length === 0,
    );

    function normalizeStatus(statusLabel: string | undefined): string {
        return statusLabel?.trim().toLowerCase() ?? "";
    }

    function missionStatusIconTone(statusLabel: string | undefined): string {
        switch (normalizeStatus(statusLabel)) {
            case "running":
                return "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300";
            case "completed":
            case "delivered":
                return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
            case "failed":
                return "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300";
            case "paused":
            case "cancelled":
            case "terminated":
                return "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-300";
            default:
                return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
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

    function issueTypeIconTone(issue: TrackedIssueSummaryType): string {
        switch (issueType(issue)) {
            case "bug":
                return "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300";
            case "feature":
                return "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300";
            case "docs":
                return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
            case "task":
                return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
            default:
                return "border-zinc-500/20 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300";
        }
    }

    function issueTypeIcon(issue: TrackedIssueSummaryType): string {
        switch (issueType(issue)) {
            case "bug":
                return "lucide:bug";
            case "feature":
                return "lucide:sparkles";
            case "docs":
                return "lucide:file-text";
            case "task":
                return "lucide:wrench";
            default:
                return "lucide:circle-dot";
        }
    }

    async function viewIssue(issueNumber: number): Promise<void> {
        issueLoadingNumber = issueNumber;
        issueError = null;

        try {
            selectedIssue = await repository.getIssue(issueNumber);
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
            if (!repository.data.isInitialized) {
                throw new Error(
                    "Complete Repository initialization before starting regular missions.",
                );
            }

            const result = await repository.startMissionFromIssue(issue.number);
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

    function missionHref(mission: MissionCatalogEntryType): string {
        return `/airport/${encodeURIComponent(repository.id)}/${encodeURIComponent(mission.missionId)}`;
    }

    function linkedIssue(
        mission: MissionCatalogEntryType,
    ): TrackedIssueSummaryType | undefined {
        if (typeof mission.issueId !== "number") {
            return undefined;
        }

        return trackedIssuesByNumber.get(mission.issueId);
    }

    function missionIcon(mission: MissionCatalogEntryType): string {
        const issue = linkedIssue(mission);

        if (issue) {
            return issueTypeIcon(issue);
        }

        return "lucide:sparkles";
    }
</script>

<section class="flex h-full min-h-[20rem] w-full flex-col overflow-hidden">
    {#if issueError || remoteStartFromIssueError || repositoryIssueLoadError}
        <div class="px-1 pt-3">
            <p class="text-sm text-rose-600">
                {issueError ??
                    remoteStartFromIssueError ??
                    repositoryIssueLoadError}
            </p>
        </div>
    {/if}

    <ScrollArea class="min-h-0 flex-1 pt-6">
        <Tooltip.Provider delayDuration={100}>
            <div class="px-1 pb-3">
                {#if repositoryIssuesLoading}
                    <div
                        class="rborder border-dashed border-border/70 bg-background/35 px-4 py-6 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]"
                    >
                        Loading repository work items...
                    </div>
                {:else if repositoryIssueLoadError}
                    <div
                        class="border border-dashed border-rose-300/60 bg-rose-50/60 px-4 py-6 text-sm text-rose-600 dark:border-rose-400/40 dark:bg-rose-950/20 dark:text-rose-300"
                    >
                        {repositoryIssueLoadError}
                    </div>
                {:else}
                    <SidebarMenu class="gap-2">
                        <SidebarMenuItem>
                            <Dialog.Root bind:open={createMissionOpen}>
                                <Dialog.Trigger>
                                    {#snippet child({ props })}
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            class={cn(
                                                String(props.class ?? ""),
                                                "flex min-h-28 w-full flex-col items-center justify-start gap-2 rounded-xl border border-transparent px-2 py-3 text-center text-foreground hover:border-border/70 hover:bg-muted/30",
                                            )}
                                            aria-label="Start a mission from brief"
                                            {...props}
                                        >
                                            <span
                                                class="inline-flex size-14 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary"
                                            >
                                                <Icon
                                                    icon="lucide:plus"
                                                    class="size-10"
                                                />
                                            </span>
                                            <span
                                                class="line-clamp-2 max-w-full pt-1 text-xs font-medium"
                                            >
                                                new issue
                                            </span>
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
                                                <Icon
                                                    icon="lucide:plus"
                                                    class="size-4"
                                                />
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
                                            <div
                                                class="flex min-w-0 items-center gap-3"
                                            >
                                                <Dialog.Description
                                                    class="min-w-0 text-sm leading-6 text-muted-foreground"
                                                >
                                                    Create a new mission from an
                                                    authored brief when the work
                                                    is not tied to a tracked
                                                    repository issue.
                                                </Dialog.Description>
                                            </div>
                                        </div>
                                    </div>

                                    <BriefForm embedded />
                                </Dialog.Content>
                            </Dialog.Root>
                        </SidebarMenuItem>

                        {#each missions as mission (mission.missionId)}
                            {@const missionLifecycle = missionStatus(mission)}
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    class="h-auto min-h-34 justify-start rounded-xl border border-transparent px-2 py-3 [&_svg]:size-8"
                                    tooltipContentProps={{
                                        hidden: false,
                                        sideOffset: 14,
                                        class: "w-80 max-w-80 border border-border bg-popover px-4 py-4 text-popover-foreground shadow-xl",
                                    }}
                                    aria-label={`Open mission ${mission.title}`}
                                >
                                    {#snippet child({ props })}
                                        <a
                                            href={missionHref(mission)}
                                            {...props}
                                            class={cn(
                                                String(props.class ?? ""),
                                                "flex min-h-28 flex-col items-center justify-start gap-2 text-center",
                                            )}
                                        >
                                            <span
                                                class={`inline-flex size-14 shrink-0 items-center justify-center rounded-xl border ${missionStatusIconTone(missionLifecycle)}`}
                                            >
                                                <Icon
                                                    icon={missionIcon(mission)}
                                                    class="size-8"
                                                />
                                            </span>
                                            <span
                                                class="grid min-w-0 flex-1 justify-items-center text-center leading-tight"
                                            >
                                                <span
                                                    class="mt-2 truncate text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
                                                >
                                                    {mission.issueId
                                                        ? `#${mission.issueId}`
                                                        : "Mission"}
                                                </span>
                                                <span
                                                    class="line-clamp-2 max-w-full pt-1 text-xs font-medium"
                                                >
                                                    {mission.title?.trim() ||
                                                        mission.missionId}
                                                </span>
                                            </span>
                                        </a>
                                    {/snippet}
                                    {#snippet tooltipContent()}
                                        <div
                                            class="grid min-w-0 gap-3 text-left"
                                        >
                                            <div class="flex items-start gap-3">
                                                <span
                                                    class={`inline-flex size-10 shrink-0 items-center justify-center rounded-md border ${missionStatusIconTone(missionLifecycle)}`}
                                                >
                                                    <Icon
                                                        icon={missionIcon(
                                                            mission,
                                                        )}
                                                        class="size-5"
                                                    />
                                                </span>
                                                <div class="min-w-0 flex-1">
                                                    <div
                                                        class="flex items-start justify-between gap-2"
                                                    >
                                                        <div class="min-w-0">
                                                            <p
                                                                class="truncate text-sm font-semibold text-foreground"
                                                            >
                                                                {mission.title?.trim() ||
                                                                    mission.missionId}
                                                            </p>
                                                            <p
                                                                class="mt-1 truncate text-xs text-muted-foreground"
                                                            >
                                                                {mission.issueId
                                                                    ? `Issue #${mission.issueId}`
                                                                    : "Mission"}
                                                            </p>
                                                        </div>
                                                        <Badge
                                                            variant="outline"
                                                            class={`rounded-full ${missionStatusBadgeTone(missionLifecycle)}`}
                                                        >
                                                            {missionLifecycle ??
                                                                "pending"}
                                                        </Badge>
                                                    </div>
                                                    <p
                                                        class="mt-2 truncate text-xs text-muted-foreground"
                                                    >
                                                        {mission.branchRef}
                                                    </p>
                                                    <p
                                                        class="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                                                    >
                                                        {mission.missionId}
                                                    </p>
                                                </div>
                                            </div>
                                            <div
                                                class="flex items-center justify-end gap-1.5 border-t pt-3"
                                            >
                                                {#if mission.issueId}
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        class="rounded-full"
                                                        onclick={() =>
                                                            void viewIssue(
                                                                mission.issueId!,
                                                            )}
                                                        disabled={issueLoadingNumber ===
                                                            mission.issueId}
                                                        aria-label={`View issue ${mission.issueId}`}
                                                    >
                                                        <Icon
                                                            icon="lucide:eye"
                                                            class="size-4"
                                                        />
                                                    </Button>
                                                {/if}
                                                <Button
                                                    href={missionHref(mission)}
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    class="rounded-full"
                                                    aria-label={`Open mission ${mission.title}`}
                                                >
                                                    <Icon
                                                        icon="lucide:arrow-up-right"
                                                        class="size-4"
                                                    />
                                                </Button>
                                            </div>
                                        </div>
                                    {/snippet}
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        {/each}

                        {#each unmatchedIssues as issue (issue.number)}
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    class="h-auto min-h-34 justify-start rounded-xl border border-transparent px-2 py-3 [&_svg]:size-8"
                                    tooltipContentProps={{
                                        hidden: false,
                                        sideOffset: 14,
                                        class: "w-80 max-w-80 border border-border bg-popover px-4 py-4 text-popover-foreground shadow-xl",
                                    }}
                                    aria-label={`View issue ${issue.number}`}
                                >
                                    {#snippet child({ props })}
                                        <button
                                            type="button"
                                            onclick={() =>
                                                void viewIssue(issue.number)}
                                            disabled={issueLoadingNumber ===
                                                issue.number}
                                            {...props}
                                            class={cn(
                                                String(props.class ?? ""),
                                                "flex min-h-28 flex-col items-center justify-start gap-2 text-center",
                                            )}
                                        >
                                            <span
                                                class={`inline-flex size-14 shrink-0 items-center justify-center rounded-xl border ${issueTypeIconTone(issue)}`}
                                            >
                                                <Icon
                                                    icon={issueTypeIcon(issue)}
                                                    class="size-8"
                                                />
                                            </span>
                                            <span
                                                class="grid min-w-0 flex-1 justify-items-center text-center leading-tight"
                                            >
                                                <span
                                                    class="mt-2 truncate text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
                                                >
                                                    #{issue.number}
                                                </span>
                                                <span
                                                    class="line-clamp-2 max-w-full pt-1 text-xs font-medium"
                                                >
                                                    {issue.title}
                                                </span>
                                            </span>
                                        </button>
                                    {/snippet}
                                    {#snippet tooltipContent()}
                                        <div
                                            class="grid min-w-0 gap-3 text-left"
                                        >
                                            <div class="flex items-start gap-3">
                                                <span
                                                    class={`inline-flex size-10 shrink-0 items-center justify-center rounded-md border ${issueTypeIconTone(issue)}`}
                                                >
                                                    <Icon
                                                        icon={issueTypeIcon(
                                                            issue,
                                                        )}
                                                        class="size-5"
                                                    />
                                                </span>
                                                <div class="min-w-0 flex-1">
                                                    <div
                                                        class="flex items-start justify-between gap-2"
                                                    >
                                                        <div class="min-w-0">
                                                            <p
                                                                class="truncate text-sm font-semibold text-foreground"
                                                            >
                                                                #{issue.number}
                                                            </p>
                                                            <p
                                                                class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground"
                                                            >
                                                                {issue.title}
                                                            </p>
                                                        </div>
                                                        <Badge
                                                            variant="outline"
                                                            class={`rounded-full ${issueTypeBadgeTone(issue)}`}
                                                        >
                                                            {issueType(issue)}
                                                        </Badge>
                                                    </div>
                                                    <div
                                                        class="mt-3 flex flex-wrap gap-1.5"
                                                    >
                                                        {#each issue.labels.slice(0, 3) as label (`${issue.number}:${label}`)}
                                                            <Badge
                                                                variant="secondary"
                                                                class="rounded-full bg-muted text-muted-foreground shadow-none"
                                                            >
                                                                {label}
                                                            </Badge>
                                                        {/each}
                                                    </div>
                                                    <p
                                                        class="mt-3 text-xs text-muted-foreground"
                                                    >
                                                        {issue.updatedAt ??
                                                            "Unknown update time"}
                                                    </p>
                                                </div>
                                            </div>
                                            <div
                                                class="flex items-center justify-end gap-1.5 border-t pt-3"
                                            >
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
                                                >
                                                    <Icon
                                                        icon="lucide:eye"
                                                        class="size-4"
                                                    />
                                                </Button>
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
                                                        !repository.data
                                                            .isInitialized}
                                                    aria-label={`Start mission from issue ${issue.number}`}
                                                >
                                                    <Icon
                                                        icon="lucide:play"
                                                        class="size-4"
                                                    />
                                                </Button>
                                            </div>
                                        </div>
                                    {/snippet}
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        {/each}
                    </SidebarMenu>
                {/if}
            </div>
        </Tooltip.Provider>
    </ScrollArea>
</section>
