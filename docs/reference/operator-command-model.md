---
layout: default
title: Operator Command Model
parent: Reference
nav_order: 4
---

# Operator Command Model

This page defines the intended operator command model for Mission.
The operator needs to understand:

- when a command is available
- what context should surface it
- which parts of the model change
- what does not change

Mission stays coherent only if commands respect the semantic layers of the system.

## Protocol Rules

These rules close the command contract under retries, invalid input, and asynchronous side effects.

1. Every accepted command must result in one or more domain or airport events, and only those events may change authoritative state through the relevant reducer. Command handlers must not mutate state directly.
2. Commands must be idempotent or carry a client-generated `requestId` so duplicate submissions can be ignored or coalesced safely.
3. Invalid commands must not mutate state. They must return an explicit error response and must not be translated into workflow or airport events.
4. Commands are routed to exactly one authority boundary: mission-domain authority or Airport authority. Cross-boundary consequences must happen through emitted events and reconciliation, not direct mutation across both boundaries in one handler.
5. A command is considered accepted when Mission validates it and converts it into authoritative state changes and/or side-effect requests. Completion of asynchronous side effects is reported later through emitted events, not through the command response itself.
6. Observations are facts, not commands. When an observation conflicts with prior intent for the same observed field, the observed state wins. Intent may be asserted again only through a new command, not by replaying stale intent.

When the command cards below describe model changes, they describe the authoritative state after those accepted commands have been translated into events and reduced.

## Command Ownership

Mission uses five user-visible layers, but not all of them own commands.

### Mission

Mission owns governance and recovery commands.

### Stage

Stage owns no commands.

Stages are structural and derived. They explain where the mission is, but they do not execute work and they do not mutate workflow state directly.

The earlier idea that a stage could "generate tasks" as a stage command is not the right model. In the implementation flow, task creation is the consequence of upstream work, especially the planning work in the `spec` stage, not an operator command attached to the stage itself.

### Task

Task is the primary steering unit.

This is where the operator starts work, launches execution, marks outcomes, reopens work, and adjusts launch policy.

### Artifact

Artifact owns no commands.

Artifacts are evidence and context. When the operator focuses an artifact, the artifact should open because of selection and routing behavior, not because "open artifact" exists as a command. Any relevant commands should already be present because the owning task is in context.

### Session

Session owns only live execution controls.

Launching is not a session command. Launch belongs to the task. Reattach and runner reassignment are out of scope for the current command model.

## Status Model Reference

The command cards below refer to these workflow state families.

### Mission lifecycle

- `draft`
- `ready`
- `running`
- `paused`
- `panicked`
- `completed`
- `delivered`

### Task lifecycle

- `pending`
- `ready`
- `queued`
- `running`
- `blocked`
- `completed`
- `failed`
- `cancelled`

### Session lifecycle

- `starting`
- `running`
- `completed`
- `failed`
- `cancelled`
- `terminated`

### Stage lifecycle

Stage state is derived. It is not directly commanded.

- `pending`
- `ready`
- `active`
- `blocked`
- `completed`

## Mission Commands

## `/mission pause`

Pause the whole mission for controlled review or pacing.

**Rules**

- Available only when mission lifecycle is `running`.
- This is governance, not emergency containment.
- The command is still relevant even when the operator currently has a task or session selected inside the mission.

**Context**

- Mission selection.
- Any lower-level selection inside the same mission when mission governance controls are surfaced.

**Model status changes**

- Mission lifecycle: `running -> paused`
- Mission pause state: `paused: false -> true`
- Mission pause reason: set to `human-requested`

**Model status that does not change directly**

- Task lifecycles do not directly change because of the pause event itself.
- Session lifecycles do not directly change because of the pause event itself.
- Stage lifecycles remain derived from task state.

**Result**

The mission stops progressing normally. New task queueing and launch behavior should no longer proceed until the mission is resumed.

## `/mission resume`

Resume a paused mission.

**Rules**

- Available only when mission lifecycle is `paused`.
- Not available while panic is active.

**Context**

- Mission selection.
- Any lower-level selection inside a paused mission when recovery controls are surfaced.

**Model status changes**

- Mission lifecycle: `paused -> running`
- Mission pause state: reset to `paused: false`

**Model status that does not change directly**

- No task is auto-completed.
- No terminated or cancelled session is restarted by this command.
- Stage state remains derived from task state.

**Result**

Normal workflow progression and scheduling become possible again.

## `/mission panic`

Emergency stop for the whole mission.

**Rules**

- Available once the mission has started.
- Not available when mission lifecycle is `draft` or `delivered`.
- Not available when panic is already active.

**Context**

- Mission selection.
- Any task or session selection inside the mission when emergency containment must take priority.

**Model status changes**

