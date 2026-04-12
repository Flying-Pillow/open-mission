---
layout: default
title: Contracts And State Surfaces
parent: Architecture
nav_order: 9
---

# Contracts And State Surfaces

Mission exposes two public contract families:

1. daemon IPC methods and event messages
2. persisted state documents consumed by the daemon and workflow engine

## IPC Namespaces

The daemon protocol is context-first rather than object-wrapper-first.

| Namespace | Current methods | Meaning |
| --- | --- | --- |
| `ping` | `ping` | Protocol compatibility and daemon health |
| `airport.*` | `airport.status`, `airport.client.connect`, `airport.client.observe`, `airport.pane.bind` | Repository airport status and layout control |
| `control.*` | `control.status`, `control.settings.update`, `control.document.*`, `control.workflow.settings.*`, `control.repositories.*`, `control.issues.list`, `control.action.*` | Repository-scoped control plane operations |
| `mission.*` | `mission.from-brief`, `mission.from-issue`, `mission.status`, `mission.action.*`, `mission.gate.evaluate` | Mission creation and mission aggregate operations |
| `task.*` | `task.launch` | Task-scoped runtime launch |
| `session.*` | `session.list`, `session.console.state`, `session.prompt`, `session.command`, `session.cancel`, `session.terminate` | Live session control |

## Client Surface

| Client class | Responsibility |
| --- | --- |
| `DaemonClient` | Low-level IPC connection, request correlation, event subscription |
| `DaemonApi` | Namespaced facade over airport, control, and mission APIs |
| `DaemonAirportApi` | Airport-focused convenience methods |
| `DaemonControlApi` | Control-plane methods |
| `DaemonMissionApi` | Mission, task, and session methods |

## `MissionSystemSnapshot`

This is the daemon-wide live composite snapshot returned to surfaces.

| Field | Meaning |
| --- | --- |
| `state.version` | Monotonic version for the composite daemon state |
| `state.domain` | `ContextGraph` for selection and semantic routing |
| `state.missionOperatorViews` | Mission dashboard projections used to populate stage rail and tree nodes |
| `state.airport` | Active repository airport state |
| `state.airports` | Registry of repository airports known to the daemon |
| `airportProjections` | Active repository pane projections |
| `airportRegistryProjections` | Projections for each known repository airport |

## `mission.json`

`mission.json` is the persistent workflow record for one mission.

| Section | Purpose |
| --- | --- |
| `configuration` | Frozen workflow settings snapshot used for the mission |
| `runtime` | Current lifecycle, stage, task, session, gate, pause, and panic state |
| `eventLog` | Append-only workflow event history |

## `.mission/settings.json`

The repository settings document currently combines:

- daemon defaults such as agent runner and theme
- repository workflow settings
- persisted airport intent

This means repository policy and layout intent share one repository-scoped settings file, while mission execution remains isolated in `mission.json`.

## Operator Action Contracts

Mission uses operator action descriptors rather than hard-coding all surface flows. `OperatorActionDescriptor` can carry:

- scope and target ids
- enablement and disabled reasons
- optional flow descriptors for multi-step actions
- UI metadata for confirmation or presentation targeting

These descriptors are the contract between daemon-side action availability and Tower-side command flow UX.

### Action Ordering And Filtering Ownership

`OperatorActionDescriptor[]` is not just a bag of invokable operations. It is an ordered daemon response.

The action model is:

- the daemon constructs the full action set for the current mission or control scope
- the daemon applies lifecycle and policy rules to determine whether each action is enabled
- the daemon filters actions by the current target context such as session, task, stage, or mission
- the daemon orders the remaining actions according to workflow semantics, for example blocker resolution first and then closest target affinity
- Tower renders that ordered list as command rows, toolbar items, and typed slash resolution

This means ownership is intentionally split as follows:

- **Daemon responsibilities:** action construction, enablement, disabled reasons, context filtering, and presentation ordering
- **Tower responsibilities:** projecting daemon actions into UI controls, preserving daemon order, local focus state, and optional text-query narrowing of the already ordered list

Tower must not introduce its own business ranking such as command-specific sorting or local "most likely next action" heuristics. If Mission needs smarter next-action ordering, that policy belongs in the daemon action builder.

### Action Versus Command

Mission uses the terms `action` and `command` in different layers. They should not be treated as synonyms.

- **Action** means a daemon-defined operator operation. It is canonical, rule-checked, context-scoped, and identified by `OperatorActionDescriptor.id`.
- **Action text** means the slash-text alias attached to an action in `OperatorActionDescriptor.action`, for example `/mission resume` or `/launch`.
- **Command** in Tower means an operator-facing interaction form: typed slash input, a picker row, or a toolbar entry derived from an action.
- **Session command** means the payload sent to a live agent through `session.command`. That is runtime session control, not an operator action descriptor.

The intended architecture is:

- the daemon constructs actions
- Tower renders actions as commands
- operator input resolves back to an action by matching action text
- session commands remain a separate runtime contract

If a behavior only exists as Tower-side command handling and not as a daemon action, that is a layering bug.
