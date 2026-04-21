<script lang="ts">
    import PencilIcon from "@tabler/icons-svelte/icons/pencil";
    import { Button } from "$lib/components/ui/button/index.js";
    import MarkdownViewer from "$lib/components/viewers/markdown.svelte";
    import TaskActionbar from "$lib/components/entities/Task/TaskActionbar.svelte";
    import type { MissionStageId } from "@flying-pillow/mission-core/types.js";

    let {
        missionId,
        repositoryId,
        repositoryRootPath,
        refreshNonce,
        artifactPath,
        artifactLabel,
        stageId,
        taskId,
        onEditRequested,
        onActionExecuted,
    }: {
        missionId: string;
        repositoryId: string;
        repositoryRootPath: string;
        refreshNonce: number;
        artifactPath?: string;
        artifactLabel?: string;
        stageId?: MissionStageId;
        taskId?: string;
        onEditRequested: () => void;
        onActionExecuted: () => Promise<void>;
    } = $props();

    const panelLabel = $derived(
        artifactLabel ?? basename(artifactPath) ?? "Resolved artifact",
    );
    const artifactDocumentPromise = $derived(
        artifactPath
            ? loadArtifactDocument(missionId, repositoryRootPath, artifactPath)
            : null,
    );

    async function loadArtifactDocument(
        missionId: string,
        repositoryRootPath: string,
        path: string,
    ): Promise<{ content: string }> {
        const searchParams = new URLSearchParams({
            path,
            repositoryRootPath,
        });
        const response = await fetch(
            `/api/runtime/missions/${encodeURIComponent(missionId)}/documents?${searchParams.toString()}`,
        );
        if (!response.ok) {
            throw new Error(`Artifact load failed (${response.status}).`);
        }

        const payload = (await response.json()) as {
            content: string;
            updatedAt?: string;
        };
        return { content: payload.content };
    }

    function basename(filePath: string | undefined): string | undefined {
        if (!filePath) {
            return undefined;
        }
        const normalized = filePath.replace(/\\/g, "/");
        return normalized.split("/").pop() ?? normalized;
    }
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

        {#if artifactPath}
            <Button variant="outline" size="sm" onclick={onEditRequested}>
                <PencilIcon />
                Edit
            </Button>
        {/if}

        <TaskActionbar
            {missionId}
            {repositoryId}
            {repositoryRootPath}
            {refreshNonce}
            {stageId}
            {taskId}
            {onActionExecuted}
        />
    </header>

    <div class="min-h-0 overflow-auto p-2">
        {#if artifactPath}
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
