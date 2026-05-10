<script lang="ts">
    import type { Artifact as ArtifactEntity } from "./Artifact.svelte.js";
    import ArtifactEditor from "./ArtifactEditor.svelte";
    import { isArtifactTextEditable } from "./ArtifactPresentation.js";
    import ArtifactViewer from "./ArtifactViewer.svelte";

    let {
        refreshNonce,
        artifact,
        onCloseRequested,
    }: {
        refreshNonce: number;
        artifact?: ArtifactEntity;
        onCloseRequested?: () => void;
    } = $props();

    let editing = $state(false);

    const canEditArtifact = $derived(
        isArtifactTextEditable(artifact?.bodyLocationLabel),
    );

    function handleEditRequested(): void {
        if (!artifact || !canEditArtifact) {
            return;
        }

        editing = true;

        if (artifact.bodyStatus === "idle") {
            void artifact.refreshBody().catch(() => {});
        }
    }

    function handleCloseRequested(): void {
        editing = false;
    }
</script>

{#if editing && artifact && canEditArtifact}
    <ArtifactEditor {artifact} onCloseRequested={handleCloseRequested} />
{:else}
    <ArtifactViewer
        {refreshNonce}
        {artifact}
        onEditRequested={handleEditRequested}
        {onCloseRequested}
    />
{/if}
