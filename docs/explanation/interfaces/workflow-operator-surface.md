---
layout: default
title: Workflow Operator Surface
parent: Interfaces
grand_parent: Explanation
nav_order: 1
---

# Workflow Operator Surface

This document defines the operator-facing command and status contract for Mission workflow surfaces.

It is a separate specification from the workflow engine definition.

The workflow engine defines authoritative runtime semantics.

This document defines how daemon-owned operator surfaces such as CLI cockpit, VS Code views, webviews, and future clients must project those semantics without reintroducing stage runtime control.

This is a from-scratch specification.

It does not preserve compatibility with the current `stage.transition.*` command family, the current stage `start` and `restart` affordances, or any UI model that treats stages as executable runtime actors.

## Relationship To Other Specifications

This document depends on, and must not override, the workflow engine specification, the agent runtime specification, and the airport control plane specification.

Priority rule:

1. workflow engine specification defines runtime truth and valid events
2. agent runtime specification defines runtime execution boundary
3. airport control plane specification defines daemon-wide layout truth, gate bindings, focus semantics, panel identity, and panel-facing projection boundaries
4. this operator surface specification defines how surfaces expose those capabilities to humans

If a surface behavior conflicts with the workflow engine definition, the surface behavior is wrong and must change.

If a surface behavior conflicts with airport gate binding, focus, or panel-identity rules, the surface behavior is wrong and must change.

## Problem

Mission currently has architectural drift between:

- the reducer-driven workflow engine direction, where tasks and mission lifecycle are authoritative
- legacy operator surfaces, where stage start, stage restart, and stage transition are still treated as first-class runtime commands

That drift creates multiple failures:

1. surfaces can imply stage control semantics that the engine does not define
2. daemon command descriptors can become mismatched with actual reducer-valid actions
3. UI components can filter or group commands around stage targets even when stage targets do not own executable actions
4. user expectations become unstable because the same stage can look controllable in one surface and derived in another

The correct architecture is:

- workflow engine owns runtime behavior
- airport control plane owns gate binding, focus, client registration, and panel projection boundaries
- daemon owns authoritative command projection and validation
- surfaces present user-friendly language, but only as a projection over mission, task, artifact, agent-session, gate, and generation actions

## Goals

The operator surface contract must be:

- reducer-compatible
- daemon-authoritative
- task-centric in execution semantics
- stage-friendly in presentation only
- explicit about mission pause and panic behavior
- explicit about task manual start and launch policy behavior
- consistent across CLI, VS Code, webview, and future clients
- free of legacy stage runtime aliases

## Non-Goals

This specification does not define:

- reducer internals
- runtime adapter internals
- UI visual design
- exact layout of CLI or VS Code components
- repository workflow settings schema

This specification also does not authorize:

- stage runtime commands
- compatibility aliases for `stage.transition.*`
- surface-local workflow mutation logic

## Core Rule

Stages are structural and derived.

Stages may be presented as operator-facing slices, checkpoints, lanes, or cards.

Stages must not be treated as runtime actors with independent control semantics.

That means surfaces may describe a stage as:

- pending
- ready
- active
- blocked
- completed

But surfaces must not require daemon actions such as:

- start stage
- pause stage
- resume stage
- restart stage
- transition to next stage
- revert to previous stage

unless the surface is only using those phrases as descriptive shorthand for mission or task actions and the daemon contract remains expressed in mission, task, artifact, agent-session, gate, or generation terms.

## Terminology Split

This document must distinguish two unrelated uses of the word `gate`.

### Workflow Gates

Workflow gates are semantic projections such as implementation, verification, audit, or delivery readiness.

They are derived from workflow state.

They are not layout slots.

### Airport Gates

Airport gates are stable layout slots such as `dashboard`, `editor`, and `pilot`.

They are owned by the airport control plane.

They are not workflow checkpoints.

Surfaces must not collapse these concepts into one generic `gate` model.

If both appear in the same UI, they must be presented as distinct concepts.

