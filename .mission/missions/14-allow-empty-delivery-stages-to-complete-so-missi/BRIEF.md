---
issueId: 14
title: "Allow empty delivery stages to complete so mission.delivered is reachable"
type: "fix"
labels: ["bug"]
branchRef: "mission/14-allow-empty-delivery-stages-to-complete-so-missi"
createdAt: "2026-04-14T02:03:23.551Z"
updatedAt: "2026-04-14T02:03:23.551Z"
url: "https://github.com/Flying-Pillow/mission/issues/14"
---

Issue: #14

## Summary

Retrospective replay uncovered a delivery-stage workflow defect.

After `audit/02-touchdown` completes, the audit stage passes, but the workflow still leaves the `delivery` stage blocked when that stage has no runtime tasks. As a result, `mission.delivered` never becomes validator-acceptable even though the mission has reached its final documented artifact boundary.

## Problem

The workflow reducer currently determines stage completion from the presence of stage tasks and whether they are all completed. For the `delivery` stage, the default workflow defines no task templates and replay generation can legitimately produce an empty `tasks.generated` result.

That leaves the final stage in a blocked state with:

1. no delivery tasks to execute
2. no ready work remaining after `touchdown`
3. no valid path to lifecycle `completed`
4. validation rejecting `mission.delivered` because runtime lifecycle never advances past `running`

## Expected Outcome

Mission should provide a coherent completion path for empty delivery stages so that final delivery is reachable without inventing non-existent tasks.

Acceptable behaviors could include:

- treat an empty generated delivery stage as completed
- allow empty terminal stages to satisfy mission completion when all earlier stages are completed
- explicitly model final delivery as a zero-task stage that can pass its gate deterministically

## Evidence

- `defaultWorkflow.ts` defines a `delivery` stage but no delivery task templates.
- `reducer.ts` stage projection logic only marks a stage completed when it has at least one task and all stage tasks are completed.
- `reducer.ts` eligible-stage resolution falls through to the final stage even when that stage has zero tasks.
- `validation.ts` requires runtime lifecycle `completed` before accepting `mission.delivered`.
- Replay of issue #11 reached a reducer-valid audit-complete boundary but could not advance to a valid delivered terminal state.

## Constraints

- keep workflow progression deterministic
- preserve reducer and validation coherence
- do not invent synthetic delivery tasks just to satisfy stage completion
- keep replay and live workflow semantics aligned

## Notes

This was discovered while replaying issue #11. The replay recorded the defect and stopped at the last truthful reducer-valid boundary after `touchdown`, but the defect should be fixed in Mission itself through a separate forward issue.
