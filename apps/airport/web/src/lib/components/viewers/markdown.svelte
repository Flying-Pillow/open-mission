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

<style>
    .markdown-viewer {
        --markdown-fg: #1f2328;
        --markdown-muted: #656d76;
        --markdown-link: #0969da;
        --markdown-border: #d0d7de;
        --markdown-code-bg: #f6f8fa;
        --markdown-pre-bg: #f6f8fa;
        --markdown-table-header-bg: #f6f8fa;
    }

    :global(.dark .markdown-viewer) {
        --markdown-fg: #e6edf3;
        --markdown-muted: #9198a1;
        --markdown-link: #4493f8;
        --markdown-border: #3d444d;
        --markdown-code-bg: #161b22;
        --markdown-pre-bg: #161b22;
        --markdown-table-header-bg: #161b22;
    }

    :global(.markdown) {
        color: var(--markdown-fg);
        font-size: 1rem;
        line-height: 1.5;
        word-wrap: break-word;
    }

    .markdown-frontmatter {
        margin: 0 0 1rem;
        overflow-x: auto;
        border: 1px solid var(--markdown-border);
        border-radius: 0.375rem;
        background: var(--markdown-code-bg);
        padding: 1rem;
        color: var(--markdown-muted);
        font-family: "Courier New", Courier, ui-monospace, monospace;
        font-size: 0.75rem;
        line-height: 1.5;
        white-space: pre-wrap;
    }

    :global(.markdown > :first-child) {
        margin-top: 0;
    }

    :global(.markdown > :last-child) {
        margin-bottom: 0;
    }

    :global(.markdown h1) {
        margin: 1.5rem 0 1rem;
        scroll-margin-top: 5rem;
        border-bottom: 1px solid var(--markdown-border);
        padding-bottom: 0.3em;
        color: var(--markdown-fg);
        font-size: 2em;
        line-height: 1.25;
        font-weight: 600;
    }

    :global(.markdown h2) {
        margin: 1.5rem 0 1rem;
        scroll-margin-top: 5rem;
        border-bottom: 1px solid var(--markdown-border);
        padding-bottom: 0.3em;
        color: var(--markdown-fg);
        font-size: 1.5em;
        line-height: 1.25;
        font-weight: 600;
    }

    :global(.markdown h3) {
        margin: 1.5rem 0 1rem;
        scroll-margin-top: 5rem;
        color: var(--markdown-fg);
        font-size: 1.25em;
        line-height: 1.25;
        font-weight: 600;
    }

    :global(.markdown h4) {
        margin: 1.5rem 0 1rem;
        scroll-margin-top: 5rem;
        color: var(--markdown-fg);
        font-size: 1em;
        line-height: 1.25;
        font-weight: 600;
    }

    :global(.markdown h5) {
        margin: 1.5rem 0 1rem;
        color: var(--markdown-fg);
        font-size: 0.875em;
        line-height: 1.25;
        font-weight: 600;
    }

    :global(.markdown h6) {
        margin: 1.5rem 0 1rem;
        color: var(--markdown-muted);
        font-size: 0.85em;
        line-height: 1.25;
        font-weight: 600;
    }

    :global(.markdown p) {
        margin: 0 0 1rem;
    }

    :global(.markdown blockquote p:last-child) {
        margin-bottom: 0;
    }

    :global(.markdown :is(ul, ol, li, td, th)) {
        color: inherit;
    }

    :global(.markdown a) {
        color: var(--markdown-link);
        text-decoration-line: underline;
        text-underline-offset: 4px;
    }

    :global(.markdown strong) {
        color: var(--markdown-fg);
        font-weight: 600;
    }

    :global(.markdown blockquote) {
        margin: 0 0 1rem;
        border-inline-start: 0.25em solid var(--markdown-border);
        padding-inline-start: 1em;
        color: var(--markdown-muted);
    }

    :global(.markdown ul),
    :global(.markdown ol) {
        margin: 0 0 1rem;
        padding-left: 2em;
    }

    :global(.markdown ul) {
        list-style-type: disc;
    }

    :global(.markdown ol) {
        list-style-type: decimal;
    }

    :global(.markdown li + li) {
        margin-top: 0.25rem;
    }

    :global(.markdown li > p) {
        margin: 0.25rem 0;
    }

    :global(.markdown hr) {
        margin: 1.5rem 0;
        border: 0;
        border-top: 1px solid var(--markdown-border);
    }

    :global(.markdown code) {
        border-radius: 0.375rem;
        background: var(--markdown-code-bg);
        padding: 0.2em 0.4em;
        color: var(--markdown-fg);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
        font-size: 85%;
    }

    :global(.markdown pre) {
        margin: 0 0 1rem;
        overflow-x: auto;
        border: 1px solid var(--markdown-border);
        border-radius: 0.375rem;
        background: var(--markdown-pre-bg);
        color: var(--markdown-fg);
        padding: 1rem;
    }

    :global(.markdown pre code) {
        background: transparent;
        padding: 0;
        color: inherit;
        font-size: 100%;
    }

    :global(.markdown table) {
        display: block;
        margin: 0 0 1rem;
        overflow-x: auto;
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
    }

    :global(.markdown thead tr) {
        border-top: 1px solid var(--markdown-border);
        background: var(--markdown-table-header-bg);
    }

    :global(.markdown tbody tr) {
        border-top: 1px solid var(--markdown-border);
    }

    :global(.markdown th) {
        border: 1px solid var(--markdown-border);
        padding: 0.375rem 0.8125rem;
        text-align: left;
        font-weight: 600;
    }

    :global(.markdown td) {
        border: 1px solid var(--markdown-border);
        padding: 0.375rem 0.8125rem;
        text-align: left;
        vertical-align: top;
    }

    :global(.markdown img) {
        display: block;
        max-width: 100%;
        margin: 0 0 1rem;
        border: 1px solid var(--markdown-border);
        border-radius: 0.375rem;
    }

    :global(.markdown :is(th, td)[align="center"]) {
        text-align: center;
    }

    :global(.markdown :is(th, td)[align="right"]) {
        text-align: right;
    }
</style>
