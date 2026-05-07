---
title: "SPEC: #16 - Reconstruct workflow engine and repository workflow settings"
artifact: "spec"
createdAt: "2026-04-10T20:37:14.000Z"
updatedAt: "2026-04-10T20:47:00.000Z"
stage: "spec"
---

Branch: mission/16-reconstruct-workflow-engine-and-repository-workf

## Mission Intent

- This mission is the retrospective reconstruction of the workflow-runtime decision that made Mission's mutable runtime truth mission-local, event-driven, reducer-owned, and reproducible from `mission.json`.
- The reconstructed dossier must preserve the full outcome described by `BRIEF.md` and `PRD.md`: one coherent workflow engine contract plus one daemon-owned repository workflow settings contract, with explicit ownership boundaries between semantic model, workflow runtime, agent runtime, and airport control plane.
- The mission exists because that workflow-runtime and repository-policy architecture already exists in specifications and code, but the real issue-backed dossier history that would explain that architectural step did not yet exist.

## Architecture

- Mission `16` owns the workflow-runtime and repository-policy model described primarily by `specifications/mission/workflow/workflow-engine.md`, `specifications/mission/configuration/repository-workflow-settings.md`, and `specifications/checklists/workflow-engine-checklist.md`.
- `mission.json` is the authoritative mission-local workflow document. Workflow runtime state changes only through accepted workflow events, and the reducer is the only component allowed to mutate workflow runtime state.
- Stage state is derived from task state and workflow structure. Task lifecycle, launch mode, queueing, mission pause state, gate projections, and active stage authority are workflow-owned runtime concerns rather than semantic-model naming concerns or daemon-wide application state.
- Repository workflow settings live under `.mission/settings.json` and are daemon-owned. Initialization, normalization, RFC 6902 patch validation, revision checks, atomic persistence, and update notifications belong to daemon-controlled settings infrastructure rather than to CLI or Tower surfaces.
- Repository workflow settings affect `draft` missions only. The mission-local workflow snapshot is captured exactly at the `draft` to `ready` transition, after which mission runtime becomes isolated from later repository settings edits.
- Deterministic task generation belongs to the workflow engine. Runtime tasks are derived from the workflow snapshot plus `stageId`, not from ad hoc filesystem discovery of task files. For replay purposes, if implementation-stage task generation must be materialized while the current omission recorded in issue `#12` still exists, the replay may continue in explicit emulation mode as long as the derived ledger stays bounded and internally coherent.
- Workflow request execution may call into shared agent-runtime surfaces, but provider-neutral session orchestration remains owned primarily by mission `4`.
- Airport layout, focus, gate bindings, panel state, client registration, and terminal substrate reconciliation remain daemon-wide system concerns owned primarily by mission `5`.

## Signatures

- `packages/core/src/workflow/engine/types.ts`: preserve workflow document types, mission lifecycle, task lifecycle, stage projections, gate projections, and workflow event shapes.
- `packages/core/src/workflow/engine/document.ts`, `reducer.ts`, `validation.ts`, `generator.ts`, `controller.ts`, and `requestExecutor.ts`: preserve workflow creation, event ingestion, deterministic generation, reducer semantics, and effect planning.
- `packages/core/src/settings/types.ts`, `jsonPatch.ts`, `validation.ts`, `revision.ts`, and `WorkflowSettingsStore.ts`: preserve the daemon-owned repository workflow settings contract.
- `packages/core/src/daemon/Workspace.ts`, `packages/core/src/daemon/mission/Factory.ts`, and `packages/core/src/daemon/MissionWorkflowSnapshot.test.ts`: preserve mission start, workflow snapshot timing, and daemon routing for workflow settings surfaces.
- `packages/core/src/client/DaemonControlApi.ts` and `packages/core/src/client/DaemonClient.ts`: preserve the client contract for daemon-owned workflow settings methods.
- `packages/core/src/lib/daemonConfig.ts`: preserve neutral file-format and path helpers while keeping workflow policy mutation on the settings store boundary.

## Design Boundaries

- Mission `16` must preserve workflow-runtime and repository-settings ownership as one coherent architectural decision rather than as a loose summary of whichever files mention workflow state.
- Semantic-model and object-model content may be referenced only where needed to preserve ownership boundaries around mission-local runtime records, repository settings, and task or session identity.
- Agent-runtime content may be referenced only where needed to preserve workflow request execution boundaries and session launch, prompt, command, cancel, or terminate effects.
- Airport control-plane content may be referenced only where needed to state what workflow runtime does not own.
- The mission must not absorb later replay-mission ownership just because workflow runtime interacts with those systems.
- The mission must not silently rewrite omission issues `#12` or `#13` into replay-owned backlog. Replay may emulate implementation-stage task generation when the current artifacts are specific enough, but the omission itself remains separately tracked product work.

