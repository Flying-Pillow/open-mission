# Workflow Engine

Mission's workflow engine is a reducer-driven mission runtime that persists execution state as `mission.json` inside a mission workspace. It is mission-local, configuration-backed, and designed to survive restarts without depending on an in-memory shell loop.

The key rule is that execution semantics belong to tasks and sessions. Stages are structural projections derived from task state.

## Runtime Layers

The implemented workflow engine separates four things that often get conflated in AI orchestration systems:

| Layer | Current type or file | Responsibility |
| --- | --- | --- |
| Configuration snapshot | `MissionWorkflowConfigurationSnapshot` | Freeze workflow policy into a mission-local record |
| Runtime state | `MissionWorkflowRuntimeState` | Persist lifecycle, tasks, sessions, gates, pause, panic, and queue state |
| Emitted requests and signals | Reducer output | Describe side effects and surface notifications without mutating state outside the reducer |
| Persisted runtime record | `MissionRuntimeRecord` | Package schema version, mission id, configuration, runtime state, and event log |

This separation is the foundation for determinism. Policy is snapshotted. Events are reduced. Effects are requested explicitly. State is persisted in one mission-local document.

## What `mission.json` Is

`mission.json` is the per-mission runtime record. It is not repository bootstrap state and it is not daemon-wide state.

The persisted type is `MissionRuntimeRecord`:

```ts
type MissionRuntimeRecord = {
  schemaVersion: number;
  missionId: string;
  configuration: MissionWorkflowConfigurationSnapshot;
  runtime: MissionWorkflowRuntimeState;
  eventLog: MissionWorkflowEventRecord[];
}
```

The controller creates this document when a mission starts from draft and no persisted runtime record already exists. If the workflow is configured with `autostart.mission: false`, controller initialization can leave the mission without a materialized runtime document until the mission is explicitly started.

## Reducer-Based State Machine

The reducer consumes one event at a time and returns:

- next runtime state
- emitted workflow signals
- requested runtime effects

The mission lifecycle states are:

- `draft`
- `ready`
- `running`
- `paused`
- `panicked`
- `completed`
- `delivered`

Task lifecycle is modeled independently, and session lifecycle is modeled independently again. This keeps mission governance separate from work execution and separate from provider runtime state.

## Stages, Tasks, Sessions, Gates, And Queue State

The runtime state currently contains:

- `pause` as `MissionPauseState`
- `panic` as `MissionPanicState`
- `stages` as `MissionStageRuntimeProjection[]`
- `tasks` as `MissionTaskRuntimeState[]`
- `sessions` as `MissionAgentSessionRuntimeState[]`
- `gates` as `MissionGateProjection[]`
- `launchQueue` as `MissionTaskLaunchRequest[]`

The stage projections are derived from task state. The gates are derived from stage completion. The launch queue is explicit. Panic and pause are explicit. This is what makes the runtime inspectable rather than heuristic.

## Current Stage Model

The default workflow snapshot defines this order:

```text
prd -> spec -> implementation -> audit -> delivery
```

Task generation rules exist for `prd`, `spec`, and `audit` in the default workflow. The controller ensures generated tasks exist for the currently eligible stage by issuing `tasks.request-generation` requests when that stage has no runtime tasks yet.

One implemented caveat matters for adopters: the reducer models task autostart and launch mode, but `queueAutostartTasks` is currently a no-op. That means the launch policy is persisted and exposed, but actual auto-queueing is not yet implemented in the reducer.

## Controller And Request Execution

`MissionWorkflowController` wraps the reducer with persistence and effect execution. Its responsibilities are:

1. load or create the mission runtime record
2. apply workflow events through the reducer
3. persist the resulting `mission.json`
4. execute reducer-emitted requests through `MissionWorkflowRequestExecutor`
5. ingest emitted runtime events back into the reducer

This wrapper is what turns pure reducer output into a functioning orchestration loop without letting side effects own the state machine.

## What Requests Do

The current request executor handles request families such as:

- `tasks.request-generation`
- `session.launch`
- `session.prompt`
- `session.command`
- `session.cancel`
- `session.terminate`
- `mission.mark-completed`

Task generation requests materialize stage artifacts and generated task files. Session requests are executed through the runtime orchestrator and translated back into workflow events like `session.started`, `session.completed`, `session.failed`, `session.cancelled`, and `session.terminated`.

This is the right boundary: the reducer asks for effects, the executor performs them, and the resulting facts are re-reduced into state.

## Crash Recovery And Determinism

Mission's crash-recovery story comes from explicit persisted state rather than from replaying a terminal transcript:

- runtime policy is snapshotted into the mission record
- runtime state is persisted in `mission.json`
- runtime session identities can be normalized and reattached
- session reconciliation turns live provider state back into workflow events
- panic, pause, and completion are all persisted lifecycle facts

This gives architects a concrete answer to a hard runtime question: after a crash or reconnect, Mission does not need to guess what the workflow meant to do. It reads the mission record, reconciles session facts, and continues from explicit state.