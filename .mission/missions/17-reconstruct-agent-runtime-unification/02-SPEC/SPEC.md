---
title: "SPEC: #17 - Reconstruct agent runtime unification"
artifact: "spec"
createdAt: "2026-04-10T21:00:07.000Z"
updatedAt: "2026-04-10T21:12:00.000Z"
stage: "spec"
---

Branch: mission/17-reconstruct-agent-runtime-unification

## Mission Intent

- This mission is the retrospective reconstruction of the runtime-boundary decision that made Mission's agent execution model provider-neutral, session-centric, and coordinated through one orchestrator path.
- The reconstructed dossier must preserve the full outcome described by `BRIEF.md` and `PRD.md`: one authoritative runtime contract in core, one orchestrator used by both workflow-driven and operator-driven session control, and explicit ownership boundaries between workflow semantics, runtime translation, and airport control-plane authority.
- The mission exists because the desired runtime architecture already exists in specifications and in partially aligned code, but the real issue-backed dossier history that would explain that architectural step did not yet exist.

## Architecture

- Mission `17` owns the provider-neutral runtime model described primarily by `specifications/mission/execution/agent-runtime.md` and `specifications/plans/agent-runtime-plan.md`.
- The core runtime boundary is `AgentRunner` plus `AgentSession`, along with normalized prompt, command, snapshot, event, capability, and session-reference types owned by Mission rather than by any provider adapter.
- The session orchestrator is the only coordination layer allowed to bridge workflow requests or operator actions into live runtime sessions. It owns runner registration, session registration, attach or reattach logic, prompt and command routing, normalized event forwarding, and persisted session snapshot coordination.
- Workflow remains the authority for semantic mission runtime truth. Workflow decides when sessions launch, prompt, checkpoint, interrupt, cancel, terminate, or reconcile. Runtime surfaces satisfy those requests; they do not redefine workflow policy.
- Provider adapters own translation only. They may allocate terminal-backed sessions, inject governed input, capture transcript or process facts, and map provider-native behavior into normalized Mission snapshots and events, but they do not own workflow policy, airport gate binding, or panel layout authority.
- Airport remains the owner of gate binding, focus, panel identity, and substrate reconciliation. Runtime transport metadata may expose terminal identifiers for diagnostics and reconciliation, but those identifiers are not airport truth.
- The current codebase already contains major parts of the target runtime namespace, including `packages/core/src/runtime/AgentRunner.ts`, `AgentSession.ts`, `AgentRuntimeTypes.ts`, `AgentRunnerRegistry.ts`, and `AgentSessionOrchestrator.ts`. Mission `17` preserves that unification outcome while also preserving the remaining clean-break requirement to eliminate split-era naming and dual-path semantics where they still survive.
- The current implementation-task ingestion omission recorded in issue `#12` still applies to retrospective replay. The generator continues to render `templateSources` only and does not ingest planned implementation task definitions through `taskGeneration[].tasks`, so implementation-stage replay must continue in explicit emulation mode once the implementation inventory is specific enough.

## Signatures

- `packages/core/src/runtime/AgentRuntimeTypes.ts`, `AgentRunner.ts`, `AgentSession.ts`, `AgentRunnerRegistry.ts`, `AgentSessionOrchestrator.ts`, and `PersistedAgentSessionStore.ts`: preserve the normalized runtime contracts and orchestrator-owned coordination boundary.
- `packages/core/src/workflow/engine/requestExecutor.ts`, `controller.ts`, and related workflow runtime surfaces: preserve how workflow request execution launches, attaches, prompts, commands, cancels, and terminates sessions through the unified runtime boundary.
- `packages/core/src/daemon/Workspace.ts`, `packages/core/src/daemon/runDaemonMain.ts`, `packages/core/src/daemon/defaultRuntimeFactory.ts`, `packages/core/src/daemon/protocol.ts`, and `packages/core/src/daemon/mission/*.ts`: preserve daemon-owned runner loading, session routing, and mission-facing session operations through one runtime registry and orchestrator path.
- `packages/core/src/client/DaemonMissionApi.ts` and related client surfaces: preserve the public session-launch and session-control contracts while aligning payloads and terminology with the unified runtime boundary.
- `packages/core/src/adapters/*.ts`: preserve provider-specific translation behind the normalized runtime contract without keeping split-era workflow-only adapters as parallel long-term paths.
- `packages/core/src/index.ts` and any adapter-package exports: preserve one canonical runtime export surface rather than multiple competing runtime abstractions.

## Design Boundaries

