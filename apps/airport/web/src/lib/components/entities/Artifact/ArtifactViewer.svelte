<script lang="ts">
    import type { Artifact } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import TaskCommandbar from "$lib/components/entities/Task/TaskCommandbar.svelte";
    import type { Task } from "$lib/components/entities/Task/Task.svelte.js";
    import { getScopedMissionContext } from "$lib/client/context/scoped-mission-context.svelte.js";
    import PencilIcon from "@tabler/icons-svelte/icons/pencil";
    import { ArtifactDocumentDataSchema } from "@flying-pillow/mission-core/entities/Artifact/ArtifactSchema";
    import { Button } from "$lib/components/ui/button/index.js";
    import MarkdownViewer from "$lib/components/viewers/markdown.svelte";
    import { qry } from "../../../../routes/api/entities/remote/query.remote";

    let {
        refreshNonce,
        artifact,
        task,
        onEditRequested,
        onCommandExecuted,
    }: {
        refreshNonce: number;
        artifact?: Artifact;
        task?: Task;
        onEditRequested: () => void;
        onCommandExecuted: () => Promise<void>;
    } = $props();
    const missionScope = getScopedMissionContext();
    const mission = $derived(missionScope.mission);

    const panelLabel = $derived(artifact?.label ?? "Resolved artifact");
    const artifactDocumentKey = $derived(
        artifact ? `${artifact.artifactId}:${refreshNonce}` : "none",
    );
    const artifactDocumentQueryInput = $derived.by(() => {
        refreshNonce;
        if (!artifact || !mission) {
            return null;
        }

        return {
            entity: "Artifact",
            method: "readDocument",
            payload: {
                missionId: mission.missionId,
                artifactId: artifact.artifactId,
                ...(mission.missionWorktreePath
                    ? { repositoryRootPath: mission.missionWorktreePath }
                    : {}),
            },
        };
    });
</script>

<section
    class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border bg-card/70 backdrop-blur-sm"
>
    <header class="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2">
        <div class="min-w-0 flex-1">
            <h2 class="truncate text-sm font-semibold text-foreground">
                {panelLabel}
            </h2>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <TaskCommandbar {refreshNonce} {task} {onCommandExecuted} />
        </div>

        {#if artifact}
            <Button variant="outline" size="sm" onclick={onEditRequested}>
                <PencilIcon />
                Edit
            </Button>
        {/if}
    </header>

    <div class="min-h-0 overflow-auto p-2">
        {#if artifact}
            {#if artifactDocumentQueryInput}
                {#key artifactDocumentKey}
                    {#await qry(artifactDocumentQueryInput)}
                        <div
                            class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-muted-foreground"
                        >
                            Loading artifact content...
                        </div>
                    {:then artifactDocumentResult}
                        {@const artifactDocument =
                            ArtifactDocumentDataSchema.parse(
                                artifactDocumentResult,
                            )}
                        <div class="bg-background/80">
                            <MarkdownViewer source={artifactDocument.content} />
                        </div>
                    {:catch loadError}
                        <div
                            class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-rose-600"
                        >
                            {loadError instanceof Error
                                ? loadError.message
                                : String(loadError)}
                        </div>
                    {/await}
                {/key}
            {/if}
        {:else}
            <div
                class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-muted-foreground"
            >
                Select a stage, task, or artifact row to resolve the document
                that belongs in the operator viewer pane.
            </div>
        {/if}
    </div>
</section>