## Source Of Truth

The daemon is the only authority for:

- current domain selection state
- which operator actions are currently available
- which action targets they apply to
- why an action is disabled
- what follow-up input, if any, is required to execute an action
- which airport gate is bound to which target
- which gate focus intent is active and which focus state is observed

Surfaces must not synthesize workflow action availability from local heuristics.

Surfaces may derive presentation state locally, but executable action state, selection state, and airport gate state must come from daemon-owned projection.

## Operator Intent Model

Humans often think in stage language.

The surface contract must accommodate that language without mutating stage runtime state directly.

### Stage Intent Translation

When an operator says "start this stage", the daemon-owned surface must translate that request into one or more of the following valid intents:

- generate tasks for the currently eligible stage if no task runtime records exist yet
- resume the mission if mission lifecycle is paused
- queue one or more ready tasks in the eligible stage
- change launch policy for tasks in that stage so ready work autostarts

When an operator says "stop this stage", the daemon-owned surface must translate that request into one or more of the following valid intents:

- pause the mission so new work does not auto-launch
- panic stop the mission if active work must be interrupted
- cancel or terminate specific running sessions
- change launch policy for tasks in that stage so future ready work remains manual
- mark a task blocked if the operator is intentionally halting specific work

When an operator says "go back to this stage", the daemon-owned surface must translate that request into:

- reopen one or more earlier tasks, subject to downstream activity validation

The daemon must never interpret these intents as stage runtime mutation.

## Authoritative Action Families

The operator surface contract must expose actions only from the following families.

### 1. Selection Actions

- select repository
- select mission
- select task
- select artifact
- select agent session

These actions map to daemon-owned domain selection state.

### 2. Mission Actions

- pause mission
- resume mission
- panic stop mission
- clear panic
- deliver mission

These actions map to mission lifecycle or mission orchestration events.

### 3. Task Actions

- start ready task manually
- mark task done
- mark task blocked
- reopen task
- enable task autostart
- disable task autostart
- switch task launch mode when that behavior is supported by workflow policy

These actions map to task events and task runtime policy changes.

### 4. Session Actions

- cancel session
- terminate session
- send prompt to session
- send engine-defined or operator-defined runtime commands to session

These actions map to session lifecycle or runtime interaction semantics.

### 5. Artifact And Gate Actions

- open artifact in editor gate
- focus gate

These actions map to airport binding or focus intents derived from semantic selection and airport policy.

### 6. Generation Actions

- generate tasks for the current eligible stage when no tasks exist yet

This action maps to the generation path defined by the workflow engine and must not be phrased internally as stage start.

## Forbidden Action Families

The following action families are forbidden in the daemon contract:

- `stage.transition.*`
- `stage.start.*`
- `stage.restart.*`
- `stage.pause.*`
- `stage.resume.*`
- any hidden synonym for the above

The following surface-local behaviors are also forbidden:

- inferring executable stage actions by looking only at stage projection state
- exposing stage-only buttons whose execution cannot be expressed as mission, task, artifact, agent-session, gate, or generation actions
- constructing fallback command lists in UI code when daemon does not provide one

## Command Descriptor Contract

The daemon must publish operator actions as explicit command descriptors.

Each descriptor must include at least:

- stable `id`
- human label
- user-entered command text if a command line surface exists
- authoritative scope
- target identity when target-specific
- enabled or disabled state
- disabled reason when disabled
- optional confirmation metadata
- optional structured execution flow metadata

The scope model must be:

- `repository`
- `mission`
- `task`
- `artifact`
- `agentSession`
- `generation`
- `gate`

`stage` scope is forbidden as an executable authority scope.

If a stage card or tree item is selected, the surface may still display mission, task, artifact, agent-session, gate, or generation commands that are relevant to that stage projection, but the commands themselves must remain expressed in the allowed scopes above.

## Targeting Rules

The command system must distinguish between presentation target and execution target.

### Presentation Target

This is what the operator is currently looking at:

