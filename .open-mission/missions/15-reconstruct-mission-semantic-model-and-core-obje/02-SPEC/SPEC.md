---
title: "SPEC: #15 - Reconstruct mission semantic model and core object model"
artifact: "spec"
createdAt: "2026-04-10T19:45:21.638Z"
updatedAt: "2026-04-10T19:48:23.467Z"
stage: "spec"
---

Branch: mission/15-reconstruct-mission-semantic-model-and-core-obje

## Mission Intent

- This mission is the retrospective reconstruction of the semantic-model decision that made Mission's repository-resident records, mission-local workflow document, and packages/core naming system line up as one coherent architectural layer.
- The reconstructed dossier must preserve the full outcome described by `BRIEF.md` and `PRD.md`: one canonical semantic model for repository, mission, task, artifact, and agent-session concepts, with explicit ownership boundaries between packages/core, the workflow engine, the agent runtime, and the airport control plane.
- The mission exists because the architecture already exists in specifications and code, but the real issue-backed dossier history that would explain that semantic-model step did not yet exist.

## Architecture

- Mission `15` owns the semantic model described primarily by `specifications/mission/model/mission-model.md` and `specifications/mission/model/core-object-model.md`.
- The canonical first-class semantic contexts are `repository`, `mission`, `task`, `artifact`, and `agentSession`. Those contexts define what Mission means by a repository, a mission, a workflow unit of work, a persisted mission document, and a provider-backed execution record.
- The mission-local workflow document `mission.json` is authoritative for mutable workflow runtime truth, but it is still mission-local semantic state rather than daemon-wide application state.
- Repository-scoped settings, branch-scoped tracked mission dossiers, and machine-local daemon runtime state are distinct storage scopes. Mission `15` preserves that distinction where it is part of the semantic model, while mission `11` remains the primary owner of the repository-adoption path model itself.
- `packages/core` owns the semantic object model and naming rules. It does not own airport layout state, focus state, panel registration, client registration, gate binding state, or terminal-manager reconciliation.
- The daemon-wide top-level authority is `MissionSystemState`, but mission `15` preserves that fact only as a boundary condition: `MissionSystemState` is not a packages/core semantic aggregate to be redefined here.
- Workflow runtime concepts such as reducer events, requests, signals, stage projections, task runtime, and gate projections may appear in this mission only to the extent needed to define semantic ownership and naming. The workflow-engine replay mission remains the primary owner of workflow execution semantics.
- Agent-runner and session concepts may appear in this mission only to the extent needed to preserve the canonical `AgentSession` and `AgentSessionRuntime` boundary in the object model. Provider-neutral orchestration remains owned primarily by the later agent-runtime mission.

## Signatures

- `packages/core/src/types.ts`: preserve the semantic records and cross-domain context types, including `MissionBrief`, `MissionDescriptor`, `MissionRecord`, `MissionTaskState`, `MissionStageStatus`, `RepositoryContext`, `MissionContext`, and `MissionSystemState`.
- `packages/core/src/workflow/engine/types.ts`: preserve the workflow-owned runtime document and projection types only to the extent required to state the semantic ownership of `MissionRuntime`, `WorkflowRuntimeState`, `TaskRuntime`, `StageRuntime`, and gate projections.
- `packages/core/src/daemon/system/MissionControl.ts`: preserve how repository and mission contexts are projected into the daemon-owned domain graph without reassigning top-level application authority to packages/core.
- `packages/core/src/daemon/system/ProjectionService.ts`: preserve how semantic mission and repository contexts feed operator-facing projections while keeping those projections distinct from semantic ownership.
- `packages/core/src/daemon/mission/Mission.ts`: preserve the mission-local interpretation of descriptor state, runtime state, artifact ownership, and stage/task projections as mission semantics rather than layout or control-plane truth.
- `packages/core/src/lib/FilesystemAdapter.ts`: preserve the mapping between semantic mission records and persisted dossier files, especially `BRIEF.md`, task artifacts, and root-level `mission.json`.

## Design Boundaries

