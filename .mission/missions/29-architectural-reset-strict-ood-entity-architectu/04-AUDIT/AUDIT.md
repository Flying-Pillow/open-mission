---
title: "AUDIT: #29 - Architectural Reset: Strict OOD Entity Architecture For Airport And Daemon"
artifact: "audit"
createdAt: "2026-04-26T11:37:00.000Z"
updatedAt: "2026-04-26T11:44:00.000Z"
stage: "audit"
---

Branch: mission/29-architectural-reset-strict-ood-entity-architectu

## Findings

- Mission 29 implementation is audit-ready for the Repository-first architectural reset.
- `pnpm run check:packages` passed: core and mission package checks completed successfully.
- `pnpm run build:packages` passed: core and mission package builds completed successfully.
- `pnpm run build:web` initially exposed a real export-boundary regression: Airport web runtime routes still imported route/input schemas from the root `@flying-pillow/mission-core` entrypoint after the root schema barrel was removed. The audit fixed this by moving those route/input schemas into the canonical `@flying-pillow/mission-core/schemas` surface and updating the remaining web imports. The re-run passed.
- Focused web verification passed: `pnpm --dir apps/airport/web test src/routes/api/entities/remote/dispatch.test.ts src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts` completed 3 files / 7 tests.
- `pnpm run test:packages` passed. Both package test targets currently have no test files and exit successfully with `--passWithNoTests`.
- Static package export inspection passed. `packages/core/package.json` exports exactly `.`, `./schemas`, `./browser`, `./node`, and `./daemon`.
- Static transitional-boundary scan passed with no active forbidden references to `@flying-pillow/mission-core/airport`, `@flying-pillow/mission-core/airport/runtime`, deep entity remote package paths, `MissionRemoteContract`, obsolete Repository mutation/status schemas, `normalizeEntityRemoteResult`, or `ENTITY_MODELS` in the checked target paths.
- `mission.json` and `mission.events.jsonl` parsed successfully before final audit runtime updates.

## Risks

- `pnpm run test:web` remains non-green because `src/hooks.server.test.ts` mocks `$lib/server/github-auth.server` without the now-required `readGithubSessionContext` export. This is outside the Mission 29 Repository/export-boundary work, but should be fixed as a small follow-up.
- Full `pnpm run check:web` remains a known baseline risk. The latest known full Svelte check summary before the audit fix was 117 errors and 2 warnings in 26 files, concentrated around route Mission component typings and unrelated component prop contracts. The mission-specific build/export regression was fixed and `build:web` now passes.
- The broader Mission command acknowledgement-plus-SSE migration remains future work. Mission 29 completed the Repository-first source acknowledgement and projection boundary; remaining Mission/Task/Session command response shapes are intentionally outside this slice.
- Documentation markdown compilation still emits Svelte `context="module"` deprecation warnings during web build. They do not block the build but should be tracked separately.

## PR Checklist

- [x] Canonical Repository, entity remote, runtime event, and Airport client schemas are available through `@flying-pillow/mission-core/schemas`.
- [x] Core package public export map is minimal and stable.
- [x] Airport web no longer depends on `airport/runtime` for shared schema contracts.
- [x] Route-local Repository issue/mission remotes are removed.
- [x] Generic entity query/command remotes and focused transport tests pass.
- [x] Package checks, package builds, focused web tests, and web production build pass.
- [x] Known non-blocking baseline failures are separated from Mission 29 regressions.
- [x] Audit gate can pass; delivery closeout can proceed next.
