---
issueId: 12
title: "Implement deterministic implementation-task generation from planned task definitions"
type: "feature"
labels: ["enhancement"]
branchRef: "mission/12-implement-deterministic-implementation-task-gene"
createdAt: "2026-04-14T15:38:29.856Z"
updatedAt: "2026-04-14T15:38:29.856Z"
url: "https://github.com/Flying-Pillow/mission/issues/12"
---

Issue: #12

## Summary

Retrospective replay uncovered a workflow omission around implementation planning.

The workflow model exposes `taskGeneration[].tasks`, and settings normalization preserves it, but the current task generator only consumes `templateSources`. As a result, there is no verified deterministic path from the SPEC planning task to runtime implementation tasks in `mission.json`.

## Problem

Mission status, Tower projections, and available workflow actions are driven from runtime tasks persisted in `mission.json`, not by scanning `03-IMPLEMENTATION/tasks` from disk.

That means an agent can plausibly create implementation task files, but Mission will not necessarily treat them as authoritative workflow tasks unless they are also instantiated through a deterministic runtime-generation path.

## Expected Outcome

Mission should support deterministic implementation-task generation from planned task definitions so that:

1. the planning stage can produce an execution ledger that is machine-readable
2. implementation and verification tasks become runtime tasks through a deterministic workflow path
3. the `verify-` pairing behavior described in docs is represented in runtime, not just in prose
4. retrospective replay does not need to invent runtime behavior to continue past `spec/02-plan`

## Evidence

- `WorkflowTaskGenerationRule` includes a `tasks` field.
- workflow settings normalization preserves `taskGeneration[].tasks`.
- the current generator only renders `templateSources`.
- the workflow checklist requires deterministic task generation from the workflow snapshot plus `stageId`.
- docs describe implementation as paired with generated verification tasks.

## Constraints

- Keep runtime tasks in `mission.json` authoritative.
- Do not rely on free-form agent behavior as the source of truth.
- Preserve deterministic generation from workflow snapshot plus stage id.
- Keep implementation-verification pairing explicit and replayable.

## Notes

This was discovered while replaying issue #11 in emulation mode. The omission should be fixed in Mission itself, but replay should still be able to record the omission as an issue and continue by emulating the intended task inventory when the current SPEC is clear enough.
