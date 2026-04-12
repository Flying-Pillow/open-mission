---
layout: default
title: Operator Command Model
parent: Reference
nav_order: 4
---

# Operator Command Model

This page defines the intended operator command model for Mission.

It is not only a list of current command strings. It explains which layer owns a command, when that command should be available, what context the operator is acting in, and what the command is supposed to change.

This distinction matters because Mission is not a flat command shell. The operator is steering a workflow engine with several different semantic layers:

- mission as the governance boundary
- stage as the derived planning boundary
- task as the primary execution boundary
- artifact as evidence and review context
- agentrunner as the live execution worker attached to a task

The product stays coherent only if commands respect those boundaries.

## Core Rules

The following rules anchor the tables below:

1. Mission-level commands govern the whole mission and may affect all work inside it.
2. Stage state is derived from tasks and should not become a second runtime control surface.
3. Task is the main steering unit for execution.
4. Artifacts are evidence and navigation targets, not independent workflow authorities.
5. Agentrunner control is really live session control attached to a task, not a separate workflow lifecycle.

## How To Read The Tables

Each table uses four columns:

| Column | Meaning |
| --- | --- |
| Command | The operator-facing action concept |
| Rules | When the command is allowed and what guards apply |
| Context | Which selection or runtime context should surface the command |
| Result | What the command is expected to change |

## Mission Commands

Mission commands are global governance controls. They should be few, explicit, and consequential.

| Command | Rules | Context | Result |
| --- | --- | --- | --- |
| Pause mission | Allowed only when the mission is running. Use for controlled review or pacing, not emergency containment. | Mission selected, or any lower-level selection inside that mission when mission governance controls are still relevant. | Stops further mission progression and prevents new work from being queued or launched until the mission is resumed. |
| Resume mission | Allowed only when the mission is paused and not in panic state. | Mission selected, or any lower-level selection inside a paused mission. | Re-enables mission progression and task scheduling. It does not mark any task complete or restart terminated work automatically. |
| Panic stop mission | Allowed only when the mission has started and is not already panicked or delivered. | Mission selected, or any lower-level selection when emergency recovery actions must take priority. | Puts the mission into panic state, halts launches, and should terminate active sessions and clear queued launch work according to panic policy. |
| Clear panic | Allowed only when the mission is panicked. Clearing panic must not silently resume execution. | Mission selected, or any lower-level selection in a panicked mission. | Removes the panic latch and leaves the mission paused so the operator must explicitly decide what happens next. |
| Deliver mission | Allowed only when the mission is completed, delivery conditions are satisfied, and no unresolved active work remains. | Mission selected, usually near the end of the workflow. | Marks the mission as delivered and closes the delivery lifecycle. |

### Mission Notes

- Mission commands are lifecycle and containment controls.
- Mission commands must not be overloaded with task-like behavior such as starting work, marking slices done, or changing artifact content directly.
- Recovery actions such as resume and clear panic should rank above local task or session actions when the mission is paused or panicked.

## Stage Commands

Stages are operator-facing structure, not execution authorities. Stage commands should stay intentionally narrow.

| Command | Rules | Context | Result |
| --- | --- | --- | --- |
| Generate stage tasks | Allowed only when the stage is the next eligible stage, no runtime tasks exist yet for that stage, and deterministic generation rules exist for it. | Stage selected, typically at the start of a stage that materializes new task inventory. | Creates runtime task records for that stage and materializes the corresponding stage/task files through the workflow generation path. |
| Open stage artifact | Allowed whenever the stage artifact exists. This is review and navigation, not workflow mutation. | Stage selected. | Opens or focuses the stage artifact so the operator can inspect evidence and current stage output. |
| No direct stage complete/pause/reopen/start | These should not exist as first-class runtime controls. Stage lifecycle is derived from task state and mission state. | Stage selected. | No direct mutation. The operator should act on tasks or the mission instead. |

### Stage Notes

- Stages explain where the mission is.
- Tasks determine whether the stage is active, blocked, ready, or completed.
- A stage may surface generation or review operations, but not its own independent execution lifecycle.

## Task Commands

Task commands are the primary steering mechanism for the running workflow engine.

The operator experiences a task as one bounded unit made of assignment, execution, and verification. Because of that, the task surface may include commands that conceptually target the task itself, the live session working on it, or the artifact that defines or proves it.

