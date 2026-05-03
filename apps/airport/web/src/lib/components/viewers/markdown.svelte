<!-- /apps/airport/web/src/lib/components/viewers/markdown.svelte: Shared markdown viewer for Airport web based on the Flying Pillow renderer pattern. -->
<script lang="ts">
    import { mode } from "mode-watcher";
    import { marked } from "marked";
    import { browser } from "$app/environment";
    import { sanitizeBrowserHtml } from "$lib/client/runtime/html-sanitizer";
    import { renderMermaidDiagrams } from "../../utils/mermaid.ts";
    import { tick } from "svelte";

    let { source }: { source: string } = $props();
    let containerElement = $state<HTMLElement | null>(null);

    type MarkdownDocument = {
        frontmatter: string | null;
        body: string;
    };

    const markdownDocument = $derived.by(() => splitFrontmatter(source ?? ""));

    const rendered = $derived.by(() => {
        const html = marked.parse(markdownDocument.body, {
            breaks: true,
            gfm: true,
        }) as string;

        return browser
            ? sanitizeBrowserHtml(html, {
                  allowedTags: [
                      "a",
                      "blockquote",
                      "br",
                      "code",
                      "dd",
                      "del",
                      "div",
                      "dl",
                      "dt",
                      "em",
                      "h1",
                      "h2",
                      "h3",
                      "h4",
                      "h5",
                      "h6",
                      "hr",
                      "img",
                      "li",
                      "ol",
                      "p",
                      "pre",
                      "span",
                      "strong",
                      "table",
                      "tbody",
                      "td",
                      "th",
                      "thead",
                      "tr",
                      "ul",
                  ],
                  allowedAttributes: {
                      "*": ["class"],
                      a: ["href", "name", "target", "rel"],
                      img: ["src", "alt", "title"],
                  },
                  allowedSchemes: ["http", "https", "mailto"],
              })
            : "";
    });

    function splitFrontmatter(content: string): MarkdownDocument {
        const normalized = content.replace(/\r\n/g, "\n");
        if (!normalized.startsWith("---\n")) {
            return { frontmatter: null, body: normalized };
        }

        const closingIndex = normalized.indexOf("\n---\n", 4);
        if (closingIndex < 0) {
            return { frontmatter: null, body: normalized };
        }

        return {
            frontmatter: normalized.slice(0, closingIndex + 5).trimEnd(),
            body: normalized.slice(closingIndex + 5),
        };
    }

    async function enhanceContent(): Promise<void> {
        if (!containerElement) {
            return;
        }

        await tick();
        if (!containerElement) {
            return;
        }

        await renderMermaidDiagrams(containerElement);
    }

    $effect(() => {
        rendered;
        containerElement;
        void enhanceContent();
    });
</script>

<div
    bind:this={containerElement}
    class="markdown-viewer max-w-none break-words p-2 pb-6 text-sm text-foreground"
>
    {#if markdownDocument.frontmatter}
        <pre class="markdown-frontmatter">{markdownDocument.frontmatter}</pre>
    {/if}

    <div class="markdown markdown-body" data-theme={mode.current}>
        {@html rendered}
    </div>
</div>

<style>
    :global(.markdown-viewer .mermaid) {
        margin: 1.5rem 0;
        overflow-x: auto;
    }

    :global(.markdown-viewer .mermaid svg) {
        height: auto;
        max-width: 100%;
    }
</style>
