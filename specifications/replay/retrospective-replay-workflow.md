---
layout: default
title: Retrospective Replay Workflow
parent: Plans
nav_order: 4
---

# Retrospective Replay Workflow

This document defines how Mission should reconstruct its own historical development as a curated sequence of retrospective missions.

The purpose is not to replay old implementation mechanically.

The purpose is to rebuild the historical mission trail in a way that is:

- issue-backed
- repository-tracked
- workflow-consistent
- reproducible from repo state alone
- compatible with Mission's current architecture direction

This document is the durable process reference for retrospective replay work.

If short-term memory, session context, or operator notes are lost, this document should still be enough to resume the replay process correctly.

## Replay Stance

Retrospective replay outputs are not treated as recovered historical truth.

They are the current best replay product produced from present-day specifications, code, issue history, and operator judgment under this workflow.

That means replay work should be handled as an iterative reconstruction process:

- observe what the replay produced
- compare that result against the intake anchor, current product semantics, and the curated replay decomposition
- correct the replay when it drifted, overreached, or encoded the wrong boundary
- record the correction and the lesson in the retrospective experience record

Replay is therefore both reconstruction work and workflow-learning work.

The replayed artifacts should be internally coherent and workflow-valid for the chosen replay point, but they may still expose mistakes in the replay process itself. When that happens, the replay result should be corrected and the lesson should be recorded explicitly.

## Core Law

Retrospective replay must follow current Mission workflow semantics as closely as possible.

That means:

1. Replayed missions must be anchored to a real GitHub issue whenever the real Mission intake flow would have required one.
2. Replayed mission dossiers must use the canonical tracked dossier path `.mission/missions/<mission-id>/`.
3. Replayed artifacts must use the same filesystem shape the workflow engine writes today.
4. Replayed product artifacts must be materialized in the same shape the engine would write: rendered template body plus artifact-writer frontmatter.
5. Replayed generated task files must match `writeTaskRecord(...)` output rather than raw template file contents.
6. Replayed `mission.json` state must reflect the workflow events and runtime projections implied by the replayed stage, not an approximate or contradictory hand-written state.
7. Artifact enrichment must happen after initial materialization. First create the engine-shaped artifact, then update that artifact as the outcome of the replayed task.
8. No compatibility shim, alias, fallback reader, or dual-path support should be introduced for obsolete dossier layouts while doing replay work.

## Replay Scope

The current retrospective decomposition is intentionally small and coarse-grained.

The identified missions, in canonical replay order, are:

1. Repository Adoption And Mission Dossier Layout.
2. Mission Semantic Model.
3. Workflow Engine And Repository Workflow Settings.
4. Agent Runtime Unification.
5. Airport Control Plane.

These missions are not a claim about the exact chronological commit history.

They are the current best curated reconstruction of the major isolated architectural outcomes that led to the repository state now present in Mission.

If later evidence shows a cleaner grouping, this list may be revised. The mission count should stay small unless a split materially improves clarity.

These five missions were not chosen arbitrarily.

They were derived from the specification material currently scattered across:

- `specifications/airport/`
- `specifications/mission/`
- `specifications/checklists/`

The replay objective is not only to reconstruct workflow history.

It is also to preserve that pre-workflow specification corpus by relocating its substantive intent into the correct replayed mission contexts, especially the `SPEC.md` artifacts of the five replayed missions.

In other words, the replay should convert a scattered specification corpus into a mission-shaped specification trail without losing scope, meaning, or architectural intent.

## Specification Preservation Goal

One of the primary purposes of retrospective replay is to preserve existing specifications that were created outside the normal Mission workflow but are still considered valid and internally consistent.

The target outcome is that the substantive requirements, constraints, models, and behavioral contracts currently documented under the retrospective source specification folders are represented in the correct replayed mission artifacts.

For this replay set, the strongest preservation target is the `SPEC.md` artifact of each replayed mission.

This does not require mechanically copying source documents verbatim into mission artifacts.

It does require that their normative content be carried forward into the correct mission context so that, after replay, the repository no longer depends on the scattered source layout as the only authoritative expression of that design intent.

Preservation therefore means:

- each substantive source specification is mapped to one replay mission or explicitly treated as shared reference material
- the relevant design intent is represented in that mission's replayed `SPEC.md`
- the representation preserves the original scope and meaning rather than flattening unrelated topics together
- any source document that remains outside a replayed mission context is an explicit exception, not an accidental omission

One source specification may legitimately contribute to more than one replay mission.

When that happens, the coverage map must still remain unambiguous:

- assign exactly one primary preservation mission for the source document as a whole
- record any additional missions as secondary preservation contexts or shared references
- explain the split in terms of current architecture ownership, not authoring convenience
- avoid duplicating whole documents across mission `SPEC.md` files when a narrower architecture-aligned extraction is sufficient

The governing question is not "where could this text fit" but "which replay mission owns this concept in the current system architecture."

## Replay Inputs

