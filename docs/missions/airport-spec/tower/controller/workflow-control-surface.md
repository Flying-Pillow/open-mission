---
layout: default
title: Workflow Control Surface
nav_exclude: true
---

# Workflow Control Surface

This document defines the control-surface command and status contract for Mission workflow surfaces.

It is a separate specification from the workflow engine definition.

The workflow engine defines authoritative runtime semantics.

This document defines how daemon-owned control surfaces such as CLI tower, VS Code views, webviews, and future clients must project those semantics without reintroducing stage runtime control.

This is a from-scratch specification.

It does not preserve compatibility with the current `stage.transition.*` command family, the current stage `start` and `restart` affordances, or any UI model that treats stages as executable runtime actors.

## Relationship To Other Specifications

This document depends on, and must not override, the workflow engine specification, the agent runtime specification, and the airport control plane specification.

Priority rule:

1. workflow engine specification defines runtime truth and valid events
2. agent runtime specification defines runtime execution boundary
3. airport control plane specification defines daemon-wide layout truth, gate bindings, focus semantics, panel identity, and panel-facing projection boundaries
4. this control surface specification defines how surfaces expose those capabilities to humans

If a surface behavior conflicts with the workflow engine definition, the surface behavior is wrong and must change.

If a surface behavior conflicts with airport gate binding, focus, or panel-identity rules, the surface behavior is wrong and must change.

## Problem

Mission currently has architectural drift between:

- the reducer-driven workflow engine direction, where tasks and mission lifecycle are authoritative
- legacy control surfaces, where stage start, stage restart, and stage transition are still treated as first-class runtime commands

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

The control surface contract must be:

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

Stages may be presented as controller-facing slices, checkpoints, lanes, or cards.

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

Airport gates are stable layout slots such as `dashboard`, `editor`, and `agentSession`.

They are owned by the airport control plane.

They are not workflow checkpoints.

Surfaces must not collapse these concepts into one generic `gate` model.

If both appear in the same UI, they must be presented as distinct concepts.

## Source Of Truth

The daemon is the only authority for:

- current domain selection state
- which controller actions are currently available
- which action targets they apply to
- why an action is disabled
- what follow-up input, if any, is required to execute an action
- which airport gate is bound to which target
- which gate focus intent is active and which focus state is observed

Surfaces must not synthesize workflow action availability from local heuristics.

Surfaces may derive presentation state locally, but executable action state, selection state, and airport gate state must come from daemon-owned projection.

## Controller Intent Model

Humans often think in stage language.

The surface contract must accommodate that language without mutating stage runtime state directly.

### Stage Intent Translation

When a controller says "start this stage", the daemon-owned surface must translate that request into one or more of the following valid intents:

- generate tasks for the currently eligible stage if no task runtime records exist yet
- resume the mission if mission lifecycle is paused
- queue one or more ready tasks in the eligible stage
- change launch policy for tasks in that stage so ready work autostarts

When a controller says "stop this stage", the daemon-owned surface must translate that request into one or more of the following valid intents:

- pause the mission so new work does not auto-launch
- panic stop the mission if active work must be interrupted
- cancel or terminate specific running sessions
- change launch policy for tasks in that stage so future ready work remains manual
- mark a task blocked if the controller is intentionally halting specific work

When a controller says "go back to this stage", the daemon-owned surface must translate that request into:

- reopen one or more earlier tasks, subject to downstream activity validation

The daemon must never interpret these intents as stage runtime mutation.

## Authoritative Action Families

The control surface contract must expose actions only from the following families.

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
- send engine-defined or controller-defined runtime commands to session

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

The daemon must publish controller actions as explicit command descriptors.

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

This is what the controller is currently looking at:

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

## Stage Projection Rules

Stage presentation is allowed.

Stage execution authority is not.

That means a control surface may present stage cards, stage lanes, or stage summaries as the primary mental model for the human in the Tower.

But the executable controls exposed from those projections must still resolve to mission, task, session, artifact, gate, or generation actions.

The control surface must therefore reflect the difference between:

- a stage as a presentation grouping
- a task as an executable work unit
- a mission as the lifecycle authority

If a stage appears actionable, the surface must make it clear whether that action really means:

- generate work for that stage
- start one or more ready tasks in that stage
- reopen earlier tasks associated with that stage
- pause or resume the whole mission

The surface must not imply that the stage itself is an independently running actor.

## Reopen, Pause, And Panic Semantics

The control surface must preserve the semantic distinction between task reopen, mission pause, and mission panic.

### Reopen

Reopen is a task or task-set mutation.

It is not a stage restart.

If the human wants to return to earlier work, the control surface may present that intent in stage language, but the executable action must still reopen the relevant tasks subject to workflow-engine validation.

### Pause

Pause is a mission-level orchestration state.

Pause prevents new work from auto-launching.

Pause does not mean that a stage is paused as an independent runtime object.

### Panic

Panic is a mission-level emergency stop path.

It is stronger than pause and may terminate or cancel active execution depending on runtime policy.

The control surface must not collapse panic into generic stage stop wording.

The control surface must therefore:

- present reopen as a backward workflow correction path
- present pause as a mission-wide scheduling control
- present panic as an emergency mission-wide interruption path

The control surface must not present reopen as "restart stage".

## Presentation And Interaction Rules

The command picker, toolbar, dock, and any future UI affordance must all be projections over the same daemon-published command set.

If the daemon does not publish an executable action, the surface must not invent one locally.

If the daemon publishes an action as disabled, the surface may still show it, but the disabled reason must remain daemon-authored.

The control surface may:

- group actions by the currently selected mission, stage, task, session, or artifact
- simplify language for humans
- hide raw internal identifiers when a clearer label exists

The control surface must not:

- reconstruct workflow policy locally
- treat stage projection state as enough to infer executable permissions
- create hidden compatibility aliases for removed stage commands

## Thin Client Rule

CLI Tower, VS Code views, webviews, and future clients are all thin clients over the same daemon-owned control contract.

That means:

- the daemon owns executable action truth
- the daemon owns disabled-state truth
- the daemon owns follow-up flow truth
- clients may differ in layout and presentation, but not in action authority

If one client exposes an action that another client cannot represent, the correct fix is to improve the shared daemon contract, not to add local client-only authority.

## Legacy Replacement

The following legacy concepts must be removed or rewritten where they remain in control-surface code or documentation:

- stage transition commands as executable runtime authority
- stage start or restart actions as first-class daemon commands
- stage pause or resume actions as first-class daemon commands
- client-local workflow command synthesis
- UI language that describes reopen as a stage restart when the real action is task reopen

## Acceptance Criteria

1. no control surface depends on `stage.transition.*` or equivalent stage runtime commands
2. daemon-published command descriptors are sufficient to drive control-surface action affordances without local workflow-policy reconstruction
3. stage projections may drive presentation grouping, but executable command scope remains mission, task, session, artifact, gate, or generation
4. all clients remain thin projections over one daemon-owned command contract
5. reopen, pause, panic, manual start, and launch-policy edits are all expressible through the control contract