- Mission `15` must preserve the semantic model and object-model naming system as one coherent architectural decision rather than as a loose summary of whatever files happen to mention mission data.
- Repository layout and adoption details may be referenced only where the semantic model depends on them, such as storage-scope distinctions and the tracked mission-dossier boundary.
- Workflow runtime semantics may be referenced only where the semantic model depends on them, such as the fact that mutable workflow truth lives in `mission.json` and that runtime projections are derived rather than layout-owned.
- Agent-runtime semantics may be referenced only where needed to preserve the `AgentSession` boundary in the object model.
- Airport control-plane semantics may be referenced only where needed to state what the semantic model does not own.
- The mission must not absorb later replay-mission ownership just because the source documents cross-reference one another.

## Specification Preservation Boundary

- The primary source specifications preserved by this mission are `specifications/mission/model/mission-model.md` and `specifications/mission/model/core-object-model.md`.
- Secondary preservation is allowed only for architecture slices required to express the semantic model coherently in the current system.
- The allowed secondary preservation slices are:
	- from `specifications/mission/model/repository-layout-and-adoption.md`: the parts needed to state repo-scoped settings, branch-scoped tracked mission dossiers, and machine-local runtime state as distinct semantic storage scopes
	- from `specifications/mission/workflow/workflow-engine.md`: the parts needed to state that `mission.json` is the authoritative mission-local workflow runtime document and that runtime projections are reducer-owned
- This mission must not absorb the primary preservation responsibility for repository-adoption workflow, repository workflow settings, provider-neutral runtime orchestration, or airport control-plane authority.
- If those documents are referenced here, they are references only. Their normative preservation belongs to later replay missions according to the retrospective specification coverage map.

## Coverage Verification

- The replayed `SPEC.md` for mission `15` should preserve the semantic-model and core-object-model architecture completely enough that the repository no longer depends on scattered pre-workflow notes to explain those concepts.
- The mission should preserve only the secondary material needed to state that architecture cleanly in current-system terms.
- Cross-mission references must remain explicit where a source document spans repository layout, workflow runtime, agent runtime, or airport control-plane boundaries.
- Downstream planning and implementation tasks for this mission must stay inside that preservation boundary even when the same code files also participate in later replay missions.


## File Matrix
- `specifications/mission/model/mission-model.md`: primary semantic source for mission contexts, mission-local records, artifact ownership, storage scopes, frontmatter rules, and derived-state rules.
- `specifications/mission/model/core-object-model.md`: primary semantic source for canonical object-model naming, ownership boundaries, and cross-spec alignment rules.
- `specifications/plans/retrospective-specification-coverage-map.md`: preserve the primary and secondary ownership mapping that keeps mission `15` distinct from missions `11`, `3`, `4`, and `5`.
- `specifications/plans/retrospective-replay-workflow.md`: preserve the replay rules that require specification preservation, explicit ownership boundaries, and issue-backed reconstruction.
- `specifications/plans/retrospective-experience.md`: preserve the lessons about strict mission decomposition, explicit scope re-checks, and not collapsing later missions into earlier replay work.
- `packages/core/src/types.ts`: align the exported semantic records and context types with the preserved mission-model and object-model terminology.
- `packages/core/src/workflow/engine/types.ts`: keep workflow runtime document and projection type names aligned with the semantic ownership model while leaving workflow execution semantics to mission `3`.
- `packages/core/src/workflow/engine/document.ts`, `packages/core/src/workflow/engine/reducer.ts`, and `packages/core/src/workflow/engine/controller.ts`: preserve the mission-local workflow document boundary and the fact that runtime projections are derived from workflow events rather than from ad hoc filesystem state.
- `packages/core/src/lib/FilesystemAdapter.ts`: keep descriptor, artifact, task, and `mission.json` persistence aligned with the semantic model rather than introducing alternate ownership rules.
- `packages/core/src/daemon/mission/Mission.ts`: keep mission-local status, stage, task, and artifact projections aligned with the preserved semantic model.
- `packages/core/src/daemon/system/MissionControl.ts` and `packages/core/src/daemon/system/ProjectionService.ts`: preserve how semantic repository and mission contexts feed the daemon-owned domain graph and operator projections without collapsing those projections into semantic authority.
