---
title: "SPEC: #18 - Reconstruct airport control plane"
artifact: "spec"
createdAt: "2026-04-10T21:32:50.000Z"
updatedAt: "2026-04-10T21:52:00.000Z"
stage: "spec"
---

Branch: mission/18-reconstruct-airport-control-plane

## Mission Intent

- This mission is the retrospective reconstruction of the airport-control-plane decision that made Mission's application runtime daemon-authoritative, repository-scoped, projection-oriented, and reconciled against a terminal substrate instead of being coordinated by shell or panel heuristics.
- The reconstructed dossier must preserve the full outcome described by `BRIEF.md` and `PRD.md`: one daemon-owned composite state root, one explicit split between semantic mission truth and airport layout truth, one repository-keyed airport registry, and one control loop that applies intended state through effects and then reconciles substrate observations back into authoritative state.
- The mission exists because that control-plane architecture is already present in the source specification and is materially present in the current codebase, but the issue-backed dossier history that would explain how Mission became a multi-repository, multi-mission airport system did not yet exist.

## Architecture

- Mission `18` owns the airport-control-plane model described primarily by `specifications/airport/airport-control-plane.md`.
- The daemon is the only authority process. It owns one composite `MissionSystemState` rooted in semantic domain state plus airport state, increments a version on each accepted mutation, persists airport intent, applies substrate effects, and broadcasts panel-facing projections.
- `MissionControl` owns semantic repository, mission, task, artifact, and agent-session truth. It also owns derived mission-operator views such as stage rails and tree nodes. `AirportControl` owns gate bindings, client registration, focus intent, observed focus, repository-scoped airport identity, substrate observations, and the layout-facing routing policy that maps domain selection into gate bindings.
- Airport state is repository-scoped. A repository selection resolves to one canonical airport identity and one canonical terminal-manager session name. The daemon may keep multiple repository-scoped airports warm in memory, but exactly one airport is active for the current projection set.
- Panels are clients, not authorities. Panel processes connect to the daemon, present an injected gate identity, request snapshots, subscribe to projection updates, and send commands or observations through daemon IPC. Panels do not infer gate identity from pane heuristics and do not talk directly to the terminal substrate.
- Terminal-manager is the substrate. It may create panes, close panes, attach sessions, list panes, and apply focus requests, but it is never the source of semantic truth, routing identity, or cross-panel coordination policy.
- The current code already contains major parts of the target system in `packages/core/src/daemon/MissionSystemController.ts`, `packages/core/src/daemon/system/RepositoryAirportRegistry.ts`, `packages/core/src/daemon/system/ProjectionService.ts`, `packages/airport/src/AirportControl.ts`, and `packages/airport/src/terminal-manager.ts`. Mission `18` preserves that architectural direction while tightening the places where current code still allows fallback scope, placeholder projections, or substrate-facing heuristics to leak into the control plane.
- The implementation-task ingestion omission recorded earlier in issue `#12` still applies to retrospective replay. Because the engine does not deterministically ingest manually planned implementation tasks from `taskGeneration[].tasks`, mission `18` will continue in explicit emulation mode after `spec/02-plan` with matching implementation task files and a matching `tasks.generated` runtime event.

## Signatures

- `packages/core/src/types.ts`: preserve the daemon-owned composite `MissionSystemState`, repository-keyed airport registry, and snapshot surface consumed by clients.
- `packages/core/src/daemon/MissionSystemController.ts`: preserve the authoritative command loop that synchronizes workspace state, routes airport commands, plans substrate effects, applies persistence, samples substrate observations, and rebuilds system snapshots.
- `packages/core/src/daemon/system/RepositoryAirportRegistry.ts`: preserve repository-scoped airport identity, lazy airport activation, persisted-intent storage, and repository-keyed substrate control.
- `packages/core/src/daemon/system/MissionControl.ts`: preserve semantic domain truth and mission-operator projection inputs without absorbing airport ownership.
- `packages/core/src/daemon/system/ProjectionService.ts`: preserve daemon-owned projection derivation so panels receive airport-facing data without reconstructing policy locally.
- `packages/core/src/daemon/contracts.ts` and `packages/core/src/client/DaemonAirportApi.ts`: preserve the panel-facing airport command and snapshot contracts.
- `packages/airport/src/types.ts`, `AirportControl.ts`, `effects.ts`, and `terminal-manager.ts`: preserve airport-owned state types, gate bindings, focus semantics, substrate effect planning, and terminal-manager observation or effect behavior.
- `apps/tower/terminal/src/commands/airport-layout.ts`: preserve bootstrap handoff, injected gate identity, and surface connection behavior without turning entry code into long-term layout authority.

## Design Boundaries

