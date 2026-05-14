---
issueId: 18
title: "Reconstruct airport control plane"
type: "task"
branchRef: "mission/18-reconstruct-airport-control-plane"
createdAt: "2026-04-10T21:32:50.000Z"
url: "https://github.com/Flying-Pillow/mission/issues/18"
---

Issue: #18

## Goal

Reconstruct the major historical mission that established Mission's daemon-wide airport control plane, shared state root, and terminal substrate reconciliation model.

This is a retrospective reconstruction issue. The architecture and specifications already exist in the repository today. The purpose of this issue is to create the real GitHub intake anchor that a Mission start flow would have used, so Mission can dogfood its own issue-backed intake model while rebuilding its development history.

## Scope

This mission covers the airport-control-plane outcome, including:

- preserving one daemon-owned composite application state rooted in `MissionSystemState`
- preserving the bounded-context split where `MissionControl` owns semantic mission truth and `AirportControl` owns layout, gate binding, focus intent, panel identity, and substrate reconciliation
- preserving the bootstrap handoff where Tower entry may open Airport but Airport becomes the authoritative layout controller once panels connect
- preserving airport gate bindings, control-plane projections, repository-aware airport identity, and reconciliation of intended versus observed substrate state
- preserving terminal-manager ownership strictly as an airport-controlled substrate adapter rather than as application truth
- preserving the clean break from panel-owned routing, shell-loop layout control, direct panel-to-panel coordination, and direct panel-to-terminal-manager control

## Expected Outcome

Mission should have one coherent airport-control-plane model with:

1. one authoritative daemon-owned application controller split between `MissionControl` and `AirportControl`
2. one explicit composite state root that keeps semantic mission truth separate from airport layout truth
3. one projection-oriented control surface where panels subscribe to daemon-owned state instead of coordinating each other directly
4. one reconciliation loop that applies airport intent to the terminal substrate and reconciles observed focus and pane state back into daemon truth
5. one replayed specification trail that preserves the substantive content of the airport-control-plane source specification without collapsing semantic-model, workflow, or agent-runtime ownership into mission `18`

## Acceptance Criteria

- The replayed mission preserves the primary content of `specifications/airport/airport-control-plane.md`.
- The resulting replay artifacts preserve the bounded-context split where `MissionControl` owns mission semantics and `AirportControl` owns application layout truth.
- The resulting replay artifacts preserve daemon-only authority over gate binding, focus intent, panel registration, airport layout truth, and substrate reconciliation.
- The resulting replay artifacts preserve the bootstrap handoff boundary where Tower entry initializes Airport, but Airport becomes authoritative after panel connection.
- The resulting replay artifacts preserve terminal-manager as a reconciled substrate under airport ownership rather than as a source of semantic truth or routing identity.
- Any semantic-model, workflow-engine, or agent-runtime material referenced by this mission is preserved only as explicit secondary coverage aligned with the retrospective specification coverage map.
- No substantive airport-control-plane requirement is silently dropped; any split across missions `15`, `16`, or `17` remains explicit and architecture-aligned.

## Constraints

- Do not collapse semantic-model ownership from mission `15` into this airport-control-plane mission.
- Do not collapse workflow-runtime ownership from mission `16` into this airport-control-plane mission.
- Do not collapse provider-neutral agent-runtime ownership from mission `17` into this airport-control-plane mission.
- Do not preserve direct panel-to-panel coordination, direct panel-to-terminal-manager control, shell-script layout authority, or focus-as-control-state behavior as long-term architecture.
- Do not preserve compatibility shims for the legacy CLI tower process model, sidepane shell loop, terminal routing contracts, or daemon socket assumptions that the airport-control-plane specification explicitly replaces.
- Do not widen this mission to absorb forward-looking airport ideas unless they are supported by the replayed source material.

## Source Material

This reconstructed mission is derived from:

- `specifications/airport/airport-control-plane.md`
- `specifications/plans/retrospective-specification-coverage-map.md`
- `specifications/plans/retrospective-replay-workflow.md`
- `specifications/plans/retrospective-experience.md`

Secondary reference material may be used where needed to preserve airport boundaries coherently:

- `specifications/mission/model/core-object-model.md`
- `specifications/mission/model/mission-model.md`
- `specifications/mission/workflow/workflow-engine.md`
- `specifications/mission/execution/agent-runtime.md`

## Notes

This issue is intended to become the intake anchor for a manually scaffolded retrospective mission dossier. The replay should preserve the daemon-wide control-plane corpus in the correct mission context while keeping semantic-model, workflow-runtime, and agent-runtime ownership explicit and separate.