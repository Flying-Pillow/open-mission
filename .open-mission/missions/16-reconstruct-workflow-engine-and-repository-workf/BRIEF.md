---
issueId: 16
title: "Reconstruct workflow engine and repository workflow settings"
type: "task"
branchRef: "mission/16-reconstruct-workflow-engine-and-repository-workf"
createdAt: "2026-04-10T20:37:14.000Z"
url: "https://github.com/Flying-Pillow/mission/issues/16"
---

Issue: #16

## Goal

Reconstruct the major historical mission that established Mission's reducer-driven workflow engine and the daemon-owned repository workflow settings contract.

This is a retrospective reconstruction issue. The architecture and specifications already exist in the repository today. The purpose of this issue is to create the real GitHub intake anchor that a Mission start flow would have used, so Mission can dogfood its own issue-backed intake model while rebuilding its development history.

## Scope

This mission covers the workflow-engine and repository-workflow-settings outcome, including:

- preserving `mission.json` as the authoritative mission-local workflow runtime document
- preserving the reducer-owned event model, task runtime, stage projections, gate projections, launch queue, and pause behavior defined by the workflow engine specification
- preserving deterministic task-generation and replay-valid runtime semantics as the workflow-engine contract
- preserving the daemon-owned repository workflow settings boundary for initialization, validation, patching, persistence, revision checks, and update events
- preserving the `draft` to `ready` workflow-snapshot capture boundary so repository workflow settings seed new missions without mutating existing started missions
- preserving the clean separation between mission-local workflow truth, daemon-owned repository policy, provider-neutral agent runtime, and daemon-wide airport control-plane state

## Expected Outcome

Mission should have one coherent workflow-runtime and repository-policy model with:

1. one authoritative reducer-driven mission runtime document in `mission.json`
2. one explicit event and request model for workflow state transitions and requested effects
3. deterministic task generation and replay-valid runtime projections derived from the workflow snapshot
4. one daemon-owned repository workflow settings contract with RFC 6902 patch updates, revision protection, and atomic persistence
5. one snapshot boundary where repository workflow settings are captured exactly when a mission transitions from `draft` to `ready`
6. a replayed specification trail that preserves the substantive content of the workflow-engine, repository-workflow-settings, and workflow-engine-checklist source material without collapsing later replay-mission ownership into mission `16`

## Acceptance Criteria

- The replayed mission preserves the primary content of `specifications/mission/workflow/workflow-engine.md`.
- The replayed mission preserves the primary content of `specifications/mission/configuration/repository-workflow-settings.md`.
- The replayed mission preserves the workflow-engine implementation contract documented in `specifications/checklists/workflow-engine-checklist.md` as supporting checklist material.
- The resulting replay artifacts preserve `mission.json` as mission-local workflow truth and keep reducer-owned events as the only source of workflow state mutation.
- The resulting replay artifacts preserve deterministic task generation from the workflow snapshot plus stage identity.
- The resulting replay artifacts preserve daemon-only authority over repository workflow settings initialization, validation, update, revision checks, and persistence.
- The resulting replay artifacts preserve the `draft` to `ready` snapshot boundary and the rule that repository workflow settings affect `draft` missions only.
- Any semantic-model, agent-runtime, or airport-control-plane material referenced by this mission is preserved only as explicit secondary coverage aligned with the retrospective specification coverage map.
- No substantive workflow-engine or repository-workflow-settings requirement is silently dropped; any split across missions `15`, `4`, or `5` remains explicit and architecture-aligned.

## Constraints

- Do not collapse semantic-model ownership from mission `15` into this workflow-engine mission.
- Do not collapse provider-neutral agent-runtime ownership from mission `4` into this workflow-engine mission.
- Do not collapse daemon-wide airport control-plane ownership from mission `5` into this workflow-engine mission.
- Do not treat repository workflow settings as a surface-owned file-editing feature; daemon authority is mandatory.
- Do not preserve legacy stage-driven runtime behavior, imperative gate checks, or filesystem-reconstructed workflow truth where the current workflow specification has already replaced them.
- Do not widen this mission to absorb omission-remediation work that belongs to separately tracked forward issues unless the replayed source material itself makes that work part of this mission.

## Source Material

This reconstructed mission is derived from:

- `specifications/mission/workflow/workflow-engine.md`
- `specifications/mission/configuration/repository-workflow-settings.md`
- `specifications/checklists/workflow-engine-checklist.md`
- `specifications/plans/repository-workflow-settings-plan.md`
- `specifications/plans/retrospective-specification-coverage-map.md`
- `specifications/plans/retrospective-replay-workflow.md`
- `specifications/plans/retrospective-experience.md`

Secondary reference material may be used where needed to preserve workflow boundaries coherently:

- `specifications/mission/model/mission-model.md`
- `specifications/mission/model/core-object-model.md`
- `specifications/mission/execution/agent-runtime.md`
- `specifications/airport/airport-control-plane.md`

## Notes

This issue is intended to become the intake anchor for a manually scaffolded retrospective mission dossier. The replay should preserve the workflow-runtime and repository-policy corpus in the correct mission context, while keeping known omission issues and later replay-mission ownership outside this mission's implementation ledger unless the source material explicitly requires otherwise.
