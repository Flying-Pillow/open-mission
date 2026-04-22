---
title: "VERIFY: #11 - Reconstruct repository adoption and mission dossier layout"
artifact: "verify"
createdAt: "2026-04-10T15:51:25.000Z"
updatedAt: "2026-04-10T17:36:00.000Z"
stage: "implementation"
---

Branch: mission/11-reconstruct-repository-adoption-and-mission-doss

## Unit Test Evidence

- Slice 1, repository adoption layout:
  - `pnpm exec vitest packages/core/src/lib/FilesystemAdapter.test.ts`
  - `FilesystemAdapter` verifies root-level `BRIEF.md` descriptor reads, root-level `mission.json` runtime records, and canonical stage task paths derived from the flat mission root.
- Slice 2, first-mission bootstrap:
  - `pnpm exec vitest packages/core/src/initializeMissionRepository.test.ts`
  - `pnpm exec vitest packages/core/src/daemon/Daemon.test.ts -t "bootstraps repo control inside the mission worktree when scaffolding is missing"`
  - The daemon test confirms an uninitialized checkout can start the first mission, leaves the original checkout without `.mission/settings.json`, and writes repository control into the new mission worktree instead.
- Slice 3, repository modes and routing:
  - `pnpm exec vitest --run packages/core/src/lib/config.test.ts packages/core/src/daemon/WorkspaceManager.test.ts`
  - `config` verifies the machine-local `registeredRepositories` ledger, repository registration, and repository listing behavior.
  - `WorkspaceManager` verifies repository-root discovery, mission-worktree-to-control-root routing, and re-registration when config state is cleaned while the daemon cache remains warm.
  - Tower command handling for `/repo` and `/add-repo` was inspected in `apps/tower/terminal/src/tower/TowerController.tsx` and remains consistent with the repository-adoption command contract.
- Slice 4, consumers, specs, and focused tests:
  - `pnpm exec vitest --run packages/core/src/lib/FilesystemAdapter.test.ts packages/core/src/lib/userConfig.test.ts packages/core/src/daemon/WorkspaceManager.test.ts`
  - Added a focused `FilesystemAdapter` assertion for the canonical flat dossier paths, including `.mission/missions/<mission-id>/`, root-level `mission.json`, and root-level stage folders.
  - Updated repository-adoption-facing docs so the getting-started and Tower overview material now describe the flat mission dossier, root-level `mission.json`, and repository-bound `.mission/` semantics consistently.
- Focused core verification passed for the repository-adoption baseline:
  - `pnpm exec vitest packages/core/src/lib/FilesystemAdapter.test.ts packages/core/src/initializeMissionRepository.test.ts packages/core/src/daemon/WorkspaceManager.test.ts`
- The replayed `mission.json` event log was checked against the current workflow reducer and validation rules after normalizing the event shape to the current engine schema.
- The validated replay runtime now reduces cleanly to a running implementation-stage mission with eleven runtime tasks, which matches the current replay point.

## Gaps

- The mission record intentionally preserves the repeated empty `tasks.generated` events that exposed the implementation-stage recursive-generation omission during replay. That omission remains part of the forward product backlog and should not be silently erased from the retrospective record.
- There is still no dedicated Tower-level automated test for `/repo` and `/add-repo` command interaction. For mission `11`, that remains a residual automation gap rather than a blocker because the daemon/config contract is covered and the command wiring was inspected directly.
- No remaining repository-adoption implementation gaps are currently blocking transition to the audit stage.
