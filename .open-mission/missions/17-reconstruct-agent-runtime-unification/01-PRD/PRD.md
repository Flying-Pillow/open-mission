---
title: "PRD: #17 - Reconstruct agent runtime unification"
artifact: "prd"
createdAt: "2026-04-10T21:00:07.000Z"
updatedAt: "2026-04-10T21:05:00.000Z"
stage: "prd"
---

Branch: mission/17-reconstruct-agent-runtime-unification

## Outcome

- Establish one coherent provider-neutral runtime model in which `AgentRunner` and `AgentSession` are the core execution contracts and one orchestrator-owned coordination path serves both workflow-driven execution and operator-driven session interaction.
- Preserve the clean-break replacement of the split `WorkflowTaskRunner` and `MissionAgentRuntime` architecture so Mission has one authoritative runtime boundary rather than separate workflow and interactive paths.
- Convert the existing agent-runtime specification and implementation plan into a replayed mission artifact trail without collapsing workflow-engine or airport-control-plane ownership into mission `17`.

## Problem Statement

- The repository's intended runtime architecture is provider-neutral and session-centric, but the historical mission that established that boundary is not yet represented as a first-class Mission dossier backed by a real issue intake anchor.
- The split between workflow-only and interactive runtime contracts is architecturally wrong for the target system because it forces workflow semantics, session control, and provider translation to leak across multiple abstractions instead of one normalized runtime model.
- The current source corpus spreads the desired runtime boundary across `agent-runtime.md`, the agent runtime plan, and implementation surfaces that already show partial unification work, making it too easy for later replay work to blur where workflow authority stops, where runtime orchestration begins, and where airport authority remains separate.

## Success Criteria

- The replayed mission preserves the primary content of `specifications/mission/execution/agent-runtime.md`.
- The replayed mission preserves the implementation sequencing and deletion-or-replacement intent documented in `specifications/plans/agent-runtime-plan.md`.
- The resulting replay artifacts preserve one runtime boundary rather than a long-term split between workflow-only and interactive session contracts.
- The resulting replay artifacts preserve one orchestrator-owned path for launch, attach, prompt, command, cancel, and terminate operations.
- The resulting replay artifacts preserve normalized session snapshots and events as Mission-owned runtime truth rather than provider-native transport shapes.
- Any workflow-engine or airport-control-plane material referenced by this mission is represented only as explicit secondary coverage aligned with the retrospective specification coverage map.
- No substantive provider-neutral runtime requirement is silently dropped; if some content belongs primarily to mission `16` or `5`, that split remains explicit and architecture-aligned.

## Constraints

- Do not collapse workflow-engine authority over reducer-owned runtime requests into runtime adapters.
- Do not collapse daemon-wide airport control-plane authority over gate binding, focus, panel registration, or substrate reconciliation into this runtime mission.
- Do not preserve long-term compatibility shims, alias types, or dual active runtime paths between `MissionAgentRuntime`, `WorkflowTaskRunner`, and the unified runtime contract.
- Do not treat provider-specific behavior, Copilot-specific naming, or terminal-manager substrate details as the normative core runtime contract.
- Do not widen mission `17` to absorb airport-control-plane work or workflow omission-remediation work unless the replayed source material explicitly requires it.

## Non-Goals

- Reconstruct reducer-owned workflow state transitions or repository workflow settings as primary mission outcomes; those belong to mission `16`.
- Reconstruct daemon-wide airport layout truth, gate binding, focus policy, panel identity, or substrate reconciliation as primary mission outcomes; those belong to mission `5`.
- Model every provider-native slash command, prompt form, transcript format, or tool protocol detail in the core runtime contract.
- Preserve split-era runtime names or compatibility bridges just because some current files still carry legacy terminology.