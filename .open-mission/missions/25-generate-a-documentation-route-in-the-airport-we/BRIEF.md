---
issueId: 25
title: "Generate a documentation route in the airport/web application"
type: "feature"
branchRef: "mission/25-generate-a-documentation-route-in-the-airport-we"
createdAt: "2026-04-20T19:25:26.900Z"
updatedAt: "2026-04-20T19:25:26.900Z"
url: "https://api.github.com/repos/Flying-Pillow/mission/issues/25"
---

Issue: #25

## Summary

Add a first-class `/docs` route to `apps/airport/web` that renders the repository’s top-level `docs/` content through `mdsvex`, using `https://github.com/code-gio/svelte-docs-starter` as the implementation reference.

The goal is to make our existing documentation browsable inside the Airport web app, with a structure that can grow into a proper product docs experience rather than a one-off markdown renderer.

## Problem

We already maintain a substantial amount of product and architecture documentation in the repo-level `docs/` folder, but it is not surfaced as part of the Airport web experience. This creates a gap between the application and the documentation that explains how the system works.

We want a dedicated docs surface in `airport/web` that:

- mounts at `/docs`
- renders markdown via `mdsvex`
- uses a docs-oriented layout and navigation model
- is designed with the `code-gio/svelte-docs-starter` approach as the reference point

## Proposed Direction

Implement a docs route in `apps/airport/web` that consumes markdown content from the repository `docs/` directory and exposes it under `/docs`.

Use `code-gio/svelte-docs-starter` as the reference for:

- docs route structure
- markdown-to-page rendering via `mdsvex`
- frontmatter conventions
- sidebar/navigation generation
- docs layout patterns
- future-friendly docs UX primitives

This should be adapted to our existing app architecture and styling rather than copied verbatim.

## Scope

### In scope

- Add `mdsvex` support to `apps/airport/web`
- Configure SvelteKit to support `.md` content alongside existing app routes
- Create a `/docs` route group in `airport/web`
- Render content from the repo-level `docs/` folder
- Support basic frontmatter metadata such as:
  - `title`
  - `description`
  - `order`
- Build a docs layout with:
  - page title
  - body content
  - sidebar or section navigation
  - active-route awareness
- Generate navigation from the existing docs folder structure where practical
- Keep the implementation aligned with the patterns in `code-gio/svelte-docs-starter`

### Out of scope

- Full search/indexing
- i18n docs support
- versioned docs
- migration of all markdown conventions
- large-scale rewrite of existing docs content
- perfect parity with every `svelte-docs-starter` feature

## Implementation Notes

- The source content should come from the repo root `docs/` directory, not a duplicated docs tree inside `apps/airport/web`
- Prefer a thin integration that maps our existing docs structure into a docs UI
- Use `mdsvex` in the standard SvelteKit way:
  - configure markdown extensions
  - add `mdsvex` preprocessing
  - support frontmatter metadata
- Borrow the `svelte-docs-starter` ideas for:
  - content loading
  - navigation generation
  - docs page layout
  - reusable docs rendering patterns
- Preserve room for future enhancements like ToC, search, and richer callout/code-block handling

## Acceptance Criteria

- Visiting `/docs` renders a docs landing page
- Nested content under the repo `docs/` folder is reachable under `/docs/...`
- Markdown files are rendered through `mdsvex`
- Frontmatter metadata is available to the route and used in page rendering where appropriate
- The docs area has a dedicated layout, not just raw markdown dumped into the default app shell
- Navigation reflects the docs file/folder structure in a usable way
- The implementation clearly references `https://github.com/code-gio/svelte-docs-starter` as the design/architecture inspiration
- Existing app routes continue to work without regression

## Suggested Tasks

- [ ] Add `mdsvex` dependencies and SvelteKit config updates
- [ ] Decide how `apps/airport/web` will resolve the repo-level `docs/` folder
- [ ] Create docs content loader utilities
- [ ] Create `/docs` route and nested docs page route(s)
- [ ] Add frontmatter typing and metadata handling
- [ ] Build docs layout and sidebar/navigation
- [ ] Validate rendering against a representative subset of existing docs files
- [ ] Document any content-format assumptions or limitations

## Reference

Primary reference implementation:
- `https://github.com/code-gio/svelte-docs-starter`

Relevant ideas to adapt from the reference:
- markdown-powered docs using `mdsvex`
- docs-specific route structure
- file-structure-based navigation
- frontmatter-driven metadata
- dedicated docs layout and content pipeline
