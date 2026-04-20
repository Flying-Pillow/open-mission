---
title: "VERIFY: #25 - Generate a documentation route in the airport/web application"
artifact: "verify"
createdAt: "2026-04-20T19:25:26.900Z"
updatedAt: "2026-04-20T21:13:30.000Z"
stage: "implementation"
---

Branch: mission/25-generate-a-documentation-route-in-the-airport-we

## Unit Test Evidence

- Slice 1, mdsvex docs pipeline and source normalization:
  - `pnpm --filter @flying-pillow/mission-airport-web test -- src/lib/docs/source-normalization.test.ts`
  - The focused docs suite passes with 9 tests covering frontmatter preservation through mdsvex metadata, internal-link rewriting onto `/docs/...`, inline HTML preservation apart from `href` rewriting, docs-root-only preprocessing, and the explicit non-support boundary for unrelated Liquid/Jekyll constructs such as `{{ page.title }}` and `{% include ... %}`.
  - The same suite now imports the entire repository-root docs corpus through `import.meta.glob("$docs/**/*.md")`; all 35 `docs/**/*.md` files compiled through the mdsvex path and exposed component defaults plus parsed frontmatter metadata, including section metadata such as `has_children` and `nav_order`.
  - A repository docs corpus search found legacy usage limited to `{{ '...' | relative_url }}` plus Jekyll-style frontmatter fields like `layout`, `nav_title`, `nav_order`, and `has_children`; no `{% ... %}` tags, `site.*`, `page.*`, `include`, `permalink`, or `redirect_from` conventions are present in the current source corpus, so the compatibility layer remains narrowly scoped to the intended legacy patterns.

- Slice 2, docs manifest navigation and page resolution:
  - `pnpm --filter @flying-pillow/mission-airport-web test -- src/lib/docs/manifest.test.ts`
  - The focused manifest verification passes. The command currently executes both docs suites, yielding 13 passing tests total with the 4 manifest assertions covering this slice directly.
  - The manifest suite verifies stable page records and sidebar structure against the real `docs/` corpus: it asserts the root page resolves from `docs/index.md`, confirms the top-level navigation labels and order (`Overview`, `Getting Started`, `Core Workflows`, `User Manual`, `Architecture`, `Reference`), and checks the full ordered child list under `/docs/architecture`.
  - Route resolution is exercised through the same shared manifest for `/docs`, `/docs/getting-started`, and `/docs/getting-started/installation`, including the derived `section` label for nested pages.
  - Failure coverage remains explicit: resolving an unknown slug throws `No docs page source exists for slug "missing-page".`, a nested page without `getting-started/index.md` throws the required missing section source error, and a stale `parent` label throws the expected mismatch error.
  - Consistency between the route map and derived navigation tree is validated by asserting that the flattened navigation `href` set exactly matches the manifest page `href` set, so every derived route is represented once in navigation and vice versa.

- Slice 3, docs route layout and mdsvex page rendering:
  - `pnpm --filter @flying-pillow/mission-airport-web test -- src/lib/docs/source-normalization.test.ts src/lib/docs/manifest.test.ts`
  - The focused docs suites pass together with 14 assertions total, confirming the route's backing manifest and mdsvex source pipeline still resolve the docs index and nested pages from the repository-root `docs/` corpus.
  - Static review of `src/routes/docs/+layout.server.ts`, `src/routes/docs/+layout.svelte`, `src/routes/docs/[...slug]/+page.server.ts`, `src/routes/docs/[...slug]/+page.svelte`, and `src/lib/components/docs/docs-content.svelte` confirms the intended composition: the docs layout loads manifest-derived site metadata and sidebar navigation, the page load resolves a serialized docs record, the page head derives a route-specific `<title>` plus optional description meta, and the markdown component is meant to render inside `<DocsContent>` rather than the legacy `src/lib/components/viewers/markdown.svelte` path.
  - Live SSR validation against a local `pnpm exec vite dev --host 127.0.0.1 --port 4173` session did **not** complete successfully for either `/docs` or `/docs/getting-started/installation`: both requests returned HTTP 500 with `No eager docs module exists for source "index.md".` / `No eager docs module exists for source "getting-started/installation.md".` from `src/routes/docs/[...slug]/+page.svelte`.
  - Because the runtime route currently fails before the markdown component mounts, this slice could not confirm the expected dedicated docs layout behavior in a running app: sidebar active-state rendering, page metadata emitted into the final document, long-form styling hooks for existing HTML blocks such as `mission-home-hero` / `mission-section-grid`, and the absence of fallback rendering through the legacy markdown viewer remain blocked by the same route failure.

