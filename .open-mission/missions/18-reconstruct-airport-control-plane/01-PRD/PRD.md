---
title: "PRD: #18 - Reconstruct airport control plane"
artifact: "prd"
createdAt: "2026-04-10T21:32:50.000Z"
updatedAt: "2026-04-10T21:49:40.000Z"
stage: "prd"
---

Branch: mission/18-reconstruct-airport-control-plane

## Outcome

- Establish one coherent daemon-owned airport control plane in which airport layout truth, gate bindings, panel registration, focus intent, repository-scoped airport identity, and terminal substrate reconciliation all have one architectural owner.
- Preserve the bounded-context split in which semantic mission truth stays in core while airport owns application layout truth and projects that truth to panels through daemon-managed snapshots and updates.
- Convert the airport control plane specification into a replayed mission artifact trail without collapsing semantic-model, workflow-runtime, or agent-runtime ownership into mission `18`.

## Problem Statement

- Mission has crossed the point where terminal layout can be treated as shell choreography, pane-title heuristics, or panel-local coordination. The application now spans multiple repositories, missions, tasks, artifacts, and agent sessions, so layout, focus, routing, and substrate state must be owned by one daemon-side controller rather than by distributed surface behavior.
- Without a reconstructed PRD for this mission, the repository lacks a durable product statement for the architectural step that made Airport the application orchestrator for the whole multi-repository, multi-mission runtime instead of a thin terminal wrapper around Tower commands.
- The source specification is stronger than parts of the current implementation. Current airport code already models repository scoping, gate bindings, client registration, and focus intent versus observed focus, but the spec still calls for a stricter reconciliation architecture than any ad hoc layout bootstrap or substrate-title mapping should be allowed to imply.

## Success Criteria

- The replayed mission preserves the primary content of `specifications/airport/airport-control-plane.md` as the authoritative product outcome for daemon-wide layout control, gate bindings, projections, and substrate reconciliation.
- The resulting replay artifacts preserve the rule that Airport is the application orchestrator for the active repository and mission context, while `MissionControl` remains the owner of semantic repository, mission, task, artifact, and agent-session truth.
- The resulting replay artifacts preserve the bootstrap handoff boundary: entry code may start Airport, but once panels connect, Airport owns gate bindings, focus intent, substrate effect application, and projection broadcasting.
- The resulting replay artifacts preserve the distinction between selection, binding, focus intent, observed focus, and substrate existence so focus bugs and routing bugs cannot hide behind conflated state.
- The resulting replay artifacts preserve terminal-manager as a reconciled substrate under airport ownership rather than as a source of canonical application truth, routing identity, or cross-panel coordination.
- Any semantic-model, workflow-runtime, or agent-runtime material referenced by this mission is represented only as explicit secondary coverage aligned with the retrospective specification coverage map.
- No substantive airport-control-plane requirement is silently dropped; if a behavior is only partially realized in current code, the replay artifacts must state the intended ownership boundary rather than downgrade the mission to match incidental implementation shortcuts.

## Constraints

- Do not collapse semantic-model ownership from mission `15`, workflow-runtime ownership from mission `16`, or provider-neutral agent-runtime ownership from mission `17` into this mission.
- Do not preserve shell-script routing, file-signaling loops, pane-title identity, panel-to-panel coordination, panel-owned focus policy, or direct panel-to-terminal-manager control as long-term architecture.
- Do not add fallbacks, aliases, compatibility wrappers, or legacy naming just because earlier control-plane code used them. This mission is a clean-break architectural reconstruction.
- Do not treat terminal-manager pane ids, pane titles, or transient focus state as canonical application identities.
- Do not widen the mission to absorb speculative future airport behavior unless it is supported by the airport specification or by explicit secondary-source evidence needed to preserve architectural boundaries coherently.

## Non-Goals

- Reconstruct semantic mission repository records, workflow reducer semantics, or provider-neutral session orchestration as primary outcomes; those belong to missions `15`, `16`, and `17`.
- Preserve compatibility with the old CLI tower process model, sidepane shell loop, legacy terminal routing contracts, or older daemon socket assumptions that the airport specification explicitly invalidates.
- Model every editor-specific automation detail, every terminal-manager layout syntax detail, or every transport-framing detail as part of the core airport contract.
- Accept current implementation shortcuts as the architectural target when the specification requires a stricter ownership boundary.