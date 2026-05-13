<script lang="ts">
    import { browser } from "$app/environment";
    import { resolveShikiLanguage } from "$lib/components/entities/Artifact/ArtifactPresentation.js";

    let {
        source,
        fileNameOrPath,
    }: {
        source: string;
        fileNameOrPath?: string;
    } = $props();

    const shikiLanguage = $derived(resolveShikiLanguage(fileNameOrPath));
    const plainTextHtml = $derived(renderPlainTextHtml(source));

    let highlightedHtml = $state<string | undefined>();
    const renderedSource = $derived(highlightedHtml ?? plainTextHtml);

    $effect(() => {
        if (!browser) {
            highlightedHtml = undefined;
            return;
        }

        highlightedHtml = undefined;

        if (!shikiLanguage) {
            return;
        }

        const abortController = new AbortController();

        void fetch("/api/viewers/text-highlight", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                source,
                language: shikiLanguage,
            }),
            signal: abortController.signal,
        })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(
                        `Highlight request failed with ${response.status}`,
                    );
                }

                const payload = (await response.json()) as { html?: string };
                if (payload.html) {
                    highlightedHtml = payload.html;
                }
            })
            .catch((error) => {
                if (
                    error instanceof DOMException &&
                    error.name === "AbortError"
                ) {
                    return;
                }

                highlightedHtml = undefined;
            });

        return () => {
            abortController.abort();
        };
    });

    function renderPlainTextHtml(value: string): string {
        return `<pre class="artifact-text-viewer__plain">${escapeHtml(value)}</pre>`;
    }

    function escapeHtml(value: string): string {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }
</script>

<div
    class="artifact-text-viewer h-full min-h-[24rem] overflow-auto bg-background/80"
>
    {@html renderedSource}
</div>

<style>
    .artifact-text-viewer :global(pre) {
        margin: 0;
        min-height: 24rem;
        overflow: auto;
        padding: 1rem;
        font-family: var(--font-mono, monospace);
        font-size: 0.875rem;
        line-height: 1.5rem;
    }

    .artifact-text-viewer :global(pre.shiki) {
        color: var(--mission-shiki-light);
        background-color: var(--mission-shiki-light-bg) !important;
        background: transparent !important;
    }

    :global(.dark) .artifact-text-viewer :global(pre.shiki) {
        color: var(--mission-shiki-dark);
        background-color: var(--mission-shiki-dark-bg) !important;
    }

    .artifact-text-viewer :global(pre.shiki code) {
        display: block;
        min-width: max-content;
    }

    .artifact-text-viewer :global(pre.shiki span) {
        color: var(--mission-shiki-light);
    }

    :global(.dark) .artifact-text-viewer :global(pre.shiki span) {
        color: var(--mission-shiki-dark);
    }

    .artifact-text-viewer :global(.artifact-text-viewer__plain) {
        white-space: pre-wrap;
        word-break: break-word;
    }
</style>
