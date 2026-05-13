<script lang="ts">
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import type {
        RepositoryRemovalSummaryType,
        RepositoryWorktreeStatusType,
    } from "@flying-pillow/open-mission-core/entities/Repository/RepositorySchema";

    let {
        summary,
        loading = false,
        error = null,
    }: {
        summary?: RepositoryRemovalSummaryType;
        loading?: boolean;
        error?: string | null;
    } = $props();

    function pluralize(count: number, noun: string): string {
        return `${count} ${noun}${count === 1 ? "" : "s"}`;
    }

    function humanizeToken(value: string): string {
        if (value === "prd") {
            return "PRD";
        }

        return value
            .split(/[-_]/u)
            .filter(Boolean)
            .map((part) => part[0]?.toUpperCase() + part.slice(1))
            .join(" ");
    }

    function summarizeWorktree(worktree: RepositoryWorktreeStatusType): string {
        if (worktree.clean) {
            return "no local changes";
        }

        const parts = [
            worktree.stagedCount > 0
                ? pluralize(worktree.stagedCount, "staged file")
                : null,
            worktree.unstagedCount > 0
                ? pluralize(worktree.unstagedCount, "modified file")
                : null,
            worktree.untrackedCount > 0
                ? pluralize(worktree.untrackedCount, "untracked file")
                : null,
        ].filter(Boolean);

        return parts.join(", ");
    }
</script>

{#if loading}
    <div class="space-y-3">
        <div
            class="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
        >
            Loading removal inventory...
        </div>
        <div class="space-y-2">
            <div class="h-24 animate-pulse rounded-lg bg-muted/50"></div>
            <div class="h-16 animate-pulse rounded-lg bg-muted/40"></div>
        </div>
    </div>
{:else if error}
    <div
        class="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
        Could not load the removal inventory. {error}
    </div>
{:else if summary}
    <div class="space-y-3 text-sm">
        <div class="rounded-lg border border-border/70 bg-muted/30 p-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="space-y-2">
                    <p class="font-medium text-foreground">
                        This deletes the repository checkout and every
                        repo-scoped Mission worktree tied to it.
                    </p>
                    <div class="space-y-1 text-xs text-muted-foreground">
                        <p>Repository root</p>
                        <p class="break-all font-mono text-[0.72rem]">
                            {summary.repositoryRootPath}
                        </p>
                    </div>
                    {#if summary.hasExternalMissionWorktrees}
                        <div class="space-y-1 text-xs text-muted-foreground">
                            <p>Mission worktrees root</p>
                            <p class="break-all font-mono text-[0.72rem]">
                                {summary.missionWorktreesPath}
                            </p>
                        </div>
                    {/if}
                </div>
                <div class="flex flex-wrap gap-2">
                    <Badge
                        variant={summary.repositoryWorktree.clean
                            ? "outline"
                            : "destructive"}
                    >
                        {summary.repositoryWorktree.clean
                            ? "Repository clean"
                            : "Repository dirty"}
                    </Badge>
                    <Badge variant="secondary">
                        {pluralize(summary.missionCount, "mission")}
                    </Badge>
                    {#if summary.activeAgentExecutionCount > 0}
                        <Badge variant="secondary">
                            {pluralize(
                                summary.activeAgentExecutionCount,
                                "active agent execution",
                            )}
                        </Badge>
                    {/if}
                </div>
            </div>

            <div class="mt-3 space-y-1 text-xs text-muted-foreground">
                <p>
                    Repository worktree has {summarizeWorktree(
                        summary.repositoryWorktree,
                    )}.
                </p>
                {#if summary.missionCount > 0}
                    <p>
                        {pluralize(summary.dirtyMissionCount, "mission")} with local
                        changes.
                        {pluralize(
                            summary.missionsWithActiveAgentExecutionsCount,
                            "mission",
                        )} with active agent executions.
                    </p>
                {:else}
                    <p>No repository-scoped missions will be removed.</p>
                {/if}
            </div>
        </div>

        {#if summary.missionCount > 0}
            <ScrollArea class="max-h-72 pr-3">
                <div class="space-y-2">
                    {#each summary.missions as mission (mission.missionId)}
                        <div
                            class="rounded-lg border border-border/70 bg-background/80 p-3"
                        >
                            <div
                                class="flex flex-wrap items-start justify-between gap-3"
                            >
                                <div class="min-w-0 space-y-1">
                                    <div
                                        class="flex flex-wrap items-center gap-2"
                                    >
                                        <p class="font-medium text-foreground">
                                            {mission.title}
                                        </p>
                                        <span
                                            class="text-xs text-muted-foreground"
                                        >
                                            {mission.missionId}
                                        </span>
                                    </div>
                                    <p class="text-xs text-muted-foreground">
                                        Branch {mission.branchRef}
                                        {#if mission.issueId !== undefined}
                                            · Issue #{mission.issueId}
                                        {/if}
                                    </p>
                                    <p
                                        class="break-all font-mono text-[0.72rem] text-muted-foreground"
                                    >
                                        {mission.missionWorktreePath}
                                    </p>
                                </div>

                                <div class="flex flex-wrap justify-end gap-2">
                                    <Badge
                                        variant={mission.worktree.clean
                                            ? "outline"
                                            : "destructive"}
                                    >
                                        {mission.worktree.clean
                                            ? "Clean"
                                            : "Local changes"}
                                    </Badge>
                                    <Badge variant="secondary">
                                        {humanizeToken(mission.lifecycle)}
                                    </Badge>
                                    {#if mission.currentStageId}
                                        <Badge variant="outline">
                                            {humanizeToken(
                                                mission.currentStageId,
                                            )}
                                        </Badge>
                                    {/if}
                                    {#if mission.activeAgentExecutionCount > 0}
                                        <Badge variant="secondary">
                                            {pluralize(
                                                mission.activeAgentExecutionCount,
                                                "active agent execution",
                                            )}
                                        </Badge>
                                    {/if}
                                </div>
                            </div>

                            <p class="mt-2 text-xs text-muted-foreground">
                                Worktree has {summarizeWorktree(
                                    mission.worktree,
                                )}.
                            </p>
                        </div>
                    {/each}
                </div>
            </ScrollArea>
        {/if}
    </div>
{/if}
