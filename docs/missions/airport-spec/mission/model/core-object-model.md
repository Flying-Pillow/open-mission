---
layout: default
title: Core Object Model
nav_exclude: true
---

# Core Object Model

This document defines the canonical first-class object model for `packages/core`.

It is normative.

This document is aligned to the workflow engine specification.

It does not change that specification.

Its job is to reconcile the workflow-engine terminology with the rest of the core domain model so that core code and documentation use one unambiguous naming system.

## Scope Boundary

This document defines the semantic object model owned by `packages/core`.

It does not define the daemon-wide application controller, airport layout state, panel registration, focus semantics, client state, or zellij reconciliation.

Those concerns are defined by the airport control plane specification and belong outside the core semantic model.

Normative override:

- the authoritative top-level runtime state is the daemon-owned composite `MissionSystemState`
- the first-class semantic contexts are `repository`, `mission`, `task`, `artifact`, and `agentSession`
- any older aggregate-root language in this document is semantic grouping language only unless explicitly restated here
- if a row in this document implies that `packages/core` owns airport state or panel/layout truth, that implication is wrong

## Alignment Rules

1. `Canonical Term` is the name that should be used in core documentation, public APIs, and class naming.
2. `Workflow Spec Term` is the exact corresponding term from the workflow engine definition when that spec defines one.
3. `Workflow Spec Term` may quote a prose phrase from the workflow engine definition when the concept is described there but does not have a formal type name.
4. `Workflow Spec Term` may say `prose only` when the concept exists there but no single phrase is the right mapping.
5. `Workflow Spec Term` may say `not covered` when the workflow engine definition does not define the concept.
6. `Owned By` names the single object that contains or governs the term in the object model.
7. Each row defines one object only. Primitive fields, enums, and helper functions are out of scope for this table.

## Type Meanings

The `Type` column describes the object's role in the model, not a TypeScript keyword.

- `Aggregate Root`: a long-lived owner object with identity, invariants, and child objects
- `Entity`: a stateful object with stable identity owned by another object
- `Specification`: an immutable object that defines structure or policy
- `Service`: a coordinating object that performs work but does not own the business state
- `Adapter Interface`: the provider boundary implemented by infrastructure code
- `Runtime Entity`: a live execution object with lifecycle and control methods
- `Projection`: a derived read model
- `Event`: an immutable fact
- `Signal`: a reducer-emitted derived notification
- `Request`: a reducer-emitted execution request
- `Action`: an operator-facing control exposed by the daemon or a Surface
- `Command`: a structured control message sent to a live runtime entity

## Control Plane Terms

| Canonical Term | Workflow Spec Term | Type | Owned By | Definition | Responsibilities |
| --- | --- | --- | --- | --- | --- |
| `missiond` | `not covered` | Service | `System` | The single authority process that composes semantic Mission control with Airport control. | Own the authoritative mutation loop, route accepted commands and observations, persist authoritative state changes, and publish derived projections. |
| `RepositoryContext` | `repository` | Entity | `MissionControl` | The canonical semantic context for one repository inside the daemon-owned domain graph. | Own repository identity, repository root, display metadata, known mission ids, and repository-scoped settings identity. |
| `RepositorySettings` | `MissionDaemonSettings` | Entity | `RepositoryContext` | The persisted repository-level settings associated with one repository context. | Store repository-scoped defaults such as runner, mode, model, paths, theme, tracking provider, and workflow settings. |
| `WorkflowDefinition` | `WorkflowGlobalSettings` | Specification | `RepositorySettings` | The repository-level workflow policy used to initialize future missions. | Define stage order, stage definitions, task generation rules, workflow gate rules, human-in-the-loop policy, panic policy, and execution limits. |
| `StageDefinition` | `WorkflowStageDefinition` | Specification | `WorkflowDefinition` | The static definition of one Stage inside the WorkflowDefinition. | Define stage identity, display name, completion policy, and the default launch policy for tasks created in that stage. |
| `StageLaunchPolicy` | `WorkflowStageTaskLaunchPolicy` | Specification | `StageDefinition` | The default launch behavior applied to tasks generated for a stage. | Define default autostart behavior and default launch mode for newly generated tasks. |
| `TaskGenerationRule` | `prose only` | Specification | `WorkflowDefinition` | The rule that determines which tasks are created when a stage becomes eligible. | Define how tasks are generated for a stage and what task definitions should be instantiated. |
| `WorkflowGateDefinition` | `gate rules` | Specification | `WorkflowDefinition` | The static workflow checkpoint rule that later becomes a workflow gate projection. | Define semantic progression conditions before workflow gate projections are derived. |
| `MissionAction` | `daemon/UI command model` | Action | `missiond` | An operator-facing control exposed by the daemon or a Surface. | Express controls such as pause mission, resume mission, panic stop mission, clear panic, mark task done, mark task blocked, reopen task, or manually start a ready task. |