- Mission `17` must preserve runtime unification as one coherent architectural decision rather than as a loose summary of whichever files mention sessions or terminals.
- Workflow-engine material may be referenced only where needed to preserve the fact that workflow emits semantic runtime requests and stores normalized session facts; reducer semantics and broader workflow ownership remain primary to mission `16`.
- Semantic-model and object-model material may be referenced only where needed to preserve naming boundaries around `AgentRunner`, `AgentSession`, session snapshots, and persisted session references.
- Airport-control-plane material may be referenced only where needed to state what runtime startup and transport metadata do not own.
- The mission must not absorb daemon-wide airport layout, gate binding, focus policy, or substrate reconciliation authority just because runtime adapters interact with terminal infrastructure.
- The mission must not preserve split-era compatibility glue as a valid long-term state. If old type names or surfaces remain in code for migration debt, they are debt to remove, not architecture to preserve.

## Specification Preservation Boundary

- The primary source specifications preserved by this mission are `specifications/mission/execution/agent-runtime.md` and `specifications/plans/agent-runtime-plan.md`.
- Secondary preservation is allowed only for architecture slices required to express the runtime boundary coherently in the current system.
- The allowed secondary preservation slices are:
	- from `specifications/mission/workflow/workflow-engine.md`: the parts needed to state that workflow emits normalized runtime requests and reduces normalized session facts into mission state
	- from `specifications/mission/model/core-object-model.md`: the parts needed to keep runtime-owned names and ownership boundaries aligned with the broader core object model
	- from `specifications/airport/airport-control-plane.md`: the parts needed to state that runtime transport and session existence feed Airport, while Airport still owns gate binding, focus, panel identity, and substrate reconciliation
- This mission must not absorb the primary preservation responsibility for workflow runtime, semantic-model naming outside the runtime slice, or daemon-wide airport control-plane authority.

## Implementation Ledger

- Slice 1: establish the unified core runtime contract and remove split-boundary ambiguity from normalized runtime types and interfaces.
- Slice 2: align the session orchestrator, runner registry, and persisted session coordination path around the unified runtime boundary.
- Slice 3: align workflow-engine request execution and session reconciliation with the unified runtime path.
- Slice 4: align daemon and client session surfaces, protocol terms, and configured runner loading with one runtime registry and one session-control path.
- Slice 5: align provider adapters, exports, preserved specs, and focused tests with the clean-break runtime contract.
- Because the current engine omission recorded in issue `#12` still prevents deterministic ingestion of manually planned implementation tasks, replay will materialize the implementation ledger in explicit emulation mode after `spec/02-plan`, using matching task files and a `tasks.generated` runtime event that agree on the same bounded task inventory.

## Coverage Verification

- The replayed `SPEC.md` for mission `17` should preserve the agent-runtime architecture completely enough that the repository no longer depends on scattered source documents alone to explain the provider-neutral execution boundary.
- The mission should preserve only the secondary material needed to express that runtime boundary cleanly in current-system terms.
- Cross-mission references must remain explicit where source documents span workflow, semantic-model, or airport-control-plane boundaries.
- Downstream planning and implementation tasks for this mission must stay inside that preservation boundary even when the same files also participate in workflow execution or airport integration.

## File Matrix

- `specifications/mission/execution/agent-runtime.md`: primary runtime source for `AgentRunner`, `AgentSession`, prompts, commands, snapshots, events, orchestrator rules, adapter rules, and airport handoff boundaries.
- `specifications/plans/agent-runtime-plan.md`: primary implementation sequencing source for contract definition, orchestrator introduction, workflow rewiring, daemon-session rewiring, adapter rewrites, and deletion of split-era contracts.
- `specifications/plans/retrospective-specification-coverage-map.md`: preserve the primary and secondary ownership mapping that keeps mission `17` distinct from missions `16` and `5`.
- `specifications/plans/retrospective-replay-workflow.md` and `specifications/plans/retrospective-experience.md`: preserve the replay laws that require issue-backed reconstruction, strict mission decomposition, and explicit emulation-mode continuation where engine omissions remain unresolved.
- `packages/core/src/runtime/*.ts`: align the normalized runtime contract, orchestrator, and persisted session store with the preserved agent-runtime boundary.
- `packages/core/src/workflow/engine/requestExecutor.ts` and related workflow runtime surfaces: keep runtime requests flowing through the orchestrator rather than through split workflow-only runtime abstractions.
- `packages/core/src/daemon/runDaemonMain.ts`, `packages/core/src/daemon/defaultRuntimeFactory.ts`, `packages/core/src/daemon/Workspace.ts`, and `packages/core/src/daemon/protocol.ts`: preserve daemon-owned runner loading and session routing through one unified runtime path.
- `packages/core/src/client/DaemonMissionApi.ts` and related client surfaces: keep session launch, prompt, command, cancel, and terminate operations aligned with the unified runtime terminology.
- `packages/core/src/adapters/*.ts`: preserve provider translation behind the normalized runtime contract while removing split-era workflow-only adapter ownership.
- `packages/core/src/runtime/AgentSessionOrchestrator.test.ts`, `packages/core/src/testing/FakeAgentRunner.ts`, and focused workflow or daemon session tests: keep validation aligned with the preserved runtime boundary.