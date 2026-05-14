---
issueId: 11
title: "Reconstruct repository adoption and mission dossier layout"
type: "task"
branchRef: "mission/11-reconstruct-repository-adoption-and-mission-doss"
createdAt: "2026-04-10T15:51:25.000Z"
url: "https://github.com/Flying-Pillow/mission/issues/11"
---

Issue: #11

## Goal

Reconstruct the major historical mission that established Mission's repository-bound control layout and mission dossier model.

This is a retrospective reconstruction issue. The architecture and specifications already exist in the repository today. The purpose of this issue is to create the real GitHub intake anchor that a Mission start flow would have used, so Mission can dogfood its own issue-backed intake model while rebuilding its development history.

## Scope

This mission covers the repository adoption and tracked mission layout model, including:

- moving tracked mission state under `.mission/`
- standardizing the tracked mission dossier path as `.mission/missions/<mission-id>/`
- separating tracked mission history from machine-local runtime state
- allowing first-mission bootstrap inside the newly created mission worktree
- keeping the original checkout untouched until the user explicitly updates it
- supporting both shared Mission mode and local contributor mode
- adding the minimal registered-repository list needed for repo-level switching
- defining the repo-level `/repo` and `/add-repo` control semantics

## Expected Outcome

Mission should have one coherent repository adoption model with:

1. one canonical tracked Mission namespace under `.mission/`
2. one canonical tracked mission dossier path under `.mission/missions/<mission-id>/`
3. one first-mission flow that can bootstrap repository control from the mission branch worktree
4. no requirement for a standalone bootstrap PR before the first mission can begin
5. clear boundaries between tracked repository state, external mission worktrees, and machine-local runtime state

## Acceptance Criteria

- The canonical tracked mission dossier path is `.mission/missions/<mission-id>/`.
- Repository settings live at `.mission/settings.json`.
- Mission lifecycle is not inferred from folder placement.
- First-mission bootstrap can initialize `.mission/settings.json` inside the new mission worktree.
- The first mission branch can contain both repository bootstrap content and the first mission dossier.
- Mission supports repositories that track `.mission/` and repositories that gitignore it for local-only use.
- Mission stores only a minimal machine-local registered repository list for repo switching.
- Repository switching semantics are expressed through `/repo` and `/add-repo`, not per-repo command variants.

## Constraints

- Do not move repository control into user-scoped config.
- Do not preserve the old top-level `missions/` repository layout as a compatibility path.
- Do not preserve the nested `mission-control/` dossier layout as a compatibility path.
- Do not derive mission state from `pending`, `active`, or `completed` directory buckets.
- Do not require the original local checkout to be dirtied before the first mission can begin.
- Do not treat local worktree materialization paths as the semantic storage root of tracked mission history.

## Source Material

This reconstructed mission is derived from:

- `specifications/mission/model/repository-layout-and-adoption.md`
- `specifications/plans/repository-adoption-and-layout-plan.md`

## Notes

This issue is intended to become the intake anchor for a manually scaffolded retrospective mission dossier, created without invoking the workflow engine. That manual scaffold will be used to validate the Mission start flow in a controlled, non-destructive way before larger retrospective reconstruction work proceeds.