## Mission Terms

| Canonical Term | Workflow Spec Term | Type | Owned By | Definition | Responsibilities |
| --- | --- | --- | --- | --- | --- |
| `MissionContext` | `prose only` | Entity | `MissionControl` | The canonical semantic context for one mission inside the daemon-owned domain graph. | Own mission identity, repository identity, workspace path, lifecycle summary, and references to related task, artifact, and agent-session contexts. |
| `MissionBrief` | `not covered` | Specification | `MissionContext` | The immutable intake record that states why a mission exists. | Carry issue, title, body, type, and intake metadata only. |
| `MissionWorkspace` | `not covered` | Entity | `MissionContext` | The mission-local working directory associated with one mission context. | Provide the working directory for task execution and bind the mission context to checked out repository state without becoming layout truth. |
| `FlightDeck` | `not covered` | Entity | `MissionContext` | The mission-owned record space that stores the mission's human-readable history and outputs. | Organize mission artifacts, task artifacts, audit outputs, delivery outputs, and other persisted mission records. |
| `Artifact` | `not covered` | Entity | `FlightDeck` | One persisted mission document logically associated with a Mission or Task. | Represent persisted content and metadata, maintain stable file identity, and expose artifact kind and logical owner. |
| `MissionRuntime` | `MissionWorkflowRuntimeDocument` | Entity | `MissionContext` | The authoritative mission-local workflow runtime record persisted in `mission.json`. | Own the WorkflowSnapshot, WorkflowRuntimeState, and workflow event log for one mission context. |
| `WorkflowSnapshot` | `MissionWorkflowConfigurationSnapshot` | Specification | `MissionRuntime` | The immutable workflow snapshot captured for one mission when it leaves `draft`. | Freeze the WorkflowDefinition for one mission so later repository setting changes do not mutate that mission's behavior. |

## Workflow Runtime Terms

