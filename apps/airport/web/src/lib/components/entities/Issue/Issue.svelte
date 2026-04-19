<script lang="ts">
    import { goto } from "$app/navigation";
    import EyeIcon from "@tabler/icons-svelte/icons/eye";
    import PlayerPlayIcon from "@tabler/icons-svelte/icons/player-play";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import type { Repository } from "$lib/client/entities/Repository";
    import type { IssueSummary } from "$lib/components/entities/types";

    let {
        repository,
        issue,
        issueLoadingNumber,
        onViewIssue,
        onStartIssueError,
    }: {
        repository: Repository;
        issue: IssueSummary;
        issueLoadingNumber: number | null;
        onViewIssue: (issueNumber: number) => void;
        onStartIssueError?: (message: string | null) => void;
    } = $props();

    let missionCreationPending = $state(false);

    async function startFromIssue(): Promise<void> {
        missionCreationPending = true;
        onStartIssueError?.(null);

        try {
            const result = await repository.startMissionFromIssue(issue.number);
            await goto(result.redirectTo);
        } catch (error) {
            onStartIssueError?.(
                error instanceof Error ? error.message : String(error),
            );
        } finally {
            missionCreationPending = false;
        }
    }
</script>

<article class="rounded-xl border bg-background/70 px-4 py-4">
    <div
        class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
    >
        <div>
            <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-sm font-semibold text-foreground">
                    #{issue.number}
                    {issue.title}
                </h3>
                {#each issue.labels as label (`${issue.number}:${label}`)}
                    <Badge variant="secondary">{label}</Badge>
                {/each}
            </div>
            <p class="mt-1 text-sm text-muted-foreground">
                Updated: {issue.updatedAt ?? "Unknown"}
            </p>
        </div>
        <div class="flex flex-col gap-2 sm:flex-row">
            <Button
                type="button"
                variant="outline"
                onclick={() => onViewIssue(issue.number)}
                disabled={issueLoadingNumber === issue.number}
            >
                <EyeIcon class="size-4" />
                {issueLoadingNumber === issue.number
                    ? "Loading..."
                    : "View issue"}
            </Button>
            <Button
                type="button"
                onclick={() => void startFromIssue()}
                disabled={missionCreationPending}
            >
                <PlayerPlayIcon class="size-4" />
                {missionCreationPending ? "Starting..." : "Start mission"}
            </Button>
        </div>
    </div>
</article>
