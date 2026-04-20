---
title: "AUDIT: #25 - Generate a documentation route in the airport/web application"
artifact: "audit"
createdAt: "2026-04-20T19:25:26.900Z"
updatedAt: "2026-04-20T23:29:30.000+02:00"
stage: "audit"
---

Branch: mission/25-generate-a-documentation-route-in-the-airport-we

## Findings

- Repo-wide validation still does not reach a clean green state on the mission branch. A fresh `pnpm run ci:verify` run fails immediately in lint because the shared ESLint config still imports `apps/airport/web/svelte.config.js`, while this branch ships `apps/airport/web/svelte.config.ts`.
- A fresh `pnpm run check` run fails at the repo level in `@flying-pillow/mission-airport-native`: `cargo check` panics in `tauri::generate_context!()` because `/tmp/mission-airport-icon.png` is missing in this environment. That leaves the repo-wide type-check path non-green before release.
- A focused `pnpm run check:web` run still fails in `@flying-pillow/mission-airport-web` with 7 diagnostics across 4 files: `src/hooks.server.test.ts` builds incomplete `RequestEvent` fixtures, `src/lib/docs/source-normalization.test.ts` cannot resolve `$docs/index.md` for type-checking, `src/lib/components/viewers/markdown.svelte` lacks `sanitize-html` declarations, and `src/lib/components/entities/Issue/IssueList.svelte` still uses async `$derived` without enabling Svelte's async compiler option.
- A fresh `pnpm run build` run still fails in `@flying-pillow/mission-airport-web` before a production artifact can be confirmed because `src/lib/components/entities/Issue/IssueList.svelte` uses top-level `await` inside `$derived`, which Svelte rejects without `experimental.async`.
- A fresh `pnpm run test:all` run passes. The repo-wide test run completes successfully, including the web package's 27 assertions across docs source normalization, docs manifest generation, docs route-path handling, daemon route access, sidebar navigation, and hook-level docs-route bypass coverage.
- The required simulator-style live SSR probe still fails end to end. Port `4174` was already occupied in the shared environment, so the equivalent command was rerun on `4194`: `pnpm --filter @flying-pillow/mission-airport-web exec vp dev --host 127.0.0.1 --port 4194 --strictPort`, followed by `curl` probes to `/docs` and `/docs/getting-started/installation`. Both routes returned HTTP 500, and the server logged `No eager docs module exists for source "index.md".` / `No eager docs module exists for source "getting-started/installation.md".` from `src/routes/docs/[...slug]/+page.svelte`.
- Because the runtime docs pages still 500 during SSR, the mission acceptance criteria for a browsable `/docs` surface and nested docs routes are not met end to end, even though the supporting unit coverage around manifest generation and route gating is present.

## Risks

- The primary product risk remains release-blocking: users cannot load `/docs` or nested docs pages in a running Airport web session because the mdsvex component lookup fails at render time.
- Repo-wide delivery confidence remains below release threshold because the required validation path is not green: lint fails on the stale Svelte config import, `check` fails in the native package due to the missing icon asset path in this environment, `check:web` still reports 7 web diagnostics, and build fails in the web package on `IssueList.svelte`.
- The passing automated tests demonstrate that the docs corpus normalization, manifest derivation, and daemonless route-bypass predicates are wired in isolation, but they do not offset the current SSR/runtime failure on the actual docs pages.

## PR Checklist

- Mission `25` is **not** release-ready.
- Repo-wide validation was executed: `pnpm run ci:verify` failed in lint, `pnpm run check` failed in the native package, `pnpm run check:web` failed with 7 web diagnostics, `pnpm run build` failed in the web package, and `pnpm run test:all` passed.
- The simulator-style live SSR probe was executed and failed reproducibly for `/docs` and `/docs/getting-started/installation` with the unresolved eager docs module lookup error.
- The branch should not be merged or released until the docs route renders successfully and the repo-wide validation path is restored to green.
