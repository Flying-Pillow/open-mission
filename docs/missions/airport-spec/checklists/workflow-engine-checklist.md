---
layout: default
title: Workflow Engine Checklist
parent: Airport Spec Mission
grand_parent: Missions
nav_order: 9
---

# Workflow Engine Checklist

This checklist translates the workflow engine specification into implementation work.

It is normative implementation guidance and part of the implementation contract for operational details that the specification keeps concise.

It is intentionally narrow.

Use it to sequence delivery without expanding the spec.

## Subagent Usage Rule

- Use subagents only for bounded read-only exploration work.
- Good subagent tasks: locating legacy workflow semantics, mapping impacted files, inventorying event consumers, finding command/UI touchpoints, and identifying legacy tests to replace.
- Keep runtime model design, reducer behavior, refactors, code edits, and validation in the main agent.
- Do not delegate architectural decisions or cross-file implementation sequencing to subagents.

## 1. Runtime Model

- Define the new mission workflow runtime document shape in code.
- Add the new mission lifecycle, task lifecycle, session lifecycle, and derived stage state types.
- Update the `tasks.generated` event shape to carry full generated task payloads.
- Add the `mission.delivered` and `session.launch-failed` event types.
- Keep `mission.json` as the sole authoritative runtime record.

## 2. Event Ingestion

- Implement `eventId` deduplication against the persisted mission event log.
- Implement pre-reduction validation for unknown references and invalid prior-state transitions.
- Ensure invalid events are rejected and never appended to the event log.
- Persist accepted event log entries and resulting runtime state in one authoritative write.

## 3. Reducer

- Implement a pure reducer over `current state + event + configuration snapshot`.
- Ensure the reducer returns fully normalized persisted state.
- Recompute dependency blockers, task readiness, launch queue normalization, stage projections, gate projections, and mission completion inside reduction.
- Enforce the compact transition rules for mission, task, and session events.
- Enforce stage eligibility from `stageOrder`.
- Enforce reopen cascade rules and reject reopen attempts that would conflict with active downstream work.

## 4. Task Generation

- Implement `tasks.request-generation` request emission when the current eligible stage has no task runtime records.
- Implement deterministic task generation from the workflow snapshot plus `stageId`.
- Copy rendered task title and instruction content into runtime task records at generation time.
- Make repeated `tasks.generated` idempotent.
- Reject repeated `tasks.generated` events that reuse an existing `taskId` with a different payload.

## 5. Launch Queue And Scheduling

- Ensure queueing a task updates task lifecycle and `launchQueue` in the same reduce cycle.
- Remove launch requests only on `session.started`, `session.launch-failed`, panic queue clearing, or explicit cancellation behavior.
- Count concurrency using queued or running tasks and starting or running sessions.
- Implement deterministic auto-queue ordering: stage order first, then lexical `taskId` order.
- Allow manual queueing for manual-launch tasks while preventing automatic queueing for them.

## 6. Request Executor

- Implement request execution outside the reducer.
- Support `tasks.request-generation`, `session.launch`, `session.prompt`, `session.command`, `session.terminate`, `session.cancel`, `mission.pause`, and `mission.mark-completed`.
- Emit normal workflow events back into the engine as request outcomes.
- Treat `mission.mark-completed` as notification only, not state mutation.
- Emit `session.launch-failed` when launch fails before any session is created.
- Route `session.prompt` to the shared runtime session prompt path rather than a workflow-only adapter side channel.
- Route `session.command` to the shared runtime session command path while keeping `session.cancel` and `session.terminate` as explicit lifecycle requests.

## 7. Reconciliation

- Reload persisted runtime on daemon startup.
- Reconcile external runner facts by emitting normal workflow events only.
- Do not mutate persisted runtime state directly during reconciliation.
- Emit terminal session events when the external runner reports a terminal outcome.
- Emit `session.launch-failed` when a persisted launch request never produced a session and the runner reports launch failure.

## 8. Commands And UI Surface

- Expose mission pause, resume, panic, and clear-panic actions.
- Expose task done, blocked, reopen, autostart toggle, and manual start actions.
- Remove or rewrite commands centered on stage runtime control.
- Drive command availability from the same workflow rules used by reducer validation.
- Ensure any daemon-exposed MCP tools translate agent intents into normal workflow events rather than direct workflow state mutation.

## 9. Tests

- Add reducer tests for each accepted mission, task, and session transition.
- Add rejection tests for invalid events and stale prior-state transitions.
- Add tests for deterministic stage eligibility and reopen cascade behavior.
- Add tests for task generation idempotency and payload mismatch rejection.
- Add tests for queue normalization and concurrency caps.
- Add tests for launch failure before session creation.
- Add tests for reconciliation after restart.
- Remove or rewrite tests that encode the legacy stage runtime model or autopilot semantics.

## 10. Legacy Replacement

- Delete or replace legacy modules that encode stage-driven runtime behavior.
- Remove filesystem reconstruction logic that tries to rebuild workflow truth from task files.
- Remove imperative gate-check code that bypasses the reducer.
- Remove daemon-side progression loops that mutate workflow state outside the event pipeline.
- Keep only neutral infrastructure that does not own workflow semantics.