---
title: "SPEC: #25 - Generate a documentation route in the airport/web application"
artifact: "spec"
createdAt: "2026-04-20T19:25:26.900Z"
updatedAt: "2026-04-20T21:57:14.281+02:00"
stage: "spec"
---

Branch: mission/25-generate-a-documentation-route-in-the-airport-we

## Architecture

- `apps/airport/web` will gain a dedicated `/docs` route family that keeps the existing Airport application shell but swaps in a docs-specific content frame: page metadata, a left-hand navigation tree, active-route awareness, and a content column sized for long-form reading instead of repository or mission operations.
- The source of truth remains the repository-root `docs/` directory. The web app must not create or maintain a duplicated documentation tree under `apps/airport/web`; instead it should import and render the existing markdown files directly.
- Markdown rendering will move from the current ad hoc `marked` + `sanitize-html` viewer model to an `mdsvex` pipeline configured in the standard SvelteKit way so markdown files compile into Svelte components and expose frontmatter metadata to the route.
- Because the current `docs/` corpus is Jekyll-flavored rather than mdsvex-native, the docs pipeline must include a narrow compatibility normalization step before or during mdsvex compilation. That normalization is responsible for:
  - accepting existing frontmatter fields such as `title`, `description`, `order`, `nav_title`, `nav_order`, `parent`, and `has_children`
  - treating `layout` as legacy source metadata rather than a web-app layout selector
  - rewriting internal `relative_url` and `.html` links so they resolve to `/docs/...`
  - preserving inline HTML blocks already present in the docs corpus without expanding the scope into a full Jekyll runtime
- Route resolution should mirror the file structure of `docs/`: `/docs` resolves the root `docs/index.md`, section roots resolve `section/index.md` where present, and nested pages resolve the matching markdown file. Navigation should be derived from this same manifest so the route map and sidebar stay consistent.
- Navigation ordering should come from frontmatter first (`order` or compatibility-mapped `nav_order`) and then fall back to file-system order by name. Section and page labels should prefer `nav_title`, then `title`, then a humanized slug.
- The design should follow the same broad shape as `code-gio/svelte-docs-starter`—compiled markdown modules, file-structure-driven navigation, and a dedicated docs layout—but adapted to current Airport components and styling primitives instead of introducing a separate mini-site.
- The docs surface should remain reachable even when the daemon is unavailable. Because docs content comes from repository files rather than daemon-backed snapshots, the global Airport shell may add a narrow `/docs` exception to the current daemon gate without changing the behavior of other routes.

## Signatures

- `DocsFrontmatter`: typed metadata exposed from each compiled markdown page. Required support is `title?: string`, `description?: string`, `order?: number`, with compatibility mapping from legacy `nav_title`, `nav_order`, `parent`, and `has_children`.
- `DocsPage`: route-facing document model containing `slug: string[]`, `href: string`, `title: string`, `description?: string`, `section?: string`, `component: Component`, and enough source metadata to derive navigation and page `<title>` or `<meta>` tags.
- `DocsNavNode`: navigation entry for the sidebar and section groupings. It must distinguish documents from sections, carry `href`, `title`, `children`, and an ordering key derived from normalized frontmatter.
- `loadDocsManifest()`: shared loader that discovers the compiled markdown modules under the repository `docs/` tree, normalizes their metadata, and returns a deterministic set of `DocsPage` records plus a derived navigation tree.
- `resolveDocsPage(slug: string[])`: route helper that maps `/docs` and `/docs/...` requests to the matching page entry and fails explicitly when no matching markdown source exists.
- `normalizeDocsSource()` or equivalent mdsvex/remark compatibility hook: transforms the existing Jekyll-oriented source conventions into the subset the Airport docs route supports, especially internal-link rewriting and legacy frontmatter normalization.
- `/docs` layout load: returns site-wide docs data needed by every docs page, including the navigation tree and any shared site metadata.
- `/docs` page load: returns the resolved `DocsPage` for the current slug so the Svelte route can render the compiled mdsvex component inside the docs layout chrome.
- `DocsContent` or equivalent wrapper component: provides the typography and `:global()` styling hooks needed for the repo's existing `mission-*` HTML blocks once those blocks are rendered through mdsvex.

