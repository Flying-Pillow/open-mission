---
layout: default
title: Contracts And State Surfaces
parent: Architecture
nav_order: 9
---

<!-- /docs/architecture/contracts.md: Reference for daemon IPC contracts and the rule that Airport web gateway contracts must wrap existing daemon and terminal runtime surfaces rather than redefining them. -->

# Contracts And State Surfaces

Mission exposes three public contract families:

1. daemon IPC methods and event messages
2. Entity remote contracts for queries, commands, and event payloads
3. persisted state documents consumed by the daemon and workflow engine

## IPC Namespaces

The daemon protocol is context-first rather than object-wrapper-first.

| Method | Meaning |
| --- | --- |
| `ping` | Protocol compatibility and daemon health |
| `event.subscribe` | Subscribe to daemon-published Entity and runtime event channels |
| `system.status` | Read daemon-wide status |
| `entity.query` | Execute a schema-validated Entity query through an Entity contract |
| `entity.command` | Execute a schema-validated Entity command or mutation through an Entity contract |

All Entity behavior is expressed through Entity contracts and the small system/event method set above.

## Client Surface

| Client surface | Responsibility |
| --- | --- |
| `DaemonClient` | Low-level IPC connection, request correlation, event subscription |
| `DaemonApi` | Small typed wrapper over `ping`, `event.subscribe`, `system.status`, `entity.query`, and `entity.command` |
| Entity contracts | Define payload/result schemas and execution metadata for `Mission`, `Stage`, `Task`, `Artifact`, `AgentSession`, and `Repository` |

## Airport Web Gateway Rule

The Airport web surface may define browser-facing transport contracts for its own gateway, but those contracts are wrappers over existing runtime surfaces rather than additions to the daemon IPC contract.

That means:

- request-response browser endpoints must proxy existing daemon methods
- browser event streams must forward existing daemon notifications
- browser terminal relay contracts must wrap the existing terminal runtime and terminal-manager behavior already present in the repository

The web gateway must not silently invent a second daemon API family. For Entity work, the browser-facing route forwards `{ entity, method, payload }` to daemon `entity.query` or `entity.command` and lets the daemon-side Entity contract validate the payload and result.

## `MissionSystemSnapshot`

This is the daemon-wide live composite snapshot returned to surfaces.

| Field | Meaning |
| --- | --- |
| `state.version` | Monotonic version for the composite daemon state |
| `state.domain` | `ContextGraph` for selection and semantic routing |
| `state.missionOperatorViews` | Mission dashboard projections used to populate stage rail and tree nodes |
| `state.airport` | Active repository airport state |
| `state.airports` | Registry of repository airports known to the daemon |
| `airportViews` | Active repository pane views |
| `airportRegistryViews` | Views for each known repository airport |

## `mission.json`

`mission.json` is the persistent workflow record for one mission.

| Section | Purpose |
| --- | --- |
| `configuration` | Frozen workflow settings snapshot used for the mission |
| `runtime` | Current lifecycle, stage, task, session, gate, pause, and panic state |

The append-only workflow event history is persisted as the Mission runtime event log beside `mission.json`; it is not an inline `eventLog` field in Mission runtime data.

`mission.json` stores schema-validated workflow-facing session truth.

It does not store provider-native control protocol.

## `.mission/settings.json`

The repository settings document currently combines:

- daemon defaults such as agent runner and theme
- persisted airport intent

Repository workflow content now lives separately under `.mission/workflow/`.

## `.mission/workflow/`

The repository workflow preset is split into:

- `.mission/workflow/workflow.json` for the serializable workflow definition
- `.mission/workflow/templates/` for repository-owned stage and task templates

This means repository control settings, repository workflow content, and mission execution remain explicit as separate persisted contracts.

## Entity Command Contracts

Mission command contracts are command-native:

- Entity snapshots advertise `EntityCommandDescriptor` values.
- `commandId` is the canonical operation identifier end to end.
- Airport renders and forwards command descriptors without translating command identity.
- Mission and child Entities validate and execute commands through their Entity contracts.
- Command payloads carry `commandId` and optional `input` as the only semantic operation identifier.

Use [entity-command-surface.md](./entity-command-surface.html) as the current reference for Mission, Stage, Task, Artifact, and AgentSession command contracts and command-flow diagrams.

## Command Acceptance Semantics

The daemon-side contract for operator commands is intentionally narrow:

1. A validated command is accepted at one authority boundary only: the Entity contract for that command.
2. Mission-tree commands are executed by the authoritative Entity or delegated to the Running Mission aggregate when the behavior changes aggregate workflow state.
3. Command completion is split in two parts: request-response acknowledgement means the command was accepted and attempted, while asynchronous side effects complete later and are reported through subsequent emitted events or follow-up reads.
4. Invalid commands must return explicit error responses and must not emit state-changing events.
5. Commands that can be retried across process boundaries should become idempotent or carry a client-generated `requestId` so duplicate submissions can be ignored or coalesced safely.

This keeps the request-response layer small while preserving Entity authority over command validation and behavior.

## Observation Reconciliation Rule

Airport observations are authoritative for observed substrate state. If an observation conflicts with previously recorded intent for the same observed field, the observed state wins until a new explicit command asserts new intent.