- Mission `18` must preserve airport control as one coherent application-controller decision rather than as a loose summary of files that mention dashboards, terminals, or sessions.
- Semantic-model content may be referenced only where needed to preserve the boundary that mission, task, artifact, and session meanings stay in `MissionControl` rather than moving into airport state.
- Workflow-runtime content may be referenced only where needed to preserve the boundary that workflow remains authoritative for mission-local runtime truth while airport consumes derived domain state and mission-operator projections.
- Agent-runtime content may be referenced only where needed to preserve the boundary that runtime surfaces provide session existence and transport facts while airport still owns gate binding, focus, panel identity, and substrate reconciliation.
- The mission must not preserve direct panel-to-terminal-manager control, shell-loop routing, file-signaled pane targeting, global-airport assumptions, or compatibility aliases for older control-plane names. Those are obsolete architecture, not historical contracts to keep.

## Specification Preservation Boundary

- The primary source specification preserved by this mission is `specifications/airport/airport-control-plane.md`.
- Secondary preservation is allowed only for architecture slices required to express the airport boundary coherently in the current system.
- The allowed secondary preservation slices are:
  - from `specifications/mission/model/core-object-model.md`: the parts needed to keep daemon-owned semantic state and airport-owned layout state on distinct ownership lines
  - from `specifications/mission/model/mission-model.md`: the parts needed to state that mission selection and mission-local workflow truth remain semantic records rather than airport layout facts
  - from `specifications/mission/workflow/workflow-engine.md`: the parts needed to state that workflow owns mission-local runtime truth while airport projects that truth into daemon-wide control state
  - from `specifications/mission/execution/agent-runtime.md`: the parts needed to state that runtime session facts feed airport bindings without giving runtime ownership of gates, focus, or substrate control
- This mission must not absorb the primary preservation responsibility for semantic-model naming, workflow reducer semantics, or provider-neutral agent-runtime orchestration.

## Implementation Ledger

- Slice 1: establish repository-scoped airport state as the only valid control-plane scope and remove unscoped or compatibility-oriented airport fallbacks from the airport package and daemon registry path.
- Slice 2: align daemon-owned projection derivation and gate-binding policy so dashboard, editor, and agent-session projections are built from one coherent system state and stop relying on placeholder or split-source assumptions.
- Slice 3: align airport substrate reconciliation and bootstrap handoff so intended focus, observed focus, pane existence, panel claims, and terminal session identity stay airport-owned and explicit.
- Slice 4: align preserved specs, airport-facing contracts, and focused tests so the repository records the airport-control-plane boundary coherently and rejects regressions back toward shell or panel authority.
- Because the current engine omission recorded in issue `#12` still prevents deterministic ingestion of manually planned implementation tasks, replay will materialize the implementation ledger in explicit emulation mode after `spec/02-plan`, using task files and a `tasks.generated` runtime event that agree on the same bounded airport task inventory.

## Coverage Verification

- The replayed `SPEC.md` for mission `18` should preserve the airport-control-plane architecture completely enough that the repository no longer depends on the standalone airport source specification alone to explain daemon-wide layout authority.
- The mission should preserve only the secondary material needed to express the airport boundary cleanly in current-system terms.
- Cross-mission references must remain explicit where source documents span semantic-model, workflow-runtime, or agent-runtime boundaries.
- Downstream planning and implementation tasks for this mission must stay inside that preservation boundary even when the same files also participate in daemon startup, panel connection, or mission-status projection flows.

## File Matrix

- `specifications/airport/airport-control-plane.md`: primary airport-control-plane source for the daemon-owned control loop, repository-scoped airport identity, gate model, panel model, focus semantics, substrate model, and acceptance criteria.
- `specifications/plans/retrospective-specification-coverage-map.md`: preserve the primary and secondary ownership mapping that keeps mission `18` distinct from missions `15`, `16`, and `17`.
- `specifications/plans/retrospective-replay-workflow.md` and `specifications/plans/retrospective-experience.md`: preserve the replay laws that require issue-backed reconstruction, strict ownership boundaries, and explicit emulation-mode continuation.
- `packages/core/src/types.ts`: align the composite system state, airport registry state, and snapshot surfaces with repository-scoped airport authority.
- `packages/core/src/daemon/MissionSystemController.ts`: keep the authoritative command loop, commit ordering, and follow-up observation path aligned with airport ownership.
- `packages/core/src/daemon/system/RepositoryAirportRegistry.ts`: align repository-scoped airport activation, persisted intent, and session naming with the airport specification's multi-repository rules.
- `packages/core/src/daemon/system/ProjectionService.ts`: preserve one daemon-owned source of dashboard, editor, and agent-session projections.
- `packages/core/src/daemon/contracts.ts` and `packages/core/src/client/DaemonAirportApi.ts`: keep panel-facing airport commands explicit and scoped to the daemon-owned control plane.
- `packages/airport/src/types.ts`, `AirportControl.ts`, `effects.ts`, and `terminal-manager.ts`: align airport-owned state, focus semantics, substrate effects, and terminal-manager observation rules with the clean-break airport contract.
- `apps/tower/terminal/src/commands/airport-layout.ts`: preserve injected gate identity and bootstrap handoff while avoiding long-term authority drift back into entry code.
- `packages/airport/src/*.test.ts` and `packages/core/src/daemon/Daemon.test.ts`: keep focused validation aligned with repository-scoped airport authority, panel connection semantics, substrate reconciliation, and multi-repository airport behavior.