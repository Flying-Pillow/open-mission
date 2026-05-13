<script lang="ts">
    let { source }: { source: string } = $props();
</script>

<div
    class="image-viewer flex h-full min-h-[24rem] items-center justify-center overflow-auto bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.16),_transparent_45%),linear-gradient(180deg,_rgba(15,23,42,0.04),_rgba(15,23,42,0))] p-6"
>
    <div
        class="w-full max-w-full rounded-xl border border-border/70 bg-background/95 p-4 shadow-sm"
    >
        <img
            class="image-viewer__image mx-auto block h-auto max-w-full"
            src={source}
            alt="Artifact preview"
        />
    </div>
</div>

<style>
    .image-viewer__image {
        max-width: 100%;
    }
</style>
