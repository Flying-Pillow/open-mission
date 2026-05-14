---
issueId: 17
title: "Reconstruct agent runtime unification"
type: "task"
branchRef: "mission/17-reconstruct-agent-runtime-unification"
createdAt: "2026-04-10T21:00:07.000Z"
url: "https://github.com/Flying-Pillow/mission/issues/17"
---

Issue: #17

## Goal

Reconstruct the major historical mission that established Mission's provider-neutral agent runtime boundary and unified session orchestration model.

This is a retrospective reconstruction issue. The architecture and specifications already exist in the repository today. The purpose of this issue is to create the real GitHub intake anchor that a Mission start flow would have used, so Mission can dogfood its own issue-backed intake model while rebuilding its development history.

## Scope

This mission covers the agent-runtime unification outcome, including:

- preserving one provider-neutral runtime boundary for agent execution through `AgentRunner` and `AgentSession`
- preserving one orchestrator-owned coordination path for session start, attach, prompt submission, command submission, cancel, terminate, and normalized event forwarding
- preserving the clean-break replacement of the split `MissionAgentRuntime` and `WorkflowTaskRunner` architecture
- preserving normalized runtime snapshot, event, prompt, command, capability, and session-reference semantics as Mission-owned core contracts
- preserving the boundary that workflow owns semantic runtime requests while runtime adapters own provider translation only
- preserving the boundary that airport owns gate binding, focus, panel identity, and substrate reconciliation rather than the runtime layer
- preserving terminal-backed runtime support only as execution transport metadata and adapter behavior, not as airport authority or provider privilege

## Expected Outcome

Mission should have one coherent agent runtime model with:

1. one authoritative provider-neutral runtime contract in core
2. one orchestrator path used by both workflow-driven execution and operator-driven session interaction
3. one provider registration model for configured runners
4. one normalized session lifecycle, prompt, command, snapshot, and event model
5. a replayed specification trail that preserves the substantive content of the agent-runtime source specification and implementation plan without collapsing workflow or airport-control-plane ownership into mission scope

## Acceptance Criteria

- The replayed mission preserves the primary content of `specifications/mission/execution/agent-runtime.md`.
- The replayed mission preserves the implementation sequencing and deletion-or-replacement intent documented in `specifications/plans/agent-runtime-plan.md`.
- The resulting replay artifacts preserve one runtime boundary rather than a long-term split between workflow-only and interactive session contracts.
- The resulting replay artifacts preserve one orchestrator-owned path for launch, attach, prompt, command, cancel, and terminate operations.
- The resulting replay artifacts preserve normalized session snapshots and events as Mission-owned runtime truth rather than provider-native transport shapes.
- Any workflow-engine or airport-control-plane material referenced by this mission is preserved only as explicit secondary coverage aligned with the retrospective specification coverage map.
- No substantive provider-neutral runtime requirement is silently dropped; any split across missions `16` or `5` remains explicit and architecture-aligned.

## Constraints

- Do not collapse workflow-engine authority over reducer-owned runtime requests into the runtime adapters.
- Do not collapse daemon-wide airport control-plane authority over gate binding, focus, panel registration, or substrate reconciliation into this runtime mission.
- Do not preserve long-term compatibility shims, alias types, or dual active runtime paths between `MissionAgentRuntime`, `WorkflowTaskRunner`, and the unified runtime contract.
- Do not treat provider-specific behavior, Copilot-specific naming, or terminal-manager substrate details as the normative core runtime contract.
- Do not widen this mission to absorb airport-control-plane or workflow omission-remediation work unless the replayed source material explicitly requires it.

## Source Material

This reconstructed mission is derived from:

- `specifications/mission/execution/agent-runtime.md`
- `specifications/plans/agent-runtime-plan.md`
- `specifications/plans/retrospective-specification-coverage-map.md`
- `specifications/plans/retrospective-replay-workflow.md`
- `specifications/plans/retrospective-experience.md`

Secondary reference material may be used where needed to preserve runtime boundaries coherently:

- `specifications/mission/workflow/workflow-engine.md`
- `specifications/mission/model/core-object-model.md`
- `specifications/airport/airport-control-plane.md`

## Notes

This issue is intended to become the intake anchor for a manually scaffolded retrospective mission dossier. The replay should preserve the provider-neutral runtime corpus in the correct mission context while keeping workflow-runtime and airport-control-plane ownership explicit and separate.