---
title: "PRD: #15 - Reconstruct mission semantic model and core object model"
artifact: "prd"
createdAt: "2026-04-10T19:45:21.638Z"
updatedAt: "2026-04-10T19:47:34.626Z"
stage: "prd"
---

Branch: mission/15-reconstruct-mission-semantic-model-and-core-obje

## Outcome

- Establish one coherent semantic model for Mission in which the repository-resident mission dossier, mission-local workflow runtime, and canonical core object-model terms line up with the current architecture.
- Preserve the first-class semantic contexts owned by the core model: repository, mission, task, artifact, and agent session, along with the mission-local records and ownership boundaries that make those contexts operationally meaningful.
- Convert the existing mission-model and core-object-model specifications into a replayed mission artifact trail without losing scope, flattening cross-cutting material, or collapsing later replay-mission ownership into mission `15`.

## Problem Statement

- The semantic mission model and the canonical core object model already exist in the repository, but the historical mission that established them is not yet represented as a first-class Mission dossier backed by a real issue intake anchor.
- The current specification corpus spreads semantic model intent across `mission-model.md`, `core-object-model.md`, and cross-referenced workflow and repository-layout material, which makes it easy for later replay work to either lose important semantic requirements or absorb too much neighboring architecture into the wrong mission.
- Without a reconstructed PRD for this mission, the repository lacks a durable statement of the product outcome that made repository mission records, mission-local workflow state, and packages/core naming rules cohere as one architectural step.

## Success Criteria

- The replayed mission preserves the primary semantic content of `specifications/mission/model/mission-model.md`.
- The replayed mission preserves the primary semantic content of `specifications/mission/model/core-object-model.md`.
- The resulting mission artifacts define `repository`, `mission`, `task`, `artifact`, and `agentSession` as the canonical first-class semantic contexts for the core model.
- The resulting mission artifacts preserve `mission.json` as the authoritative mission-local workflow runtime document rather than daemon-wide application state.
- The resulting mission artifacts preserve the distinction between repo-scoped settings, branch-scoped tracked mission dossiers, and machine-local daemon runtime state where that distinction is part of the semantic model.
- The resulting mission artifacts preserve the object-model ownership boundary that airport layout, focus, panel registration, client state, gate binding, and terminal substrate reconciliation belong outside the core semantic model.
- Any semantic material borrowed from repository layout or workflow sources is represented only as explicit secondary coverage and stays aligned with the retrospective specification coverage map.
- No substantive semantic-model requirement is silently dropped; if some content belongs primarily to mission `3`, `4`, or `5`, that split remains explicit and architecture-aligned.

## Constraints

- Do not collapse workflow-engine semantics, provider-neutral runtime semantics, or airport control-plane authority into the mission semantic model.
- Do not redefine the daemon-wide `MissionSystemState` as a packages/core aggregate owned by this mission.
- Do not lose source material from `mission-model.md` or `core-object-model.md` even if part of that material must be represented as explicit secondary references in later replay missions.
- Do not widen mission `15` to absorb repository-adoption ownership from mission `11` or workflow-runtime ownership from mission `3`.
- Keep the current replay decomposition intact: mission `15` owns semantic model and object-model preservation, not the full downstream implementation backlog.
- Treat the known implementation task-generation omission as a replay constraint to be emulated later if needed, not as product scope to be fixed during this mission.

## Non-Goals

- Reconstruct the workflow-engine implementation contract as a primary mission outcome; that belongs to the workflow-engine replay mission.
- Reconstruct provider-neutral session orchestration as a primary mission outcome; that belongs to the agent-runtime replay mission.
- Reconstruct the daemon-wide airport control plane, gate bindings, layout projections, or terminal substrate ownership; that belongs to the airport-control-plane replay mission.
- Re-open repository-adoption path decisions already preserved by mission `11`, except where mission `15` must reference them narrowly to define semantic storage scopes.
- Implement or fix the missing deterministic implementation-task generation path while the five retrospective replay missions are still in progress.
