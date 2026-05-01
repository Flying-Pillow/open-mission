<script lang="ts">
    import type { Artifact } from "$lib/components/entities/Artifact/Artifact.svelte.js";

    let {
        refreshNonce,
        artifact,
        onCommandExecuted,
    }: {
        refreshNonce: number;
        artifact?: Artifact;
        onCommandExecuted: () => Promise<void>;
    } = $props();

    $effect(() => {
        refreshNonce;
        artifact;
        onCommandExecuted;
    });
</script>