- mission overview
- stage card
- task row
- agent-session console

### Execution Target

This is what the daemon command actually mutates:

- domain selection state
- mission lifecycle
- task runtime state
- agent session lifecycle
- task generation request for the eligible stage
- airport gate binding or focus intent

A stage presentation target may resolve to:

- one generation action
- zero or more task actions over tasks in that stage
- one mission pause or resume action if stage semantics imply a mission-level checkpoint state
- zero or more agent-session actions for sessions owned by tasks in that stage
- zero or more artifact actions for artifacts relevant to that stage

The surface must not require stage identifiers as executable target ids unless the command is a generation request for the eligible stage.

## UX Language Rules

Human-facing copy should be friendly and stage-aware.

It must still preserve the underlying execution truth.

### Preferred Labels

Good labels include:

- Resume Mission
- Pause Mission
- Panic Stop
- Start Ready Task
- Reopen Task
- Enable Autostart
- Disable Autostart
- Generate Audit Tasks
- Stop Running Agent

Good descriptive stage copy includes:

- Stage ready for review
- Manual start required
- Waiting on earlier task completion
- Downstream work blocked by reopened task
- No tasks generated yet

### Forbidden Labels

The following labels must not be used as authoritative action labels:

- Start Stage
- Stop Stage
- Restart Stage
- Transition Stage
- Advance Stage
- Revert Stage

If a surface uses stage phrasing in helper text, it must immediately clarify the actual effect on mission, task, artifact, agent-session, gate, or generation state.

## Stage Card Behavior

A stage card or stage tree node is allowed as a presentation grouping.

Selecting a stage grouping should expose:

1. generation action if the stage is the eligible stage and has no tasks
2. mission checkpoint actions when relevant
3. task actions for tasks in that stage
4. agent-session actions for sessions owned by tasks in that stage
5. artifact actions for artifacts relevant to that stage when those artifacts are semantically targetable

Selecting a stage grouping must never result in an empty command panel solely because commands were published only for task targets while the surface filtered them out by stage scope.

If stage selection is used in the UI, daemon command projection or surface grouping logic must map stage selection onto the correct underlying mission, task, artifact, agent-session, gate, or generation commands.

## Mission Pause And Checkpoint Behavior

The operator surface must reflect the difference between:

- mission pause
- stage checkpoint behavior
- task manual start behavior

### Mission Pause

Mission pause is mission lifecycle state.

It affects auto-launch of new work at the mission level.

### Stage Checkpoint

A stage checkpoint is not a stage pause.

It is represented by one or both of:

- mission paused lifecycle
- generated tasks in the eligible stage having manual launch or `autostart: false`

### Manual Start Requirement

If a stage projects as blocked because tasks are ready but manual start is required, the surface should say that explicitly.

It must not imply that the stage itself is paused.

## Reopen Behavior

The surface must treat reopen as a task action with stage-level projection consequences.

Reopening an earlier task:

- invalidates completion of that task's stage
- makes later incomplete stages ineligible
- may block downstream work
- must be rejected when downstream queued or running work exists

The operator UX must therefore:

- warn before reopening if downstream work exists or might be affected
- present reopen as task-scoped even when triggered from a stage view
- explain that downstream stage projections may change

The operator UX must not present reopen as "restart stage".

## Daemon API Requirements

The daemon protocol must provide enough information for surfaces to stay thin.

Required capabilities:

1. fetch authoritative system projections, including derived workflow stage and workflow gate projections plus airport gate binding and focus projections
2. fetch authoritative available command descriptors for the current mission context
3. execute a command descriptor by id plus structured steps
4. broadcast updated projections after accepted commands or observations change authoritative state
5. return disabled reasons for unavailable actions whenever possible

The daemon protocol must not require surfaces to:

- call local stage transition evaluators
- infer reopen legality locally
- infer task manual-start eligibility locally
- infer panic semantics locally
- infer airport gate bindings or focus locally
- inspect zellij directly

