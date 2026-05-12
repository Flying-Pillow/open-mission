<script lang="ts">
    import Icon from "@iconify/svelte";
    import { app } from "$lib/client/Application.svelte.js";
    import MissionCommandbar from "$lib/components/entities/Mission/MissionCommandbar.svelte";
    import RepositoryCommandbar from "$lib/components/entities/Repository/RepositoryCommandbar.svelte";
    import { getRepositoryIconIdentifier } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { Badge } from "$lib/components/ui/badge/index.js";

    const contextKind = $derived(
        app.mission ? "mission" : app.repository ? "repository" : undefined,
    );
    const repositoryName = $derived.by(() => {
        if (!app.repository) {
            return undefined;
        }

        return (
            app.repository.data.platformRepositoryRef ??
            app.repository.data.repoName
        );
    });
    const repositoryRequiresSetup = $derived(
        Boolean(app.repository && !app.repository.data.isInitialized),
    );
    const repositoryInvalidState = $derived(app.repository?.data.invalidState);
    const repositoryIconIdentifier = $derived(
        app.repository
            ? getRepositoryIconIdentifier(app.repository.data)
            : "lucide:folder-git-2",
    );
    const missionStatus = $derived(app.mission?.controlData?.mission);
    const workflowLifecycle = $derived(
        app.mission?.controlData?.mission.workflow?.lifecycle ??
            app.mission?.workflowLifecycle,
    );
    const workflowUpdatedAt = $derived(
        app.mission?.controlData?.mission.workflow?.updatedAt ??
            app.mission?.workflowUpdatedAt,
    );
    const currentStageId = $derived(
        app.mission?.controlData?.mission.workflow?.currentStageId,
    );
    const missionTitle = $derived(
        missionStatus?.title ?? app.mission?.missionId,
    );
    const missionIssueLabel = $derived.by(() => {
        const issueId = missionStatus?.issueId;
        if (issueId) {
            return `#${issueId}`;
        }

        const missionNumber =
            app.mission?.missionId.match(/^(\d+)(?:-|$)/)?.[1];
        return missionNumber ? `#${missionNumber}` : undefined;
    });
    const missionHeading = $derived.by(() => {
        const headingRepositoryName =
            app.repository?.data.platformRepositoryRef ??
            app.repository?.data.repoName ??
            "Repository";
        const headingMissionTitle = missionTitle ?? "Mission";
        return `${headingRepositoryName} - ${missionIssueLabel ? `${missionIssueLabel} ` : ""}${headingMissionTitle}`;
    });
    const missionSurfacePath = $derived(
        app.mission?.missionWorktreePath ??
            app.repository?.data.repositoryRootPath ??
            "",
    );

    let missionCommandbarRefreshNonce = $state(0);

    async function handleRepositoryCommandExecuted(): Promise<void> {
        if (!app.repository) {
            return;
        }

        await app.loadRepositoryPage({ repositoryId: app.repository.id });
    }

    async function handleMissionCommandExecuted(): Promise<void> {
        if (!app.repository || !app.mission) {
            return;
        }

        await app.loadMissionPage({
            repositoryId: app.repository.id,
            missionId: app.mission.missionId,
        });
        missionCommandbarRefreshNonce += 1;
    }

    function missionStatusBadgeClass(statusLabel: string | undefined): string {
        switch (statusLabel?.trim().toLowerCase()) {
            case "running":
                return "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300";
            case "completed":
            case "delivered":
                return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
            case "failed":
                return "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300";
            case "paused":
            case "cancelled":
            case "terminated":
                return "border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300";
            default:
                return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
        }
    }

    function currentStageLabel(stageId: string | undefined): string {
        return stageId ? `Current stage ${stageId}` : "No active stage";
    }
</script>

{#if contextKind}
    <div class="min-w-0 flex flex-1 items-center gap-4 overflow-hidden">
        {#if app.mission}
            <div
                class="min-w-0 flex flex-1 items-start justify-between overflow-hidden"
            >
                <h2 class="truncate text-base font-semibold text-foreground">
                    {missionHeading}
                </h2>
                <MissionCommandbar
                    refreshNonce={missionCommandbarRefreshNonce}
                    mission={app.mission}
                    onCommandExecuted={handleMissionCommandExecuted}
                />
            </div>
        {:else if app.repository}
            <div
                class="min-w-0 flex flex-1 items-center justify-between gap-4 overflow-hidden py-1"
            >
                <div class="min-w-0 flex items-center gap-3 overflow-hidden">
                    <span
                        class="inline-flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground"
                    >
                        <Icon icon={repositoryIconIdentifier} class="size-6" />
                    </span>
                    <div
                        class="min-w-0 flex items-center gap-2 overflow-hidden"
                    >
                        <h2
                            class="truncate text-lg font-semibold text-foreground"
                        >
                            {repositoryName}
                        </h2>
                        <div class="flex shrink-0 flex-wrap items-center gap-2">
                            {#if repositoryInvalidState}
                                <Badge variant="destructive" class="shrink-0">
                                    Invalid
                                </Badge>
                            {:else if repositoryRequiresSetup}
                                <Badge variant="secondary" class="shrink-0">
                                    Initialization required
                                </Badge>
                            {/if}
                        </div>
                    </div>
                </div>

                <div class="hidden shrink-0 items-center justify-end xl:flex">
                    <RepositoryCommandbar
                        repository={app.repository}
                        onCommandExecuted={handleRepositoryCommandExecuted}
                    />
                </div>
            </div>
        {/if}
    </div>
{/if}
