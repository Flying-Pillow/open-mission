---
title: "PRD: #16 - Reconstruct workflow engine and repository workflow settings"
artifact: "prd"
createdAt: "2026-04-10T20:37:14.000Z"
updatedAt: "2026-04-10T20:43:00.000Z"
stage: "prd"
---

Branch: mission/16-reconstruct-workflow-engine-and-repository-workf

## Outcome

- Establish one coherent workflow-runtime and repository-policy model in which `mission.json` is the authoritative mission-local workflow document and `.mission/settings.json` is the daemon-owned repository policy source.
- Preserve the reducer-driven event model, deterministic task generation, launch and pause behavior, restart semantics, and the `draft` to `ready` snapshot boundary as one architectural step rather than as disconnected implementation details.
- Convert the existing workflow-engine, repository-workflow-settings, and checklist specifications into a replayed mission artifact trail without collapsing semantic-model, agent-runtime, or airport-control-plane ownership into mission `16`.

## Problem Statement

- The workflow engine and repository workflow settings architecture already exist in the repository, but the historical mission that established them is not yet represented as a first-class Mission dossier backed by a real issue intake anchor.
- The current source corpus spreads the workflow-runtime contract across `workflow-engine.md`, `repository-workflow-settings.md`, the workflow checklist, and the repository workflow settings plan, which makes it easy for later replay work to lose the authoritative ownership boundary between mission-local runtime truth and daemon-owned repository policy.
- Without a reconstructed PRD for this mission, the repository lacks a durable product statement for the architectural step that replaced stage-driven heuristics with reducer-owned runtime state and replaced surface-owned settings edits with a daemon-owned workflow settings contract.

## Success Criteria

- The replayed mission preserves the primary content of `specifications/mission/workflow/workflow-engine.md`.
- The replayed mission preserves the primary content of `specifications/mission/configuration/repository-workflow-settings.md`.
- The replayed mission preserves the workflow-engine implementation contract documented in `specifications/checklists/workflow-engine-checklist.md` as supporting checklist material.
- The resulting replay artifacts preserve `mission.json` as mission-local workflow truth and keep reducer-owned events as the only source of workflow state mutation.
- The resulting replay artifacts preserve deterministic task generation from the workflow snapshot plus stage identity.
- The resulting replay artifacts preserve daemon-only authority over repository workflow settings initialization, validation, update, revision checks, and persistence.
- The resulting replay artifacts preserve the `draft` to `ready` snapshot boundary and the rule that repository workflow settings affect `draft` missions only.
- Any semantic material borrowed from mission-model, agent-runtime, or airport-control-plane sources is represented only as explicit secondary coverage and stays aligned with the retrospective specification coverage map.
- No substantive workflow-engine or repository-workflow-settings requirement is silently dropped; if some content belongs primarily to mission `15`, `4`, or `5`, that split remains explicit and architecture-aligned.

## Constraints

- Do not collapse semantic-model ownership from mission `15` into this workflow-engine mission.
- Do not collapse provider-neutral agent-runtime ownership from mission `4` into this workflow-engine mission.
- Do not collapse daemon-wide airport control-plane ownership from mission `5` into this workflow-engine mission.
- Do not treat repository workflow settings as a surface-owned file-editing feature; daemon authority is mandatory.
- Do not preserve legacy stage-driven runtime behavior, imperative gate checks, or filesystem-reconstructed workflow truth where the current workflow specification has already replaced them.
- Do not widen mission `16` to absorb forward omission-remediation work that is already tracked separately unless the replayed source material itself makes that work part of this mission.

## Non-Goals

- Reconstruct the semantic object-model naming system as a primary mission outcome; that belongs to mission `15`.
- Reconstruct provider-neutral session orchestration as a primary mission outcome; that belongs to mission `4`.
- Reconstruct daemon-wide airport layout, gate binding, panel, focus, or substrate authority; that belongs to mission `5`.
- Re-open repository-adoption path decisions already preserved by mission `11`, except where mission `16` must reference first-mission bootstrap and repository settings materialization boundaries narrowly.
- Treat issue `#12` or issue `#13` as replay-owned implementation backlog by default; they remain forward omissions unless the workflow-engine source material itself requires their concepts for this mission's preserved contract.
