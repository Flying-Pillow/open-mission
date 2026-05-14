---
title: "SPEC: #11 - Reconstruct repository adoption and mission dossier layout"
artifact: "spec"
createdAt: "2026-04-10T15:51:25.000Z"
updatedAt: "2026-04-10T16:38:00.000Z"
stage: "spec"
---

Branch: mission/11-reconstruct-repository-adoption-and-mission-doss

## Mission Intent

- This mission is not only a path cleanup. It is the retrospective reconstruction of the repository-adoption decision that made Mission repository-bound, issue-backed, and capable of storing its own tracked mission history inside the repository it operates on.
- The reconstructed dossier must reflect the full product outcome described by `BRIEF.md` and `PRD.md`: one coherent tracked repository namespace, one coherent first-mission bootstrap flow, and one coherent separation between tracked mission state and machine-local operational state.
- The mission exists because the repository already contains the architecture, but did not yet contain the real intake anchor and corresponding dossier history that would explain how Mission adopted that model.

## Architecture

- The repository-owned Mission namespace is `.mission/`. Tracked repository state belongs there, while machine-local runtime routing and registration stay outside the tracked mission dossier boundary.
- Each tracked mission dossier lives directly at `.mission/missions/<mission-id>/`. That mission root is the canonical filesystem boundary for repository-owned mission state.
- `BRIEF.md` and `mission.json` live at the mission root. Stage artifacts and generated task files live under root-level stage folders such as `01-PRD/` and `02-SPEC/`.
- The mission branch worktree is the bootstrap surface for first-mission adoption. The first mission must be able to create `.mission/settings.json` and its own dossier inside that worktree without requiring the original checkout to be dirtied first.
- Runtime orchestration must not infer lifecycle from directory buckets such as pending, active, or completed. Runtime truth lives in `mission.json` and its reducer-driven workflow projections.
- External worktree paths and repository registration records are operational routing data, not the semantic storage root of tracked mission history.
- Repository switching belongs to repo-level `/repo` and `/add-repo` semantics backed by a minimal machine-local registered repository list, not by per-repository command variants or repository-owned routing state.
- The repository adoption model must support both tracked shared `.mission/` usage and local-only gitignored `.mission/` usage without changing the semantic definition of the mission dossier.
- This is a hard-cut architecture. Do not preserve the old top-level `missions/` layout, the nested `mission-control/` subdirectory, or any fallback path resolution for either shape.

## Signatures

- `FilesystemAdapter` is the canonical authority for mission dossier path resolution, descriptor reads and writes, runtime document reads and writes, stage artifact paths, and generated task paths.
- `MissionDescriptor` identifies the replayed mission and anchors filesystem materialization through `missionId`, `branchRef`, `createdAt`, and the mission brief metadata written into `BRIEF.md`.
- `MissionRuntimeRecord` is stored at root-level `mission.json` and is the authoritative tracked runtime document for lifecycle, stage projections, task projections, gates, launch queue state, and event log history.
- Workflow manifest definitions map stage ids to root-level stage folders through `MISSION_STAGE_FOLDERS` and `stageFolder`. Stage folder naming is part of the canonical repository contract, not UI-only presentation.
- Mission status projections and Tower-facing mission views should expose the mission root and stage folder names directly instead of nested `mission-control` paths or ambiguous directory naming.
- First-mission bootstrap and repository adoption flows must initialize the tracked repository namespace from the mission worktree while keeping machine-local registration and runtime concerns separate from tracked dossier state.

## Design Boundaries

- The dossier layout decision is one part of the mission, but not the whole mission. The broader design target is repository adoption: where tracked Mission state lives, how the first mission bootstraps that state, and how tracked repository history stays distinct from machine-local routing and runtime concerns.
- The issue-backed intake anchor is part of the product behavior being reconstructed. The retrospective mission should explain not only where files live, but why that repository-bound model exists and what operator flow it enables.
- The specification should stay aligned with the PRD outcome and success criteria. If detailed session work narrows onto one design concern, the SPEC must still restate the overall mission boundary so downstream planning does not mistake a local correction for the whole product objective.

