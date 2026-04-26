<script lang="ts">
    import type { Artifact } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import ArtifactActionbar from "$lib/components/entities/Artifact/ArtifactActionbar.svelte";
    import { getScopedMissionContext } from "$lib/client/context/scoped-mission-context.svelte.js";
    import PencilIcon from "@tabler/icons-svelte/icons/pencil";
    import { Button } from "$lib/components/ui/button/index.js";
    import MarkdownViewer from "$lib/components/viewers/markdown.svelte";
    import TaskActionbar from "$lib/components/entities/Task/TaskActionbar.svelte";

    let {
        refreshNonce,
        artifact,
        onEditRequested,
        onActionExecuted,
    }: {
        refreshNonce: number;
        artifact?: Artifact;
        onEditRequested: () => void;
        onActionExecuted: () => Promise<void>;
    } = $props();
    const missionScope = getScopedMissionContext();
    const mission = $derived(missionScope.mission);

    const panelLabel = $derived(artifact?.label ?? "Resolved artifact");
    const artifactDocumentPromise = $derived(
        artifact && mission
            ? artifact.read({ executionContext: "render" })
            : null,
    );
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

        {#if artifact}
            <Button variant="outline" size="sm" onclick={onEditRequested}>
                <PencilIcon />
                Edit
            </Button>
        {/if}

        <div class="flex flex-wrap items-center gap-2">
            <TaskActionbar
                {refreshNonce}
                stageId={artifact?.stageId}
                taskId={artifact?.taskId}
                {onActionExecuted}
            />

            <ArtifactActionbar
                {refreshNonce}
                stageId={artifact?.stageId}
                taskId={artifact?.taskId}
                artifactPath={artifact?.filePath}
                {onActionExecuted}
            />
        </div>
    </header>

    <div class="min-h-0 overflow-auto p-2">
        {#if artifact}
            {#if artifactDocumentPromise}
                {#await artifactDocumentPromise}
                    <div
                        class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-muted-foreground"
                    >
                        Loading artifact content...
                    </div>
                {:then artifactDocument}
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