## Design Boundaries

- This mission adds a documentation surface inside Airport web; it does not turn Airport into a generic CMS or introduce a second documentation authoring system.
- The compatibility layer is intentionally narrow. It should support the conventions already present in this repository's `docs/` tree, but it must not implement Jekyll layouts, includes, Sass compilation, or other full-site-generator behavior.
- Only markdown pages and docs-derived navigation are in scope for the first slice. Search, versioning, localization, generated table-of-contents tooling, and broad content refactors remain out of scope.
- Existing non-doc Airport routes, daemon-backed repository flows, and mission control surfaces must remain untouched except for small discoverability affordances such as adding a `/docs` entry to the shared Airport navigation.
- The existing `src/lib/components/viewers/markdown.svelte` component should remain available for any unrelated raw-markdown use cases, but the new docs route must not depend on that renderer because the product requirement is an `mdsvex`-backed documentation surface.
- Jekyll helper directories and configuration files inside `docs/` (for example `_includes`, `_sass`, and `_config.yml`) are source-context inputs only. They are not the navigation source of record and should not force the Airport docs route to emulate the old Jekyll site behavior.
- Docs-specific presentation should stay isolated to the docs surface. The mission may add global route-gating or navigation hooks where required, but it should not restyle unrelated Airport pages to make the docs route work.

## File Matrix

- `apps/airport/web/package.json`: add the mdsvex dependency and any directly related markdown-processing packages required for the new docs compilation pipeline.
- `pnpm-lock.yaml`: capture the workspace dependency update required by the mdsvex pipeline.
- `apps/airport/web/svelte.config.js` or `apps/airport/web/svelte.config.ts` (new): introduce the explicit SvelteKit configuration needed for mdsvex preprocessing and `.md` route/module support, which the app does not currently define.
- `apps/airport/web/vite.config.ts`: allow the web app to resolve the repository-root `docs/` directory as part of the module graph for the docs manifest and compiled markdown imports.
- `apps/airport/web/src/routes/+layout.svelte`: add the narrow `/docs` daemon-gate exception so the documentation surface remains available without weakening the current behavior of daemon-backed routes.
- `apps/airport/web/src/lib/components/airport/airport-sidebar.svelte`: add a first-class `/docs` navigation entry and active-route state for the shared Airport sidebar.
- `apps/airport/web/src/lib/docs/types.ts` (new): define the normalized docs metadata, page, and navigation contracts used by loaders and route components.
- `apps/airport/web/src/lib/docs/manifest.ts` (new): own discovery of the repository `docs/` markdown modules, compatibility normalization, slug resolution, and navigation derivation.
- `apps/airport/web/src/lib/docs/link-rewrite.ts` (new): isolate the internal-docs link rewriting needed to convert current `relative_url` and `.html` patterns into Airport `/docs/...` routes.
- `apps/airport/web/src/lib/components/docs/` (new docs-specific components directory): hold the dedicated docs layout pieces such as the sidebar, page header, and content shell rather than overloading repository or mission UI components.
- `apps/airport/web/src/routes/docs/+layout.server.ts` (new): load shared docs navigation and site metadata for the docs surface.
- `apps/airport/web/src/routes/docs/+layout.svelte` (new): render the dedicated docs frame, including sidebar navigation and the main content slot.
- `apps/airport/web/src/routes/docs/[[...slug]]/+page.ts` or `+page.server.ts` (new): resolve the current docs slug to a normalized `DocsPage` record, including `/docs` -> `docs/index.md`.
- `apps/airport/web/src/routes/docs/[[...slug]]/+page.svelte` (new): mount the resolved mdsvex component and project the normalized frontmatter into page chrome and document metadata.
