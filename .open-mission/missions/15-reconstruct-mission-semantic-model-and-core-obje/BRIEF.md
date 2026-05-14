---
issueId: 15
title: "Reconstruct mission semantic model and core object model"
type: "task"
branchRef: "mission/15-reconstruct-mission-semantic-model-and-core-obje"
createdAt: "2026-04-10T19:45:21.638Z"
updatedAt: "2026-04-10T19:45:21.638Z"
url: "https://github.com/Flying-Pillow/mission/issues/15"
---

Issue: #15

## Goal

Reconstruct the major historical mission that established Mission's semantic repository model and the canonical core object model naming and ownership boundaries.

This is a retrospective reconstruction issue. The architecture and specifications already exist in the repository today. The purpose of this issue is to create the real GitHub intake anchor that a Mission start flow would have used, so Mission can dogfood its own issue-backed intake model while rebuilding its development history.

## Scope

This mission covers the semantic-model and object-model outcome, including:

- defining the first-class semantic contexts owned by the core model: repository, mission, task, artifact, and agent session
- defining the semantic mission repository model and repository-resident records such as MissionBrief, MissionDescriptor, MissionRecord, MissionTaskState, MissionStageStatus, and MissionStatus
- preserving the semantic storage-scope distinctions between repo-scoped settings, branch-scoped tracked mission dossiers, and machine-local daemon runtime state where those distinctions are part of the semantic model
- defining artifact ownership, task ownership, task-owned agent-session semantics, and the minimal frontmatter model for BRIEF.md and task definition metadata
- preserving the canonical core object-model naming system and ownership boundaries for mission terms, workflow-runtime terms, and agent-execution terms owned by packages/core
- aligning the semantic model with the current rule that mission.json is the authoritative mission-local workflow runtime document without collapsing workflow-engine authority into this mission

## Expected Outcome

Mission should have one coherent semantic model with:

1. clear first-class semantic contexts and ownership boundaries in packages/core
2. one canonical naming system for mission, task, artifact, workflow-runtime, and agent-session concepts
3. explicit separation between semantic mission-local records and daemon-wide airport control-plane authority
4. explicit separation between immutable task-definition metadata in markdown and mutable workflow runtime truth in mission.json
5. a replayed specification trail that preserves the substantive content of the mission-model and core-object-model source specifications without losing or flattening their normative meaning

## Acceptance Criteria

- The replayed mission preserves the primary semantic content of specifications/mission/model/mission-model.md.
- The replayed mission preserves the primary semantic content of specifications/mission/model/core-object-model.md.
- The resulting replay artifacts define repository, mission, task, artifact, and agent-session as the canonical first-class semantic contexts.
- The resulting replay artifacts preserve mission.json as mission-local workflow runtime truth rather than daemon-wide application state.
- The resulting replay artifacts preserve the ownership boundary that airport layout, focus, panel registration, gate binding, client registration, and terminal-manager reconciliation belong outside the core semantic model.
- Any content needed from repository-layout or workflow specifications is preserved only as explicit secondary coverage and remains aligned with the retrospective specification coverage map.
- No substantive requirement from the source semantic-model corpus is silently dropped; any split across later replay missions is explicit and architecture-aligned.

## Constraints

- Do not collapse workflow-engine semantics, provider-neutral runtime semantics, or airport control-plane authority into the mission semantic model.
- Do not treat the daemon-wide MissionSystemState as a core semantic aggregate owned by packages/core.
- Do not lose source material from the mission-model or core-object-model specifications even if some content must be split or referenced secondarily in later replay missions.
- Do not widen this mission to absorb later replay-mission scope just because the same files are cross-referenced elsewhere.
- Do not treat the known implementation task-generation omission as scope for this replay mission; if implementation-stage task generation must be represented later in replay, it will be emulated explicitly rather than fixed here.

## Source Material

This reconstructed mission is derived from:

- specifications/mission/model/mission-model.md
- specifications/mission/model/core-object-model.md
- specifications/plans/retrospective-specification-coverage-map.md
- specifications/plans/retrospective-replay-workflow.md
- specifications/plans/retrospective-experience.md

Secondary reference material may be used where needed to preserve semantic boundaries coherently:

- specifications/mission/model/repository-layout-and-adoption.md
- specifications/mission/workflow/workflow-engine.md

## Notes

This issue is intended to become the intake anchor for a manually scaffolded retrospective mission dossier. The replay will preserve the semantic-model corpus in the correct mission context, and any later implementation-task generation gap encountered during replay will be handled in explicit emulation mode rather than by inventing undocumented engine behavior.
