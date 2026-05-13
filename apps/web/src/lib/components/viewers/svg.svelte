<script lang="ts">
    import { browser } from "$app/environment";

    let { source }: { source: string } = $props();

    const rendered = $derived.by(() => {
        if (!browser) {
            return "";
        }

        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source ?? "")}`;
    });
</script>

<div
    class="svg-viewer flex h-full min-h-[24rem] items-center justify-center overflow-auto bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.16),_transparent_45%),linear-gradient(180deg,_rgba(15,23,42,0.04),_rgba(15,23,42,0))] p-6"
>
    <div
        class="w-full max-w-full rounded-xl border border-border/70 bg-background/95 p-4 shadow-sm"
    >
        <img
            class="svg-viewer__image mx-auto block h-auto max-w-full"
            src={rendered}
            alt="SVG artifact preview"
        />
    </div>
</div>

<style>
    .svg-viewer__image {
        max-width: 100%;
    }
</style>
