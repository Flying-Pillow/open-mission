---
title: "PRD: #25 - Generate a documentation route in the airport/web application"
artifact: "prd"
createdAt: "2026-04-20T19:25:26.900Z"
updatedAt: "2026-04-20T21:55:49.555+02:00"
stage: "prd"
---

Branch: mission/25-generate-a-documentation-route-in-the-airport-we

## Outcome

- Add a first-class `/docs` experience to `apps/airport/web` so repository documentation becomes browsable inside the Airport application rather than living only as raw files in the repo.
- Render the repository root `docs/` content through `mdsvex` with a dedicated docs layout, frontmatter-aware page metadata, and file-structure-based navigation that can grow into a durable product documentation surface.
- Adapt the route structure, markdown pipeline, and docs UX patterns from `https://github.com/code-gio/svelte-docs-starter` to the existing Airport web architecture and styling instead of introducing a one-off markdown viewer.

## Problem Statement

- The repository already contains substantial product and architecture documentation under the top-level `docs/` directory, but that material is not surfaced through the Airport web experience.
- This disconnect forces users to leave the application context to discover reference material, which weakens Airport as the primary interface for understanding and operating the system.
- Without a dedicated docs route, the web app has no coherent way to present markdown content with navigable structure, page metadata, or a docs-specific layout, which makes future documentation growth harder and encourages ad hoc rendering approaches.

## Success Criteria

- Visiting `/docs` in `apps/airport/web` presents a docs landing experience rather than a blank route or raw markdown dump.
- Markdown content from the repository root `docs/` directory is reachable under `/docs/...`, including nested documentation paths that mirror the underlying file and folder structure where practical.
- Documentation pages are rendered through `mdsvex`, and supported frontmatter metadata such as `title`, `description`, and `order` is available to the route and used in presentation or navigation.
- The docs area uses a dedicated layout with content framing and navigational affordances suitable for documentation, including active-route awareness and a usable sidebar or equivalent section navigation model.
- The implementation preserves existing Airport web behavior outside the docs surface and leaves clear room for future enhancements such as richer docs UX, search, or table-of-contents features without requiring the docs route to be rebuilt from scratch.
- The resulting product direction clearly reflects `code-gio/svelte-docs-starter` as the architectural and UX reference, while remaining adapted to this repository's app structure rather than copied wholesale.

## Constraints

- Use `BRIEF.md` in this mission as the canonical intake source and treat the mission's product artifacts as the context boundary for the work.
- Source documentation must come from the repository root `docs/` directory; the mission must not create or maintain a duplicated docs tree inside `apps/airport/web`.
- The markdown pipeline must be integrated using standard SvelteKit and `mdsvex` patterns, including preprocessing, markdown extension support, and frontmatter-aware rendering.
- The docs experience must fit the existing `apps/airport/web` architecture, routing model, and styling conventions instead of introducing a disconnected micro-app.
- Navigation should be derived from the existing docs file and folder structure where practical so the product can scale with the repository's documentation without requiring manual duplication of structure.
- The mission should prefer a thin, future-friendly integration that establishes the core docs surface cleanly and leaves room for later improvements such as search, ToC generation, or richer markdown components.

## Non-Goals

- Deliver full parity with every feature in `code-gio/svelte-docs-starter`; that project is a reference, not a drop-in contract.
- Introduce full-text search, versioned documentation, localization, or a comprehensive information architecture rewrite as part of this mission.
- Migrate or rewrite the repository's entire markdown corpus beyond the minimum metadata and content assumptions needed to support the new docs route.
- Create a generic markdown renderer detached from documentation concerns, or expand the mission into unrelated Airport web features outside the `/docs` surface.
