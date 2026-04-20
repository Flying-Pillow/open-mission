<!-- /apps/airport/web/src/lib/components/viewers/markdown.svelte: Shared markdown viewer for Airport web based on the Flying Pillow renderer pattern. -->
<script lang="ts">
    import { marked } from "marked";
    import sanitizeHtml from "sanitize-html";

    let { source }: { source: string } = $props();

    type MarkdownDocument = {
        frontmatter: string | null;
        body: string;
    };

    const document = $derived.by(() => splitFrontmatter(source ?? ""));

    const rendered = $derived.by(() =>
        sanitizeHtml(
            marked.parse(document.body, { breaks: true, gfm: true }) as string,
            {
                allowedTags: sanitizeHtml.defaults.allowedTags.concat([
                    "h1",
                    "h2",
                    "h3",
                    "h4",
                    "h5",
                    "h6",
                    "img",
                    "table",
                    "thead",
                    "tbody",
                    "tr",
                    "th",
                    "td",
                ]),
                allowedAttributes: {
                    ...sanitizeHtml.defaults.allowedAttributes,
                    a: ["href", "name", "target", "rel"],
                    img: ["src", "alt", "title"],
                },
                allowedSchemes: ["http", "https", "mailto"],
            },
        ),
    );

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
</script>

<div
    class="markdown-viewer max-w-none break-words p-2 pb-6 text-sm text-foreground"
>
    {#if document.frontmatter}
        <pre class="markdown-frontmatter">{document.frontmatter}</pre>
    {/if}

    <div class="markdown">
        {@html rendered}
    </div>
</div>
