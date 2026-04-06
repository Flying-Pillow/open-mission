# Branch Handoff

This file is the authoritative handoff for finalizing and merging the branch `mission/4-audit-issue-1-architecture-refactor-on-merged-ma`.

It exists because the current mission `flight-deck/` has been used during testing and should not be trusted as the canonical source of mission state.

## What Must Be Preserved

Preserve the branch code and the architectural decisions validated on this branch.

Do not try to preserve the current local mission runtime state or treat the current `flight-deck/` contents as authoritative.

## Validated State On This Branch

- Repository bootstrap is authorization-first and PR-backed.
- Mission preparation is authorization-first and PR-backed.
- Brief intake creates the GitHub issue first, then opens the mission-preparation PR.
- Issue intake also routes through authorization-by-PR.
- Draft missions read repository workflow settings until workflow start, where the mission-local snapshot is captured.
- Low-level workflow settings reads and writes now respect the explicit control root instead of silently resolving back to the parent workspace root.
- The core test suite passed on this branch with `pnpm exec vitest run --config vitest.config.ts --project core`.

## What Must Not Be Preserved

- Do not preserve the current mission worktree as if it were a reusable runtime checkpoint.
- Do not preserve the current `flight-deck/` as if it were authoritative mission history.
- Do not use the current mission worktree to validate the clean `main` bootstrap path.

## Required Sequence

1. Commit the current branch state.
2. Push the branch.
3. Merge the branch into `main`.
4. Update the plain checkout at `/home/ronald/mission` to merged `main`.
5. Clean the plain checkout before validation. It currently shows a deleted tracked legacy file: `.mission/settings.json`.
6. Remove the active mission worktree only after merged `main` is present locally.
7. Validate bootstrap and authorization flows from the plain `main` checkout.

## Post-Merge Rule

After merge, start fresh from plain `main`.

The trusted continuity artifact is this file plus the merged code, not the current mission-local runtime or `flight-deck/` contents.