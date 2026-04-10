---
title: "VERIFY: #16 - Reconstruct workflow engine and repository workflow settings"
artifact: "verify"
createdAt: "2026-04-10T20:37:14.000Z"
updatedAt: "2026-04-10T21:17:00.000Z"
stage: "implementation"
---

Branch: mission/16-reconstruct-workflow-engine-and-repository-workf

## Unit Test Evidence

- Slice 1, workflow runtime document and reducer boundary:
  - `pnpm exec vitest run packages/core/src/workflow/engine/reducer.test.ts`
  - The focused reducer test verifies that `activeStageId` remains reducer-owned as work advances from `prd` to `spec`.
  - The same suite verifies that mission pause state preserves target metadata in runtime state and that empty non-terminal stages remain blocked rather than auto-completing.
- Slice 2, deterministic task generation and scheduling:
  - `pnpm exec vitest run packages/core/src/workflow/engine/reducer.test.ts`
  - The reducer suite verifies final delivery auto-completion after audit completion and keeps stage advancement or delivery gating tied to reducer-owned state transitions.
  - Replay for mission `16` uses explicit emulation mode only for the implementation-stage task ledger because issue `#12` still records the current omission in deterministic planned-task ingestion. The emulated task files and the `tasks.generated` runtime event agree on the same bounded inventory.
- Slice 3, daemon-owned workflow settings and snapshot timing:
  - `pnpm exec vitest run packages/core/src/settings/jsonPatch.test.ts packages/core/src/settings/validation.test.ts packages/core/src/settings/revision.test.ts packages/core/src/settings/WorkflowSettingsStore.test.ts packages/core/src/daemon/MissionWorkflowSnapshot.test.ts`
  - The settings tests verify RFC 6902 patch allow-list behavior, semantic validation failures, revision-token stability, revision-token changes on content changes, repository settings initialization, and `SETTINGS_CONFLICT` after out-of-band edits.
  - The snapshot timing tests verify that `draft` missions remain linked to repository workflow settings until workflow start and that started missions remain isolated from later repository workflow edits.
- Slice 4, workflow specs, control consumers, and focused tests:
  - `packages/core/src/client/DaemonControlApi.ts` and `packages/core/src/client/DaemonClient.ts` expose dedicated `control.workflow.settings.*` methods rather than collapsing workflow policy edits into scalar settings updates.
  - The preserved workflow-engine and repository-workflow-settings sources now align with the reducer tests, settings-store tests, and snapshot-timing tests that express mission `16`'s architectural contract.

## Gaps

- The workflow-runtime replay boundary is complete for mission `16`.
- Residual gaps are limited to separately tracked product omissions and later replay missions that own semantic-model naming, provider-neutral agent-runtime orchestration, or daemon-wide airport control-plane authority.
