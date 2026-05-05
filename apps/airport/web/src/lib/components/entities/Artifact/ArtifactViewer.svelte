<script lang="ts">
    import type { Artifact } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import TaskCommandbar from "$lib/components/entities/Task/TaskCommandbar.svelte";
    import type { Task } from "$lib/components/entities/Task/Task.svelte.js";
    import Icon from "@iconify/svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import MarkdownViewer from "$lib/components/viewers/markdown.svelte";
    import {
        isArtifactTextEditable,
        resolveArtifactViewerKind,
    } from "./ArtifactPresentation.js";

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

    const panelLabel = $derived(artifact?.label ?? "");
    const artifactBodyLocation = $derived(artifact?.bodyLocationLabel);
    const viewerKind = $derived(
        resolveArtifactViewerKind(artifactBodyLocation),
    );
    const canEditArtifact = $derived(
        isArtifactTextEditable(artifactBodyLocation),
    );
    const canReadArtifactBody = $derived.by(() => {
        refreshNonce;
        return Boolean(
            artifact && viewerKind !== "unsupported" && viewerKind !== "image",
        );
    });
    const artifactBodyKey = $derived(
        artifact ? `${artifact.id}:${refreshNonce}` : "none",
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

        <div class="flex flex-wrap items-center gap-2">
            <TaskCommandbar {refreshNonce} {task} {onCommandExecuted} />
        </div>

        {#if artifact && canEditArtifact}
            <Button variant="outline" size="sm" onclick={onEditRequested}>
                <Icon icon="lucide:pencil" />
                Edit
            </Button>
        {/if}
    </header>

    <div class="min-h-0 overflow-auto p-2">
        {#if artifact}
            {#if canReadArtifactBody}
                {#key artifactBodyKey}
                    {#await artifact.read({ executionContext: "render" })}
                        <div
                            class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-muted-foreground"
                        >
                            Loading artifact...
                        </div>
                    {:then artifactBodyResult}
                        {@const artifactBody = artifactBodyResult}
                        {#if viewerKind === "markdown"}
                            {#if typeof artifactBody.body !== "string"}
                                <div
                                    class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-rose-600"
                                >
                                    This artifact body is not text.
                                </div>
                            {:else}
                                <div class="bg-background/80">
                                    <MarkdownViewer
                                        source={artifactBody.body}
                                    />
                                </div>
                            {/if}
                        {:else if typeof artifactBody.body !== "string"}
                            <div
                                class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-rose-600"
                            >
                                This artifact body is not text.
                            </div>
                        {:else}
                            <pre
                                class="min-h-[24rem] overflow-auto rounded border bg-background/80 p-4 font-mono text-sm leading-6 text-foreground whitespace-pre-wrap">{artifactBody.body}</pre>
                        {/if}
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
            {:else}
                <div
                    class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-muted-foreground"
                >
                    {#if viewerKind === "image"}
                        Image preview is selected for this artifact.
                    {:else}
                        Preview is unavailable for this artifact.
                    {/if}
                </div>
            {/if}
        {:else}
            <div
                class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-muted-foreground"
            >
                Select a stage, task, or artifact row to resolve the artifact
                that belongs in the operator viewer pane.
            </div>
        {/if}
    </div>
</section>