## Specification Preservation Boundary

- The primary source specifications preserved by this mission are `specifications/mission/workflow/workflow-engine.md`, `specifications/mission/configuration/repository-workflow-settings.md`, and `specifications/checklists/workflow-engine-checklist.md`.
- Secondary preservation is allowed only for architecture slices required to express the workflow-runtime boundary coherently in the current system.
- The allowed secondary preservation slices are:
  - from `specifications/mission/model/mission-model.md`: the parts needed to state that `mission.json` is mission-local workflow truth and that repository workflow settings seed mission-local snapshots without redefining semantic ownership
  - from `specifications/mission/model/core-object-model.md`: the parts needed to keep workflow-owned terms aligned with the current naming boundary
  - from `specifications/mission/execution/agent-runtime.md`: the parts needed to state that workflow emits runtime requests rather than owning provider-specific orchestration
  - from `specifications/airport/airport-control-plane.md`: the parts needed to state that airport layout and gate or panel authority remain outside the workflow engine
- This mission must not absorb the primary preservation responsibility for semantic-model naming, provider-neutral session orchestration, or daemon-wide airport control-plane authority.

## Implementation Ledger

- Slice 1: establish the mission-local workflow document and reducer-owned runtime boundary.
- Slice 2: align deterministic task generation, event ingestion, and scheduling behavior with the workflow-engine contract.
- Slice 3: align daemon-owned repository workflow settings, snapshot timing, and surface contracts.
- Slice 4: update preserved specs, control consumers, and focused tests so the mission `16` workflow boundary is recorded coherently.
- Because the current engine omission recorded in issue `#12` still prevents deterministic ingestion of manually planned implementation tasks, replay will materialize the implementation ledger in explicit emulation mode after `spec/02-plan`, using a matching `tasks.generated` runtime event and task files that agree on the same bounded task inventory.

## Coverage Verification

- The replayed `SPEC.md` for mission `16` should preserve the workflow-engine and repository-workflow-settings architecture completely enough that the repository no longer depends on scattered pre-workflow notes to explain those concepts.
- The mission should preserve only the secondary material needed to express that workflow boundary cleanly.
- Cross-mission references must remain explicit where source documents span semantic-model, agent-runtime, or airport-control-plane boundaries.
- Downstream planning and implementation tasks for this mission must stay inside that preservation boundary even when the same code files also participate in later replay missions.

## File Matrix

- `specifications/mission/workflow/workflow-engine.md`: primary workflow-runtime source for mission lifecycle, reducer semantics, task generation, scheduling, pause, restart, and delivery behavior.
- `specifications/mission/configuration/repository-workflow-settings.md`: primary repository-policy source for daemon-owned workflow settings initialization, update, validation, revision, and surface contracts.
- `specifications/checklists/workflow-engine-checklist.md`: primary supporting checklist for deterministic workflow implementation sequencing and validation.
- `specifications/plans/repository-workflow-settings-plan.md`: preserve the concrete settings implementation phases as mission `16` planning support rather than as a separate replay mission.
- `specifications/plans/retrospective-specification-coverage-map.md`: preserve the primary and secondary ownership mapping that keeps mission `16` distinct from missions `15`, `4`, and `5`.
- `specifications/plans/retrospective-replay-workflow.md` and `specifications/plans/retrospective-experience.md`: preserve the replay laws that require issue-backed reconstruction, strict mission decomposition, intake-anchor recentering, and explicit emulation-mode continuation.
- `packages/core/src/workflow/engine/*.ts`: align workflow document types, reducer behavior, validation, generation, and request execution with the preserved workflow-engine contract.
- `packages/core/src/settings/*.ts`: keep repository workflow settings daemon-owned, RFC 6902-based, revision-protected, and atomically persisted.
- `packages/core/src/daemon/Workspace.ts`, `packages/core/src/daemon/mission/Factory.ts`, and `packages/core/src/client/*.ts`: preserve the daemon and client surfaces that expose workflow settings and start missions against repository workflow policy.
- `packages/core/src/daemon/MissionWorkflowSnapshot.test.ts`, `packages/core/src/settings/*.test.ts`, and `packages/core/src/workflow/engine/reducer.test.ts`: keep focused validation aligned with the preserved workflow-runtime and repository-policy boundary.
