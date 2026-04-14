---
layout: default
title: Workflow Engine
parent: Architecture
nav_order: 5
---

# Workflow Engine

The workflow engine is the mission-local execution authority. Its job is to reduce workflow events into a durable runtime record, emit side-effect requests, and reconcile runtime session facts back into mission state.

## Primary Components

| Component | Responsibility | Owned state | Persisted state |
| --- | --- | --- | --- |
| `MissionWorkflowController` | Loads, initializes, normalizes, updates, and persists the mission runtime record | cached `MissionRuntimeRecord` | `mission.json` |
| reducer ingestion logic | Applies one event to the current runtime record and yields requests | none, pure transformation | none |
| `MissionWorkflowRequestExecutor` | Executes request side effects such as task generation and session launch | daemon-owned agent control dependency, buffered runtime events | none directly |
| Task generation helpers | Turn workflow config and templates into task records | generation result in memory | task files + artifact files |

## Runtime Record Structure

The authoritative mission execution document is:

```text
.mission/missions/<mission-id>/mission.json
```

Its top-level shape is:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Runtime record schema version |
| `missionId` | Mission identity |
| `configuration` | Snapshotted workflow configuration |
| `runtime` | Current workflow runtime state |
| `eventLog` | Append-only workflow event history |

## Runtime State Contents

| Runtime field | Purpose |
| --- | --- |
| `lifecycle` | Mission lifecycle such as `draft`, `running`, `paused`, or `delivered` |
| `activeStageId` | Current active stage when one is relevant |
| `pause` | Human or system pause state |
| `panic` | Panic-stop configuration and active panic state |
| `stages` | Derived stage projections |
| `tasks` | Authoritative task runtime records |
| `sessions` | Workflow-tracked session runtime records |
| `gates` | Workflow gate projections such as implement, verify, audit, deliver |
| `launchQueue` | Pending task launch requests |
| `updatedAt` | Last workflow update timestamp |

## Event Families

| Event family | Examples | Effect |
| --- | --- | --- |
| Mission lifecycle | `mission.created`, `mission.started`, `mission.paused`, `mission.delivered` | Advances mission-level lifecycle |
| Task generation | `tasks.generated` | Creates runtime task records for a stage |
| Task lifecycle | `task.queued`, `task.started`, `task.completed`, `task.blocked`, `task.reopened` | Drives task execution state |
| Session lifecycle | `session.started`, `session.launch-failed`, `session.completed`, `session.failed`, `session.cancelled`, `session.terminated` | Keeps workflow state aligned with agent runtime |
| Policy changes | `task.launch-policy.changed` | Changes per-task runtime launch settings |

## Request Execution Boundary

The reducer never opens files, starts zellij, or talks to a model provider. It emits requests. The current request executor handles these request categories:

| Request type | Current executor behavior |
| --- | --- |
| `tasks.request-generation` | Materializes stage artifacts and generated task files, then emits `tasks.generated` |
| `session.launch` | Resolves a runner and starts an `AgentSession` through the shared daemon-owned agent control path, then emits `session.started` or `session.launch-failed` |
| `session.prompt` | Routes a prompt to a running `AgentSession` through the same control path |
| `session.command` | Routes a normalized command to a running `AgentSession` through the same control path |
| `session.cancel` | Cancels a running session through the same control path |
| `session.terminate` | Terminates a running session through the same control path |

The important boundary is that workflow does not depend on UI pane state, but it does depend on normalized runtime truth.

That includes operator interference when it changes the real execution substrate. If a human kills a terminal-backed session outside the happy path, the daemon must reconcile that disappearance back into workflow state. Treating that as workflow input is correct because it is runtime truth, not presentation state.

## Execution Loop

```mermaid
sequenceDiagram
	autonumber
	participant Mission
	participant Controller as MissionWorkflowController
	participant Reducer as reducer ingestion
	participant Executor as RequestExecutor
	participant Control as daemon-owned agent control
	participant Disk as mission.json

	Mission->>Controller: apply event
	Controller->>Reducer: ingest current document + event
	Reducer-->>Controller: next document + requests
	Controller->>Disk: write mission.json
	Controller->>Executor: execute requests
	Executor->>Control: start or control sessions
	Control-->>Executor: runtime events
	Executor-->>Controller: emitted workflow events
	Controller->>Controller: recursively apply emitted events
```

## Task Generation Rules

The engine currently auto-generates tasks for eligible stages when all of these are true:

1. the mission is not already delivered
2. the stage is the next incomplete stage in workflow order
3. no tasks for that stage already exist in runtime state
4. the workflow configuration includes generation templates for that stage

This means stage progression and task generation are tightly coupled to the persisted configuration snapshot in `mission.json`.

## Invariants

1. `mission.json` is the mission execution authority after initialization.
2. The controller persists after every applied event before running follow-up requests.
3. Stage state is derived from tasks, not manually edited by Tower.
4. Session events must be translated back into workflow events before they become mission truth.
5. Operator-facing surfaces may refresh or invalidate command projections, but they must not decide workflow transitions.
6. Runtime transport failures, detached sessions, and externally terminated sessions are valid workflow inputs once normalized by the daemon runtime layer.

## Operator Interference Boundary

Mission intentionally supports humans interrupting the normal flow.

That means the workflow engine must tolerate these cases:

- a terminal session is closed outside Mission
- a prompt is interrupted manually
- a daemon restart must reconcile persisted session references against reality

These are not UI concerns. They are execution concerns.

The correct architecture is:

- surfaces may observe and request actions
- runtime normalizes what is actually alive, failed, or terminated
- workflow consumes those normalized facts

The incorrect architecture would be:

- surfaces reporting focus, selection, or pane visibility as workflow truth
- workflow inferring session liveness from client attachment
- pane binding deciding task eligibility

## Relationship To Replay Anchors

This page is the architecture home for the replayed mission "Workflow Engine And Repository Workflow Settings" and should be read together with `specifications/mission/workflow/workflow-engine.md` and `docs/reference/state-schema.md`.
