---
layout: default
title: Daemon And System Control Plane
parent: Architecture
nav_order: 4
---

# Daemon And System Control Plane

The daemon is the root runtime authority for Mission's live system behavior. It owns the IPC server, repository scoping, mission routing, airport registry, and composite system snapshot that surfaces consume.

## Primary Components

| Component | Responsibility | Owned state | Downstream consumers |
| --- | --- | --- | --- |
| `Daemon` | IPC server, request dispatch, event broadcast | sockets, connected clients, runner registry, system controller | Tower and any daemon clients |
| `WorkspaceManager` | Repository discovery, workspace instantiation, mission routing | `MissionWorkspace` map, mission-to-workspace index, registered roots | `Daemon`, `MissionSystemController` |
| `MissionWorkspace` | Repository-scoped control and mission execution facade | repository-local mission loading and control operations | `WorkspaceManager` |
| `MissionSystemController` | Live daemon-wide control-plane reducer | version, `MissionControl`, `RepositoryAirportRegistry` | `Daemon`, surfaces |
| `MissionControl` | Semantic domain graph and selection state | `ContextGraph`, mission operator projections | `MissionSystemController` |
| `RepositoryAirportRegistry` | Multi-repository airport loading and persistence | airport records, client-to-repository index, active repository id | `MissionSystemController` |
| Projection service logic | Derives airport projections from domain graph and airport state | pure projection output | `MissionSystemController` |

## Request Routing Model

```mermaid
flowchart TD
 Request[IPC request] --> Daemon
 Daemon -->|airport.*| System[MissionSystemController]
 Daemon -->|control.* and mission.*| Workspace[WorkspaceManager]
 Workspace --> Control[MissionWorkspace control methods]
 Workspace --> Mission[Mission aggregate]
 Mission --> Workflow[MissionWorkflowController]
 Daemon --> Decorate[Attach MissionSystemSnapshot]
 Decorate --> Response[IPC response or event]
```

## Boundary Responsibilities

### `Daemon`

- Accepts newline-delimited JSON IPC messages.
- Routes `airport.*` to `MissionSystemController`.
- Routes all other control and mission methods through `WorkspaceManager`.
- Broadcasts stateful notifications to all connected clients.
- Decorates mission status responses with a fresh `MissionSystemSnapshot` when a workspace can be resolved.

### `WorkspaceManager`

- Resolves the control root from `surfacePath` or `missionId`.
- Registers real repositories into the machine-local Mission config.
- Creates one `MissionWorkspace` per repository root.
- Maintains the mission-to-workspace index used to route `mission.*`, `task.*`, and `session.*` calls.

### `MissionSystemController`

- Synchronizes semantic domain state and airport state.
- Plans airport substrate effects and applies them through the airport registry.
- Samples observed substrate state and folds it back into airport state.
- Increments the daemon system version when the composite control-plane state changes.

## Persisted And Non-Persisted State

| State | Persisted | Where |
| --- | --- | --- |
| Registered repositories and local tool defaults | Yes | Mission config under `~/.config/mission/config.json` or `$XDG_CONFIG_HOME/mission/config.json` |
| Repository airport intent | Yes | `.mission/settings.json` under the `airport` field |
| Composite daemon snapshot | No | Rebuilt in memory from workspace, mission, and airport state |
| Client connections | No | `Daemon` runtime only |

## Non-Responsibilities

The daemon does not make Tower the source of truth. It does not let zellij define mission state. It does not store mission execution truth inside daemon-only memory.

## Relationship To Other Pages

- See [workflow-engine.md](./workflow-engine.html) for mission execution truth.
- See [airport-control-plane.md](./airport-control-plane.html) for repository-scoped layout authority.
- See [contracts.md](./contracts.html) for IPC namespaces.
