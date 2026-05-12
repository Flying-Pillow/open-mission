<script lang="ts">
    import { goto } from "$app/navigation";
    import Icon from "@iconify/svelte";
    import { app } from "$lib/client/Application.svelte.js";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import type { TrackedIssueSummaryType } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";

    let {
        issue,
        cardIndex = 0,
        issueLoadingNumber,
        onViewIssue,
        onStartIssueError,
    }: {
        issue: TrackedIssueSummaryType;
        cardIndex?: number;
        issueLoadingNumber: number | null;
        onViewIssue: (issueNumber: number) => void;
        onStartIssueError?: (message: string | null) => void;
    } = $props();
    const repository = $derived.by(() => {
        const repository = app.repository;
        if (!repository) {
            throw new Error("Issue commands require app.repository.");
        }

        return repository;
    });

    let missionCreationPending = $state(false);
    const canStartMission = $derived(repository.data.isInitialized);
    const issueType = $derived.by(() => {
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
    });
    const cardToneClasses = $derived.by(() => {
        switch (issueType) {
            case "bug":
                return "border-[#b5651d] bg-[#ffd0a6] text-slate-900 dark:border-[#6c4a22] dark:bg-[#2c2117] dark:text-slate-100";
            case "feature":
                return "border-[#2d6cdf] bg-[#cfe1ff] text-slate-900 dark:border-[#2a4670] dark:bg-[#182231] dark:text-slate-100";
            case "docs":
                return "border-[#3f8f52] bg-[#d7f3d8] text-slate-900 dark:border-[#34583c] dark:bg-[#18231b] dark:text-slate-100";
            case "task":
                return "border-[#5aa9d6] bg-[#d7f1ff] text-slate-900 dark:border-[#345367] dark:bg-[#17232b] dark:text-slate-100";
            default:
                return cardIndex % 3 === 0
                    ? "border-black/10 bg-[#d8f0ff] text-slate-900 dark:border-[#274757] dark:bg-[#18242d] dark:text-slate-100"
                    : cardIndex % 3 === 1
                      ? "border-black/10 bg-[#dff7d6] text-slate-900 dark:border-[#335335] dark:bg-[#1a261b] dark:text-slate-100"
                      : "border-black/10 bg-[#fbe1ff] text-slate-900 dark:border-[#5b3e5f] dark:bg-[#261b28] dark:text-slate-100";
        }
    });

    async function startFromIssue(): Promise<void> {
        missionCreationPending = true;
        onStartIssueError?.(null);

        try {
            if (!canStartMission) {
                throw new Error(
                    "Complete Repository initialization before starting regular missions.",
                );
            }
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

<article
    class={`rounded-none border px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.12)] ${cardIndex % 3 === 0 ? "rotate-[0.7deg]" : cardIndex % 3 === 1 ? "-rotate-[0.5deg]" : "rotate-[0.35deg]"} ${cardToneClasses}`}
>
    <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-sm font-semibold">
                    #{issue.number}
                </h3>
                {#each issue.labels.slice(0, 3) as label (`${issue.number}:${label}`)}
                    <Badge
                        variant="secondary"
                        class="rounded-none bg-white/50 text-slate-700 shadow-none dark:bg-white/10 dark:text-slate-200"
                    >
                        {label}
                    </Badge>
                {/each}
            </div>
            <p
                class="mt-2 line-clamp-2 text-sm text-slate-900/90 dark:text-slate-100/90"
            >
                {issue.title}
            </p>
            <p class="mt-2 text-xs text-slate-700/70 dark:text-slate-400/80">
                {issue.updatedAt ?? "Unknown"}
            </p>
        </div>
        <div class="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button
                type="button"
                variant="ghost"
                size="sm"
                class="rounded-none text-slate-700 hover:bg-black/5 dark:text-slate-200 dark:hover:bg-white/10"
                onclick={() => onViewIssue(issue.number)}
                disabled={issueLoadingNumber === issue.number}
            >
                <Icon icon="lucide:eye" class="size-4" />
                {issueLoadingNumber === issue.number ? "Loading..." : "View"}
            </Button>
            <Button
                type="button"
                size="sm"
                class="rounded-none bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200"
                onclick={() => void startFromIssue()}
                disabled={missionCreationPending || !canStartMission}
                title={canStartMission
                    ? "Start mission"
                    : "Repository initialization required"}
            >
                <Icon icon="lucide:play" class="size-4" />
                {missionCreationPending ? "Starting..." : "Start"}
            </Button>
        </div>
    </div>
</article>