Each replayed mission should be derived from current repository sources, not guesswork.

Allowed inputs include:

- specification documents
- implementation plans
- checklists
- current code that confirms the intended runtime contract
- current docs that confirm the intended operator flow
- real GitHub issue state created for the replay

The replay should not invent artifacts that are unsupported by the current code or current specifications.

The replay should also not leave source specifications effectively orphaned by failing to carry them into the replayed mission set.

## Replay Sequence

### 1. Select The Mission

Choose one mission from the curated retrospective mission list.

Before creating any dossier files:

- identify which source specification documents this mission is responsible for preserving
- identify the authoritative source specifications
- identify the intended issue title
- identify the intended outcome and constraints
- confirm whether current code exposes additional constraints that the specs do not yet state explicitly

At this step, create or update a coverage view for the five-mission replay set.

That coverage view should answer:

- which source specification documents are in scope for preservation
- which replay mission owns each document's primary preservation context
- which items are shared references rather than single-mission-owned documents
- which items require secondary preservation coverage in other missions
- which source documents, if any, are intentionally deferred or excluded

The coverage view must follow current architecture boundaries.

For example:

- repository layout and adoption concerns belong primarily to the repository-adoption replay mission
- semantic model and object-model concerns belong primarily to the mission-semantic-model replay mission
- workflow runtime semantics and repository workflow settings belong primarily to the workflow-engine replay mission
- provider-neutral session execution belongs primarily to the agent-runtime replay mission
- daemon-wide control-plane, projection, and substrate ownership belongs primarily to the airport-control-plane replay mission

If a source specification spans more than one of those architectural ownership boundaries, record the primary owner and the secondary mission consumers explicitly.

### 2. Create The GitHub Issue First

If the real Mission intake flow would create an issue first, the replay must do the same.

This is the current rule for brief-based GitHub-backed mission start.

The issue is not optional metadata. It is the intake anchor.

The issue should contain:

- mission goal
- mission scope
- expected outcome
- acceptance criteria
- constraints
- source material references
- a note that the mission is a retrospective reconstruction

### 3. Derive Canonical Mission Identity

After the issue exists, derive:

- `missionId`
- `branchRef`
- mission dossier path

These should follow the same naming logic the codebase uses for issue-backed mission creation.

Do not invent alternate naming schemes just for replay.

### 4. Materialize The Minimal Mission Root

Create the mission dossier root at:

```text
.mission/missions/<mission-id>/
```

The minimal initial dossier must contain:

- `BRIEF.md`
- `mission.json`

`BRIEF.md` should match the canonical descriptor artifact shape.

`mission.json` should match the current workflow runtime schema and should reflect the replay point truthfully.

### 5. Replay Workflow Progression Stage By Stage

When a stage is replayed, do not skip directly to a hand-authored final artifact.

Replay it in the same conceptual order as the workflow engine:

1. create or confirm the correct runtime state and event sequence for reaching the stage
2. materialize stage product artifacts in engine-shaped form
3. materialize generated task files in engine-shaped form
4. enrich the product artifact as the task outcome
5. only then advance the runtime state toward task completion or next-stage eligibility

For example, PRD replay should follow this pattern:

1. replay `mission.created`
2. replay `mission.started`
3. replay `tasks.generated` for `prd`
4. materialize `01-PRD/PRD.md` with the product template plus artifact-writer frontmatter
5. materialize `01-PRD/tasks/01-prd-from-brief.md` with the task-writer output shape
6. enrich `PRD.md` as the outcome of the PRD task
7. only then replay the task completion transition if that is the chosen replay point

### 6. Use Current Engine Semantics As The Reference Model

Retrospective replay should prefer the current workflow engine code as the reference for materialization semantics when the question is:

- what frontmatter is written
- how a task file is normalized on disk
- what event sequence is required for a runtime state
- what stage projection should exist after a given event
- what task lifecycle should appear in `mission.json`

This does not mean the replay must execute the engine directly.

It means the replayed repository state should be indistinguishable from what the engine would have produced for that replay point.

### 7. Preserve Clean-Break Architecture Decisions

Replay work must not reintroduce obsolete architecture.

Specifically:

- do not recreate the old top-level `missions/` repository layout
- do not recreate the nested `mission-control/` dossier layout
- do not add compatibility paths for either obsolete shape
- do not preserve obsolete field names when the current architecture already made a clean rename

Replay is not a justification for re-encoding dead architecture.

### 8. Validate After Each Replay Step

After each major replay step, validate with the current codebase whenever practical.

Preferred validation methods include:

- reading artifacts through `FilesystemAdapter`
- reading task state through `FilesystemAdapter.readTaskState(...)`
- reading runtime state through `FilesystemAdapter.readMissionRuntimeRecord(...)`
- building the affected packages
- running focused tests when a replay step required code changes

### 9. Record Replay State Back To The Issue

The replay issue should be updated as meaningful milestones occur.

At minimum, record:

