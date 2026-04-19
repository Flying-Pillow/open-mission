<!-- /apps/airport/web/src/lib/components/viewers/markdown.svelte: Shared markdown viewer for Airport web based on the Flying Pillow renderer pattern. -->
<script lang="ts">
    import { marked } from "marked";
    import sanitizeHtml from "sanitize-html";

    let { source }: { source: string } = $props();

    const rendered = $derived.by(() =>
        sanitizeHtml(
            marked.parse(source ?? "", { breaks: true, gfm: true }) as string,
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
</script>

<div class="markdown max-w-none break-words p-2 text-sm text-foreground">
    {@html rendered}
</div>

<style>
    :global(.markdown > :first-child) {
        margin-top: 0;
    }

    :global(.markdown > :last-child) {
        margin-bottom: 0;
    }

    :global(.markdown h1) {
        margin-top: 2rem;
        scroll-margin-top: 5rem;
        font-size: 2.25rem;
        line-height: 2.5rem;
        font-weight: 800;
        letter-spacing: -0.025em;
        text-wrap: balance;
    }

    :global(.markdown h2) {
        margin-top: 2.5rem;
        padding-bottom: 0.5rem;
        scroll-margin-top: 5rem;
        border-bottom: 1px solid var(--border);
        font-size: 1.875rem;
        line-height: 2.25rem;
        font-weight: 600;
        letter-spacing: -0.025em;
    }

    :global(.markdown h3) {
        margin-top: 2rem;
        scroll-margin-top: 5rem;
        font-size: 1.5rem;
        line-height: 2rem;
        font-weight: 600;
        letter-spacing: -0.025em;
    }

    :global(.markdown h4) {
        margin-top: 2rem;
        scroll-margin-top: 5rem;
        font-size: 1.25rem;
        line-height: 1.75rem;
        font-weight: 600;
        letter-spacing: -0.025em;
    }

    :global(.markdown p) {
        margin-top: 1.5rem;
        line-height: 1.75rem;
    }

    :global(.markdown a) {
        color: var(--primary);
        font-weight: 500;
        text-decoration-line: underline;
        text-underline-offset: 4px;
    }

    :global(.markdown strong) {
        color: var(--foreground);
        font-weight: 600;
    }

    :global(.markdown blockquote) {
        margin-top: 1.5rem;
        border-inline-start: 2px solid var(--border);
        padding-inline-start: 1.5rem;
        color: var(--muted-foreground);
        font-style: italic;
    }

    :global(.markdown ul) {
        margin: 1.5rem 0 1.5rem 1.5rem;
        list-style-type: disc;
    }

    :global(.markdown ol) {
        margin: 1.5rem 0 1.5rem 1.5rem;
        list-style-type: decimal;
    }

    :global(.markdown li + li) {
        margin-top: 0.5rem;
    }

    :global(.markdown li > p) {
        margin-top: 0.5rem;
    }

    :global(.markdown hr) {
        margin: 2rem 0;
        border: 0;
        border-top: 1px solid var(--border);
    }

    :global(.markdown code) {
        position: relative;
        border-radius: 0.375rem;
        background: var(--muted);
        padding: 0.2rem 0.3rem;
        color: var(--foreground);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
        font-size: 0.875rem;
        font-weight: 600;
    }

    :global(.markdown pre) {
        margin: 1.5rem 0;
        overflow-x: auto;
        border: 1px solid var(--border);
        border-radius: 0.75rem;
        background: var(--muted);
        color: var(--foreground);
        padding: 0.75rem 1rem;
    }

    :global(.markdown pre code) {
        background: transparent;
        padding: 0;
        font-weight: 500;
    }

    :global(.markdown table) {
        margin: 1.5rem 0;
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
    }

    :global(.markdown thead tr) {
        border-top: 1px solid var(--border);
        background: var(--muted);
    }

    :global(.markdown tbody tr) {
        border-top: 1px solid var(--border);
    }

    :global(.markdown tbody tr:nth-child(even)) {
        background: color-mix(in oklab, var(--muted) 55%, transparent);
    }

    :global(.markdown th) {
        border: 1px solid var(--border);
        padding: 0.5rem 1rem;
        text-align: left;
        font-weight: 700;
    }

    :global(.markdown td) {
        border: 1px solid var(--border);
        padding: 0.5rem 1rem;
        text-align: left;
        vertical-align: top;
    }

    :global(.markdown img) {
        margin: 1.5rem 0;
        border: 1px solid var(--border);
        border-radius: 0.75rem;
    }

    :global(.markdown :is(th, td)[align="center"]) {
        text-align: center;
    }

    :global(.markdown :is(th, td)[align="right"]) {
        text-align: right;
    }
</style>