- Mission lifecycle: `running|paused|completed -> panicked`
- Mission pause state: forced to `paused: true`
- Mission pause reason: forced to `panic`
- Panic state: `active: false -> true`
- Launch queue: cleared when panic policy says to clear queued launches
- Queued tasks: queued tasks moved back to `ready` when queue clearing happens

**Model status that may change as a consequence**

- Active sessions may later become `terminated` through panic side effects.
- Their tasks may later become `cancelled` through those session lifecycle events.

**Result**

The mission enters durable emergency containment. This is the hard stop.

## `/mission clear-panic`

Clear the panic latch after emergency containment.

**Rules**

- Available only when panic is active and mission lifecycle is `panicked`.
- Clearing panic must not silently resume work.

**Context**

- Mission selection.
- Any lower-level selection inside a panicked mission.

**Model status changes**

- Mission lifecycle: `panicked -> paused`
- Panic state: `active: true -> false`
- Mission pause state remains `paused: true`

**Model status that does not change directly**

- Tasks do not restart.
- Sessions do not relaunch.
- Stage state remains derived.

**Result**

The mission leaves panic state but remains paused so the operator must make an explicit recovery decision.

## `/mission deliver`

Close the mission with a delivery decision.

**Rules**

- Available only when mission lifecycle is `completed`.
- Delivery should only happen when no unresolved active work remains and delivery conditions are satisfied.

**Context**

- Mission selection near the end of the workflow.

**Model status changes**

- Mission lifecycle: `completed -> delivered`

**Model status that does not change directly**

- Task lifecycles are not rewritten by delivery.
- Session history is not rewritten by delivery.
- Stage state remains derived from the already-finished task ledger.

**Result**

The mission moves into its terminal delivered state.

## Stage Commands

There are no stage commands in the intended model.

That is a product rule, not just a temporary omission.

### Why

- Stages are derived from task state.
- A stage does not execute work.
- The spec-stage planning task creates the conditions for implementation work; the stage itself does not own a separate "generate tasks" command.
- Focusing a stage artifact is selection behavior, not a command.

### Model implication

No command should directly mutate stage lifecycle.

If a stage becomes `ready`, `active`, `blocked`, or `completed`, that change is the result of mission and task state transitions elsewhere in the model.

## Task Commands

Task commands are the main operator steering surface.

## `/task start`

Move a ready task into execution.

**Rules**

- Available only when task lifecycle is `ready`.
- Dependencies must already be satisfied.
- Not available while mission lifecycle is `paused` or `panicked`.

**Context**

- Task selected.

**Model status changes**

- Task lifecycle first enters `queued`
- Task lifecycle then enters `running` when task execution actually starts

**Derived model effects**

- Stage state may move toward `active` because a task in that stage is now running.
- Launch queue and scheduling state may normalize in the same reduce cycle.

**Result**

The workflow begins active execution for that task.

## `/launch`

Launch a live session for the selected task.

**Rules**

- Available only when task lifecycle is `ready`, `queued`, or `running`.
- Not available if the task already has an active session.
- Not available while mission lifecycle is `paused` or `panicked`.
- Runner availability must be satisfied.

**Context**

- Task selected.

**Model status changes**

- Session lifecycle: new session record created as `running`
- Task lifecycle: forced or preserved as `running`

**Model status that may change on failure**

- If launch fails before a session is created, task lifecycle becomes `failed`.

**Result**

The task gains a live execution session.

## `/task done`

Accept the task outcome as complete.

**Rules**

- Available only when the task is in a state that validation accepts for completion.
- In the current workflow rules this means task lifecycle must be `ready` or `running` at the moment of completion.
- The operator should use this only when the task outcome is actually complete and reviewable.

**Context**

- Task selected.

**Model status changes**

- Task lifecycle: `ready|running -> completed`
- Task `completedAt`: set

**Derived model effects**

- Downstream dependency blockers may clear.
- Stage state may advance toward `completed` when all stage tasks are complete.
- Mission lifecycle may later advance to `completed` when all workflow completion conditions are satisfied.

**Result**

The workflow accepts the task as finished and uses that fact to recompute downstream readiness.

**Result**

The workflow records a durable blocked condition instead of pretending the task is still healthy progress.

## `/task reopen`

Reopen previously finished or aborted work.

**Rules**

- Available only when task lifecycle is `completed`, `failed`, or `cancelled`.
- Not allowed while any transitive dependent work is still active.

**Context**

- Task selected, usually after review, regression discovery, or invalidated assumptions.

**Model status changes**

- Task lifecycle: `completed|failed|cancelled -> pending`
- Task terminal timestamps such as `completedAt`, `failedAt`, and `cancelledAt`: cleared for the reopened task

**Derived model effects**

- Dependency blockers and stage projections are recomputed.
- Transitive dependent task progress may be invalidated by recomputation.

**Result**

The task becomes active workflow work again instead of preserved historical completion.

## `/task autostart on`

