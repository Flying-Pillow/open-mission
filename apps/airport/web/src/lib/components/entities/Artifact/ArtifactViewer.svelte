<script lang="ts">
    import type { Artifact } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import Icon from "@iconify/svelte";
    import { ArtifactBodySchema } from "@flying-pillow/mission-core/entities/Artifact/ArtifactSchema";
    import { Button } from "$lib/components/ui/button/index.js";
    import ImageViewer from "$lib/components/viewers/image.svelte";
    import MarkdownViewer from "$lib/components/viewers/markdown.svelte";
    import SvgViewer from "$lib/components/viewers/svg.svelte";
    import TextViewer from "$lib/components/viewers/text.svelte";
    import {
        isArtifactTextEditable,
        resolveArtifactViewerKind,
    } from "./ArtifactPresentation.js";

    let {
        refreshNonce,
        artifact,
        onEditRequested,
        onCloseRequested,
    }: {
        refreshNonce: number;
        artifact?: Artifact;
        onEditRequested: () => void | Promise<void>;
        onCloseRequested?: () => void | Promise<void>;
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
        return Boolean(artifact && viewerKind !== "unsupported");
    });
    const artifactBodyKey = $derived(
        artifact ? `${artifact.id}:${refreshNonce}` : "none",
    );
</script>

<section
    class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border bg-card/70 backdrop-blur-sm"
>
    <header class="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2">
        <div class="min-w-0 flex-1">
            <h2 class="truncate text-sm font-semibold text-foreground">
                {panelLabel}
            </h2>
        </div>

        {#if artifact && canEditArtifact}
            <Button variant="outline" size="sm" onclick={onEditRequested}>
                <Icon icon="lucide:pencil" />
                Edit
            </Button>
        {/if}

        {#if onCloseRequested}
            <Button variant="ghost" size="icon" onclick={onCloseRequested}>
                <Icon icon="lucide:x" />
                <span class="sr-only">Close artifact viewer</span>
            </Button>
        {/if}
    </header>

    <div class="min-h-0 overflow-auto">
        {#if artifact}
            {#if canReadArtifactBody}
                {#key artifactBodyKey}
                    {#await artifact?.readForRender()}
                        <div
                            class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-muted-foreground"
                        >
                            Loading artifact...
                        </div>
                    {:then artifactBodyResult}
                        {@const artifactBody =
                            ArtifactBodySchema.parse(artifactBodyResult)}
                        {#if typeof artifactBody.body !== "string"}
                            <div
                                class="flex h-full min-h-[24rem] items-center justify-center bg-background/60 px-6 py-8 text-center text-sm text-rose-600"
                            >
                                This artifact body is not renderable.
                            </div>
                        {:else if viewerKind === "image"}
                            <ImageViewer source={artifactBody.body} />
                        {:else if viewerKind === "markdown"}
                            <MarkdownViewer source={artifactBody.body} />
                        {:else if viewerKind === "svg"}
                            <SvgViewer source={artifactBody.body} />
                        {:else}
                            <TextViewer source={artifactBody.body} />
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
                    Preview is unavailable for this artifact.
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