| Command | Rules | Context | Result |
| --- | --- | --- | --- |
| Start task | Allowed only when the task is ready, dependencies are satisfied, and the mission is neither paused nor panicked. | Task selected. | Queues and begins task execution according to workflow rules. |
| Launch agent | Allowed only when the task is ready, queued, or running, no active session already owns the task, and the mission is neither paused nor panicked. | Task selected. | Starts a live execution session for that task using the configured runner. |
| Mark task done | Allowed only when the task outcome is complete enough to accept and no remaining active execution should still be modifying it. | Task selected. | Marks the task completed in workflow state and may advance downstream readiness. |
| Mark task blocked | Allowed for non-terminal tasks when the operator has a real blocking reason. | Task selected. | Marks the task blocked so the workflow records that work cannot currently continue normally. |
| Reopen task | Allowed only for completed, failed, or cancelled tasks, and only when downstream active work would not make reopen unsafe. | Task selected, usually after review or regression discovery. | Reopens the task and invalidates downstream derived progress as required by workflow rules. |
| Enable autostart | Allowed for non-terminal tasks whose launch policy currently disables autostart. | Task selected. | Changes the per-task launch policy so the workflow may automatically queue or launch the task when eligible. |
| Disable autostart | Allowed for non-terminal tasks whose launch policy currently enables autostart. | Task selected. | Changes the per-task launch policy so the task no longer auto-starts. |
| Require manual start | Allowed for non-terminal tasks when the current launch mode is automatic. | Task selected. | Changes task launch mode to manual so explicit operator intent is required before execution starts. |
| Switch to automatic launch | Allowed for non-terminal tasks when the current launch mode is manual. | Task selected. | Changes task launch mode to automatic so the workflow engine may launch it when eligible. |
| Reply to agent | Allowed only when the task currently has a live session that is awaiting input or can accept prompts. | Task selected with an active or awaiting-input session. | Sends operator input into the live execution session for that task. |
| Cancel agent | Allowed only when the task currently has an active live session. | Task selected with an active session. | Requests a cooperative stop for the running session associated with the task. |
| Terminate agent | Allowed only when the task currently has an active or unhealthy session and force-stop is justified. | Task selected with an active session. | Force-stops the live session associated with the task. |

### Task Notes

- Task is the correct place to unify assignment, execution, and verification behavior.
- A task surface may inherit artifact and session controls because the operator usually thinks in terms of one work item, not three unrelated entities.
- Task commands should remain authoritative over workflow truth. A session ending does not by itself mean the task is done.

## Artifact Commands

Artifacts are durable evidence and context. They should not become a second execution model.

| Command | Rules | Context | Result |
| --- | --- | --- | --- |
| Open artifact | Allowed whenever the artifact exists. | Artifact selected. | Opens or focuses the artifact for reading and review. |
| Inspect owning task | Allowed whenever the artifact has an owning task or clear stage provenance. | Artifact selected. | Navigates the operator back to the task or workflow unit responsible for this artifact. |
| Reopen owning task | Allowed only indirectly, using the owning task's reopen rules. The artifact itself does not define reopen authority. | Artifact selected, when review shows the producing task must be revisited. | Reopens the owning task through task lifecycle rules, not through artifact-local state. |
| No direct artifact start/done/block/launch | These should not exist as artifact-owned commands. | Artifact selected. | No direct mutation. The operator should act on the owning task or mission instead. |

### Artifact Notes

- Artifacts are evidence, not workers.
- Artifact contexts are useful for routing, review, and understanding provenance.
- If artifact-local actions are surfaced, they should usually be inherited task or stage actions rather than new workflow authorities.

## Agentrunner Commands

Agentrunner commands should be treated as live execution controls for a task-bound session.

In practical product terms, this means the operator is usually acting on a session attached to a task, even if the UI presents that surface as "agent" or "runway" control.

| Command | Rules | Context | Result |
| --- | --- | --- | --- |
| Launch agent for task | Allowed only through task launch rules, runner availability, and mission policy. | Task selected before a session exists. | Creates a new live session to execute the selected task. |
| Prompt or reply | Allowed only while a live session can accept operator input. | Agentrunner or session selected, or task selected with a live session. | Sends normalized operator input into the active session. |
| Interrupt | Allowed only while a live session is active and the runtime supports an interrupt-style command. | Live session selected. | Requests a structured interruption of the active session. |
| Cancel | Allowed only while a live session is active. Use for cooperative stop. | Live session selected. | Cancels the active session without pretending the task is complete. |
| Terminate | Allowed only while a live session is active or unhealthy and cooperative cancellation is insufficient. | Live session selected. | Force-terminates the session. |
| Reattach or inspect console | Allowed whenever session state or console history exists. | Live or historical session selected. | Reconnects the operator to the existing session context or shows its recorded console state. |
| Change runner assignment | Allowed only as a pre-launch task policy change, not as an in-place mutation of a live session. | Task selected before launch, or after ending a previous session. | Changes which runner will be used for the next session launch of that task. |

### Agentrunner Notes

- The runner executes a task. It does not define the workflow.
- Session success or failure is runtime information that must be translated back into workflow state.
- A runner must never become the authority for task completion or stage progression.

## Practical Selection Model

The command model should feel natural to the operator at each selection depth:

| Selected layer | Primary commands that should dominate |
| --- | --- |
| Mission | Pause, resume, panic stop, clear panic, deliver |
| Stage | Generate stage tasks, open stage artifact |
| Task | Start, launch, done, blocked, reopen, launch policy, live session controls |
| Artifact | Open artifact, inspect owning task, inherited task recovery actions when relevant |
| Agentrunner or session | Prompt, interrupt, cancel, terminate, inspect console |

This is the intended experience:

- the mission layer governs
- the stage layer explains
- the task layer steers
- the artifact layer proves
- the agentrunner layer executes

## Current Implementation Notes

The current codebase already aligns with this model in several important ways:

- mission actions are explicit and separate from task and session actions
- task actions are richer than stage actions
- session controls are distinct from task completion semantics
- artifact routing exists without introducing artifact-owned workflow mutation

There are also two important caveats:

1. Stage-centered runtime control should continue to be removed or rewritten in favor of task and mission authority.
2. Implementation-stage task generation is still a critical product boundary and should remain deterministic rather than depending on free-form manual file creation.

Those caveats do not weaken the model. They clarify where Mission still needs to tighten the contract so the operator surface remains honest.