## Surface Architecture Rules

CLI cockpit, VS Code views, webviews, and future clients are all thin clients over the same daemon-owned operator contract.

That means:

- command grouping may vary by surface
- command wording may vary slightly by surface
- execution semantics must not vary by surface
- a gate-bound panel must receive its airport gate identity from the daemon-owned control plane rather than infer it locally
- panels must communicate only with the daemon, not with each other or with zellij as authorities

Surface differences are allowed only in presentation.

Surface differences are forbidden in workflow policy.

## Client Protocol Facade Rules

Surface-side client helpers may exist, but only as a typed facade over the daemon protocol.

The acceptable split is:

- `DaemonClient` owns transport only
- `DaemonApi`, `DaemonControlApi`, and `DaemonMissionApi` own typed request and response shaping only
- daemon workspace and mission objects own workflow semantics and state mutation

That means the client protocol facade may expose methods such as:

- `api.control.getStatus()`
- `api.mission.fromBrief(...)`
- `api.mission.fromIssue(...)`
- `api.control.updateWorkflowSettings(...)`

These names describe the request a surface sends to the daemon.

For example, `api.mission.fromBrief(...)` is a daemon request to prepare mission initialization from a brief. In the target architecture, that request prepares tracked mission content on a proposal branch and opens the mission-start pull request. It does not mean that a surface may create local worktrees or write mission state on its own.

They do not imply client-side ownership of mission lifecycle or workflow policy.

The client protocol facade must not:

- interpret briefs or issues into mission state locally
- create branches, files, tasks, or sessions locally
- derive command availability locally
- apply workflow mutations outside daemon requests
- hide fallback workflow behavior behind convenience helpers

Client-side validation is allowed only for transport-level sanity, such as rejecting a missing `missionId` before sending a mission-plane request that the daemon would reject anyway.

If a helper starts to choose workflow behavior instead of merely requesting daemon behavior, it has crossed the boundary and is architecturally wrong.

## Legacy Replacement Rules

The following legacy concepts must be removed or rewritten where they remain in operator-facing code:

- explicit stage transition command ids
- stage restart buttons
- extension commands that attempt to move directly to previous or next stage
- command filtering that assumes stage scope must match stage selection exactly
- helper logic that derives command availability from legacy manifest transition evaluators instead of daemon command descriptors

If a surface still contains these concepts temporarily, they are architectural debt, not part of the target design.

## Example Translation Table

| Human intent | Surface wording | Daemon execution meaning |
| --- | --- | --- |
| start this stage | Generate tasks, Start ready task, Resume mission | generation request, `task.queued`, or `mission.resumed` |
| stop this stage | Pause mission, Disable autostart, Stop running agent | `mission.paused`, task launch policy changes, `session.cancel` or `session.terminate` |
| restart this stage | Reopen completed task | `task.reopened` |
| continue review stage | Start ready audit task | `task.queued` |
| hold implementation here | Pause mission or set implementation tasks manual | `mission.paused` or `task.launch-policy.changed` |

## Acceptance Criteria

This specification is satisfied only if all of the following are true:

1. no operator surface depends on `stage.transition.*` or equivalent stage runtime commands
2. daemon-published command descriptors are sufficient to drive operator action affordances without local workflow-policy reconstruction
3. stage selection in a surface never hides relevant task or mission commands purely because stage is not an executable scope
4. user-facing stage language remains available as projection and guidance, not as runtime authority
5. reopen, pause, panic, manual start, and launch-policy edits are all expressible through the operator contract

## Implementation Consequence

Any implementation plan derived from this specification should:

1. rewrite daemon command projection around repository, mission, task, artifact, agent-session, gate, and generation actions
2. remove stage-transition execution paths entirely
3. update CLI and VS Code surfaces to consume the same daemon-owned command model
4. ensure stage-oriented UX is implemented as grouping and translation only

This document intentionally defines the contract boundary first.

It does not prescribe the exact order in which legacy surface code must be deleted.