## Specification Preservation Boundary

- The primary source specification preserved by this mission is `specifications/mission/model/repository-layout-and-adoption.md`.
- This mission also preserves the repository-adoption plan in `specifications/plans/repository-adoption-and-layout-plan.md` as planning context for the same architectural outcome.
- Secondary preservation is allowed only for architecture slices that are required to express the repository-adoption outcome coherently in the current system.
- The allowed secondary preservation slices are:
	- from `specifications/mission/model/mission-model.md`: the parts that define the mission dossier root, root-level `BRIEF.md`, root-level `mission.json`, root-level stage folders, and the distinction between tracked mission history and machine-local runtime state
	- from `specifications/mission/configuration/repository-workflow-settings.md`: the parts that explain why `.mission/settings.json` may first be created inside the newly prepared mission worktree during first-mission bootstrap
- This mission must not absorb the primary preservation responsibility for workflow-engine semantics, the general core object model, provider-neutral runtime contracts, or airport control-plane authority.
- If those documents are referenced here, they are references only. Their normative preservation belongs to later replay missions according to the retrospective specification coverage map.

## Coverage Verification

- The replayed `SPEC.md` for mission `11` should preserve the repository-adoption architecture completely enough that the source repository no longer depends on scattered pre-workflow notes to explain that decision.
- The mission should preserve only the secondary material needed to state that architecture cleanly in current-system terms.
- Cross-references to later replay missions must remain explicit where a source document spans multiple architecture areas.
- Downstream planning and implementation tasks for this mission must stay inside that preservation boundary.

## File Matrix

- `specifications/mission/model/repository-layout-and-adoption.md`: define `.mission/` as the tracked repository namespace and define the flat mission dossier layout.
- `specifications/mission/model/mission-model.md`: align the semantic model so mission root, `BRIEF.md`, `mission.json`, and stage folders are modeled directly at the dossier root.
- `specifications/mission/configuration/repository-workflow-settings.md`: preserve only the first-mission bootstrap implication that repository workflow settings may first be materialized inside the mission worktree.
- `specifications/plans/repository-adoption-and-layout-plan.md`: record the hard cutover, the no-compatibility rule, and the first-mission bootstrap constraints.
- `specifications/plans/retrospective-replay-workflow.md`: record the replay rule that artifacts must stay aligned with the mission intake anchor and not drift into session-local problem solving that obscures the original mission objective.
- `packages/core/src/lib/FilesystemAdapter.ts`: remove nested dossier path semantics and make artifact, task, and runtime reads and writes resolve from the flat mission root.
- `packages/core/src/lib/workspacePaths.ts`: remove `missionControlDir` from workspace path derivation and keep the mission root as the tracked dossier anchor.
- `packages/core/src/types.ts`: align mission records, operator status, and stage status naming with the flat dossier model and root-level stage folders.
- `packages/core/src/daemon/MissionPreparationService.ts` and `packages/core/src/daemon/Workspace.ts`: project mission preparation and workspace status from the flat mission root instead of a nested control directory.
- `packages/core/src/daemon/mission/Artifact.ts` and `packages/core/src/daemon/mission/Mission.ts`: make task and product artifact paths, runtime projections, and operator guidance consistent with the root-level dossier layout.
- `packages/core/src/daemon/system/types.ts` and `packages/core/src/workflow/manifest.ts`: remove obsolete nested-path terms and make stage-folder terminology canonical.
- `apps/tower/terminal/src/tower/TowerController.tsx` and `apps/tower/terminal/src/scripts/daemonCurrentWorkflowE2eTest.ts`: update Tower consumers to read root-level mission status and stage folder names.
- `packages/core/src/lib/*.test.ts`, `packages/core/src/daemon/*.test.ts`, and `packages/core/src/daemon/mission/Mission.test.ts`: update tests to assert flat dossier paths, root-level `mission.json`, and root-level stage folders without legacy compatibility branches.