| Canonical Term | Workflow Spec Term | Type | Owned By | Definition | Responsibilities |
| --- | --- | --- | --- | --- | --- |
| `WorkflowRuntimeState` | `MissionWorkflowRuntimeState` | Entity | `MissionRuntime` | The mutable workflow state persisted inside MissionRuntime. | Store mission lifecycle, pause state, panic state, active stage id, stage projections, task runtimes, session runtimes, gate projections, launch queue, and last update time. |
| `WorkflowReducer` | `MissionWorkflowReducer` | Service | `MissionControl` | The pure reducer that accepts one WorkflowEvent and returns next state, signals, and requests. | Reduce workflow state deterministically and emit WorkflowRequests without performing external work directly. |
| `WorkflowEvent` | `MissionWorkflowEvent` | Event | `MissionRuntime` | An immutable fact accepted by the WorkflowReducer. | Describe a mission, task, or agent-session state change in workflow terms and serve as the only valid input for workflow transitions. |
| `WorkflowSignal` | `MissionWorkflowSignal` | Signal | `WorkflowReducer` | A derived notification emitted by the WorkflowReducer after a WorkflowEvent is reduced. | Publish derived readiness or completion facts such as `stage.ready`, `task.ready`, `gate.passed`, and `mission.completed`. |
| `WorkflowRequest` | `MissionWorkflowRequest` | Request | `WorkflowReducer` | A reducer-emitted execution request that must be executed outside the reducer. | Request runtime work such as session launch, session prompt, session command, session cancellation, session termination, mission pause, or mission completion marking. |
| `WorkflowRequestExecutor` | `request executor` | Service | `MissionControl` | The service that executes WorkflowRequests and feeds request outcomes back as WorkflowEvents. | Perform requested runtime work outside the reducer, coordinate execution, and return resulting workflow events. |
| `Stage` | `prose only` | Entity | `MissionContext` | The structural mission-local grouping of tasks within one workflow stage. | Group tasks for one workflow stage while leaving execution semantics to tasks and runtime projections; stage is never an airport or layout authority. |
| `StageRuntime` | `MissionStageRuntimeProjection` | Projection | `WorkflowRuntimeState` | The derived runtime view of one stage in MissionRuntime. | Report stage lifecycle and the task ids that are ready, queued, running, blocked, and completed. |
| `Task` | `prose only` | Entity | `Stage` | The smallest executable unit of Mission work. | Own its instruction, dependencies, task artifacts, and lifecycle identity as the execution unit of the workflow. |
| `TaskLaunchPolicy` | `MissionTaskRuntimeSettings` | Specification | `TaskRuntime` | The per-task launch behavior copied from stage defaults and later editable per task. | Define autostart behavior and launch mode for one task at runtime. |
| `TaskRuntime` | `MissionTaskRuntimeState` | Entity | `WorkflowRuntimeState` | The authoritative runtime state of one Task inside MissionRuntime. | Store task identity, stage identity, instruction, dependencies, lifecycle, blocked-by set, TaskLaunchPolicy, runner id, retry count, and timestamps. |
| `TaskLaunchRequest` | `MissionTaskLaunchRequest` | Entity | `WorkflowRuntimeState` | The queued request to launch execution for one Task. | Represent pending launch intent with request identity, task identity, timestamp, and requesting actor. |
| `WorkflowGateProjection` | `MissionGateProjection` | Projection | `WorkflowRuntimeState` | The derived runtime view of one workflow gate in MissionRuntime. | Report whether a workflow gate is `blocked` or `passed` and explain the current reasons; this is distinct from airport gate binding state. |
| `PauseState` | `MissionPauseState` | Entity | `WorkflowRuntimeState` | The mission-local runtime pause state. | Record whether the Mission is paused, why it is paused, and when the pause was requested. |
| `PanicState` | `MissionPanicState` | Entity | `WorkflowRuntimeState` | The mission-local runtime panic state. | Record whether panic is active and how session termination, queue clearing, and mission halt rules apply. |

## Agent Execution Terms

| Canonical Term | Workflow Spec Term | Type | Owned By | Definition | Responsibilities |
| --- | --- | --- | --- | --- | --- |
| `AgentRunnerRegistry` | `not covered` | Service | `missiond` | The registry of available AgentRunner implementations. | Register, validate, and resolve AgentRunner implementations by canonical identifier. |
| `AgentRunner` | `not covered` | Adapter Interface | `AgentRunnerRegistry` | The provider adapter that can create and control AgentSessions. | Advertise capabilities, start sessions, attach sessions, and translate provider-native behavior into the canonical session contract. |
| `AgentSession` | `prose only` | Runtime Entity | `AgentRunner` | A live provider-backed execution context launched for exactly one Task through exactly one AgentRunner. | Accept prompts and commands, expose lifecycle snapshots, emit normalized session events, and support cancel and terminate operations. |
| `AgentSessionRuntime` | `MissionAgentSessionRuntimeState` | Entity | `WorkflowRuntimeState` | The durable mission-local runtime state of one AgentSession in MissionRuntime. | Store session identity, task identity, runner identity, lifecycle, and lifecycle timestamps. |
| `AgentPrompt` | `not covered` | Specification | `AgentSession` | Freeform text submitted to a running AgentSession. | Carry human-authored or workflow-authored prompt content and any prompt metadata needed by the session. |
| `AgentCommand` | `not covered` | Command | `AgentSession` | A structured control message sent to a running AgentSession. | Carry canonical runtime control intents such as `interrupt`, `continue`, `checkpoint`, or `finish`. |