- spec clarification decisions that affected the replay contract
- specification-coverage decisions for documents preserved by this mission
- mission dossier scaffold completion
- stage materialization milestones
- important replay-law clarifications that future replays must follow

### 10. Handle Product Omissions Explicitly

If retrospective replay uncovers a real product omission, record that omission as a real GitHub issue.

Examples include:

- a missing deterministic workflow contract
- a missing engine materialization path
- a mismatch between documented workflow behavior and implemented runtime behavior
- a missing schema or event path required to continue replay faithfully

The omission issue should be created even if the replay cannot yet be executed through Mission's own workflow machinery.

This is a chicken-and-egg case and should be treated explicitly, not hidden.

These omission issues are part of the real forward product backlog.

They are not themselves implementation tasks of the replayed historical mission unless the curated replay mission being executed is explicitly about that omission.

### 11. Continue In Emulation Mode When Justified

Once the omission is recorded as a real GitHub issue, retrospective replay may continue in emulation mode if both of the following are true:

1. the missing behavior is now explicitly documented as an omission
2. the current brief, PRD, and SPEC are specific enough to derive the next artifact or task inventory without guesswork

In emulation mode:

- prefer the current workflow schema and event shapes even if some transitions must be replayed manually
- scaffold the next artifacts and task files in the canonical engine-written shapes
- keep `mission.json` coherent with the emulated replay point
- do not pretend the omission does not exist
- do not convert the omission issue into replay-owned implementation scope just because the replay exposed it
- do not add omission-remediation work to the current replay mission ledger when that work belongs to a later real mission

If the current stage artifacts are not specific enough to derive the next inventory honestly, stop and record that as the reason.

Emulation mode exists to let the replay continue as a bounded reconstruction exercise.

It does not authorize replay to silently implement the missing product behavior, redefine the mission boundary, or pull future backlog work into the current replay mission.

## Current Replay Baseline

The current replay baseline established during mission `11-reconstruct-repository-adoption-and-mission-doss` is:

1. Mission dossiers live directly under `.mission/missions/<mission-id>/`.
2. `BRIEF.md` is a root artifact.
3. `mission.json` is a root runtime document.
4. Stage artifacts live under root-level stage folders such as `01-PRD/` and `02-SPEC/`.
5. Product artifacts should use the same generated frontmatter shape the workflow engine writes.
6. Task artifacts should use the same normalized document shape that `writeTaskRecord(...)` writes.
7. Replay should move in engine-consistent increments rather than jumping to a hand-authored finished state.

## Operator Guidance

When performing retrospective replay manually:

- prefer deriving shapes from current code over improvising file structures
- prefer exact event-aligned runtime state over approximate runtime summaries
- prefer smaller, valid replay increments over large speculative jumps
- prefer clean architectural cutovers over compatibility-preserving replay patches
- when an omission is discovered, open the issue first, then decide whether the replay can continue in explicit emulation mode without guessing
- treat replay outputs as corrigible working results, not as automatically trustworthy historical truth
- when replay corrections are made, record both the correction and the process lesson that made it necessary
- maintain an explicit source-specification coverage map across the five replay missions
- verify not only that a mission artifact exists, but that the relevant source specifications are represented in the correct mission context

## Specification Coverage Verification

The five-mission replay should be considered incomplete until the retrospective source specification corpus has an explicit coverage accounting.

At minimum, verification should confirm all of the following:

1. each substantive source document under `specifications/airport/`, `specifications/mission/`, and `specifications/checklists/` has been reviewed for replay placement
2. each reviewed source document is assigned to one of these outcomes: preserved by mission `SPEC.md`, used as shared reference material, or explicitly deferred
3. each replay mission `SPEC.md` identifies the source material it is preserving
4. the five replay missions collectively cover the intended specification corpus without silent gaps or duplicated ownership
5. if a source document spans multiple missions, the split is stated explicitly rather than being left implicit
6. each multi-mission split is justified in terms of current architecture ownership and not just topical similarity
7. navigational index documents are either marked non-substantive or explicitly preserved only for the normative content they actually add

For this verification, "represented" means that the mission `SPEC.md` preserves the source document's substantive design intent in the correct context. It does not require textual duplication, but it does require traceable preservation of meaning and scope.

The preferred recording format is a repository-stored coverage map that lists each source document, its architecture owner, its primary replay mission, any secondary replay missions, and any exceptions or notes about how the content is preserved.

That coverage map is part of the replay process record and should be updated as replay clarifies boundaries.

## Current Coverage Map Reference

The current architecture-aligned source-specification coverage map for this replay set lives in:

- `specifications/plans/retrospective-specification-coverage-map.md`

That document should be kept consistent with this workflow and with the actual replayed mission artifacts.

## Non-Goals

This workflow does not attempt to:

- recreate exact historical commit order
- preserve obsolete runtime formats for documentary purposes
- replay every small implementation task as its own mission
- let replay convenience override current Mission architecture
- materialize omission-remediation work as replay-owned tasks when those omissions are already tracked as real forward-looking issues