Enable automatic start policy for the task.

**Rules**

- Available only when validation accepts a launch-policy change.
- Not intended for terminal tasks.

**Context**

- Task selected.

**Model status changes**

- Task runtime policy: `autostart: false -> true`

**Model status that does not change directly**

- Task lifecycle does not change just because autostart was toggled.
- Session lifecycle does not change directly.

**Result**

The scheduler may automatically queue or start this task later when it becomes eligible.

## `/task autostart off`

Disable automatic start policy for the task.

**Rules**

- Available only when validation accepts a launch-policy change.
- Not intended for terminal tasks.

**Context**

- Task selected.

**Model status changes**

- Task runtime policy: `autostart: true -> false`

**Model status that does not change directly**

- Task lifecycle does not change just because autostart was toggled.
- Session lifecycle does not change directly.

**Result**

The scheduler will no longer auto-start this task.

## `/task launch-mode manual`

Require explicit operator intent before launch.

**Rules**

- Available only when validation accepts a launch-policy change.
- Not intended for terminal tasks.

**Context**

- Task selected.

**Model status changes**

- Task runtime policy: `launchMode: automatic -> manual`

**Model status that does not change directly**

- Task lifecycle does not change directly.
- Session lifecycle does not change directly.

**Result**

The task remains under explicit operator launch control even when otherwise eligible.

## `/task launch-mode automatic`

Allow automatic launch behavior for the task.

**Rules**

- Available only when validation accepts a launch-policy change.
- Not intended for terminal tasks.

**Context**

- Task selected.

**Model status changes**

- Task runtime policy: `launchMode: manual -> automatic`

**Model status that does not change directly**

- Task lifecycle does not change directly.
- Session lifecycle does not change directly.

**Result**

The workflow may launch the task automatically when it is eligible and policy allows it.

## Artifact Commands

There are no artifact-owned commands in the intended model.

### Why

- Focusing an artifact is selection behavior.
- Artifacts are evidence, not workers.
- If task commands are relevant while an artifact is focused, they should be available because the owning task is already in context.

### Model implication

No artifact command should directly mutate mission, task, session, or stage lifecycle.

## Session Commands

Session commands are live execution controls only.

Launch is not a session command. Launch belongs to the task.

## Plain reply input

Send freeform operator input to the selected live session.

**Rules**

- Available only when a live session is selected or when the selected task has a promptable live session.
- This is operator text input, not a slash command.

**Context**

- Session selected.
- Task selected with a live session awaiting or accepting input.

**Model status changes**

- No direct mission lifecycle change.
- No direct task lifecycle change.
- No direct session lifecycle change.

**Result**

Operator text is delivered into the live session as runtime input.

## `/session cancel`

Request a cooperative stop for a live session.

**Rules**

- Available only when session lifecycle is active.
- In the current action builder this means `starting` or `running`.

**Context**

- Session selected.
- Task selected with an active session, when the session action is inherited into task context.

**Model status changes**

- Session lifecycle: `starting|running -> cancelled`
- Owning task lifecycle: `-> cancelled`
- Owning task `cancelledAt`: set

**Derived model effects**

- Stage and dependency projections are recomputed after the cancelled task state lands.

**Result**

The live session is stopped cooperatively and the workflow records that the associated task was cancelled rather than completed.

## `/session terminate`

Force-stop a live session.

**Rules**

- Available only when session lifecycle is active.
- Use when cooperative cancellation is insufficient or unhealthy runtime behavior requires a harder stop.

**Context**

- Session selected.
- Task selected with an active session, when the session action is inherited into task context.

**Model status changes**

- Session lifecycle: `starting|running -> terminated`
- Owning task lifecycle: `-> cancelled`
- Owning task `cancelledAt`: set

**Derived model effects**

- Stage and dependency projections are recomputed after the task is marked cancelled.

**Result**

The live session is force-stopped and the workflow records the task as cancelled rather than successful.

## Selection Summary

The practical command surface should now read like this:

### Mission selection

- `/mission pause`
- `/mission resume`
- `/mission panic`
- `/mission clear-panic`
- `/mission deliver`

### Stage selection

- no stage commands

### Task selection

- `/task start`
- `/launch`
- `/task done`
- `/task reopen`
- `/task autostart on`
- `/task autostart off`
- `/task launch-mode manual`
- `/task launch-mode automatic`
- inherited live-session controls when a session exists in task context

### Artifact selection

- no artifact-owned commands
- task-relevant commands may still be available because the owning task remains in context

### Session selection

- plain reply input
- `/session cancel`
- `/session terminate`

## Local UI Command

The Tower surface still keeps one local non-workflow command:

### `/quit`

Exit the terminal UI.

**Rules**

- Always available locally in Tower.

**Context**

- UI-local command, not part of mission workflow state.

**Model status changes**

- None.

**Result**

Closes the local Tower surface only.
