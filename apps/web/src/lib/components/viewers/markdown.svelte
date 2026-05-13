<!-- /apps/web/src/lib/components/viewers/markdown.svelte: Shared markdown viewer for Open Mission web based on the Flying Pillow renderer pattern. -->
<script lang="ts">
    import { mode } from "mode-watcher";
    import { marked } from "marked";
    import { browser } from "$app/environment";
    import { sanitizeBrowserHtml } from "$lib/client/runtime/html-sanitizer";
    import { renderMermaidDiagrams } from "../../utils/mermaid.ts";
    import { tick } from "svelte";

    let {
        source,
        compact = false,
    }: {
        source: string;
        compact?: boolean;
    } = $props();
    let containerElement = $state<HTMLElement | null>(null);

    type MarkdownDocument = {
        frontmatterRows: FrontmatterRow[];
        body: string;
    };

    type FrontmatterRow = {
        key: string;
        value: string;
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
            return { frontmatterRows: [], body: normalized };
        }

        const closingIndex = normalized.indexOf("\n---\n", 4);
        if (closingIndex < 0) {
            return { frontmatterRows: [], body: normalized };
        }

        const frontmatter = normalized.slice(4, closingIndex).trim();

        return {
            frontmatterRows: parseFrontmatterRows(frontmatter),
            body: normalized.slice(closingIndex + 5),
        };
    }

    function parseFrontmatterRows(frontmatter: string): FrontmatterRow[] {
        const rows: FrontmatterRow[] = [];
        let activeRow: FrontmatterRow | null = null;

        for (const line of frontmatter.split("\n")) {
            if (!line.trim()) {
                continue;
            }

            const fieldMatch = /^(?<key>[^\s:#][^:]*):\s*(?<value>.*)$/.exec(
                line,
            );
            if (fieldMatch?.groups) {
                activeRow = {
                    key: fieldMatch.groups.key.trim(),
                    value: fieldMatch.groups.value.trim(),
                };
                rows.push(activeRow);
                continue;
            }

            const continuation = line.trim();
            if (activeRow) {
                activeRow.value = activeRow.value
                    ? `${activeRow.value}\n${continuation}`
                    : continuation;
                continue;
            }

            rows.push({ key: "", value: continuation });
        }

        return rows;
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
    class={`markdown-viewer max-w-none break-words text-sm text-foreground ${compact ? "p-0" : "p-2 pb-6"}`}
>
    {#if markdownDocument.frontmatterRows.length}
        <table class="markdown-frontmatter" aria-label="Frontmatter">
            <tbody>
                {#each markdownDocument.frontmatterRows as row, rowIndex (`${row.key}:${rowIndex}`)}
                    <tr>
                        {#if row.key}
                            <th scope="row">{row.key}</th>
                            <td>{row.value}</td>
                        {:else}
                            <td colspan="2">{row.value}</td>
                        {/if}
                    </tr>
                {/each}
            </tbody>
        </table>
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