- Slice 4, docs discoverability and daemon-independent access:
  - `pnpm --filter @flying-pillow/mission-airport-web test -- src/hooks.server.test.ts src/lib/server/daemon/route-access.test.ts src/lib/components/airport/airport-sidebar-navigation.test.ts src/lib/docs/route-paths.test.ts`
  - The targeted discoverability/daemon-access assertions pass through the same predicates now shared by `src/hooks.server.ts` and `src/routes/+layout.svelte`; the runner also continues to execute the existing docs manifest/source suites, yielding 27 passing assertions total in the current package test run.
  - `src/lib/components/airport/airport-sidebar-navigation.test.ts` verifies the shared Airport sidebar always exposes a `Documentation` entry at `/docs`, preserving discoverability even on non-doc pages, and marks that entry active only for `/docs` and descendant docs routes.
  - `src/lib/server/daemon/route-access.test.ts` verifies the daemonless exception stays narrow: docs routes continue rendering through the shell when `daemonRunning` is false, non-doc routes such as `/repository/example` remain gated, and lookalike paths such as `/docs-guides` do **not** inherit the bypass.
  - `src/hooks.server.test.ts` exercises the actual `handle` hook with the daemon mocked unavailable. It confirms `/docs/getting-started` resolves through the request pipeline, `/repository/example` throws the expected `303` redirect back to `/`, and `/api/runtime/events` plus `/auth/github/callback` keep their existing exemptions outside the docs-specific bypass.
  - Live SSR probing with `MISSION_SURFACE_PATH=/Users/ronb/missions/mission/25-generate-a-documentation-route-in-the-airport-we/.tmp-missing-surface pnpm exec vp dev --host 127.0.0.1 --port 4175 --strictPort`, followed by `curl` requests to `/docs` and `/repository/example`, did not produce a clean end-to-end confirmation. `/docs` still failed with `No eager docs module exists for source "index.md".`, while `/repository/example` failed later during SSR compilation in `src/lib/components/entities/Issue/IssueList.svelte` before a live daemon-gated redirect could be observed.

## Gaps

- The core goal of this verification task is currently **not met end-to-end**: the live `/docs` route and nested docs routes return HTTP 500 during SSR because `src/routes/docs/[...slug]/+page.svelte` cannot find the eager mdsvex module for the resolved `sourcePath`. Until that lookup is fixed, the docs route cannot be verified as rendering inside the dedicated docs layout at runtime.
- End-to-end daemon-unavailable verification for a non-doc page is still partially blocked in a live browser/server session: the focused hook and route-access tests prove the redirect policy, but the attempted live `/repository/example` request hit the pre-existing `IssueList.svelte` async compile failure before a running-session redirect could be observed alongside the broken `/docs` SSR path.
- `pnpm --filter @flying-pillow/mission-airport-web check` still fails before a clean app-wide verification pass, but the remaining diagnostics are outside the docs manifest slice: missing `App.Locals`/`App.AppContext` typings, missing `sanitize-html` types, and the pre-existing async-derived issue in `src/lib/components/entities/Issue/IssueList.svelte`.
- `pnpm --filter @flying-pillow/mission-airport-web build` still fails in `src/lib/components/entities/Issue/IssueList.svelte` because that component uses top-level `await` inside `$derived` without enabling Svelte's async compiler option. This currently blocks a full production build confirmation for the web app, but it is outside the docs normalization slice itself.
