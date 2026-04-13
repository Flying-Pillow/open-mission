---
layout: default
title: Package Map
parent: Architecture
nav_order: 11
---

# Package Map

Mission's architecture is split along package boundaries that mirror its runtime boundaries.

## Top-Level Packages And Applications

| Package or app | Architectural role | Key exports or modules |
| --- | --- | --- |
| `packages/mission` | Published CLI distribution package | `mission`, `missiond`, CLI entry wiring |
| `packages/core` | Main domain package for daemon service, mission/repository/workspace domains, agent runtime wiring, workflow, client, and settings | `Daemon`, `DaemonClient`, `MissionSystemController`, mission aggregate, workflow engine, runtime/process control, types |
| `packages/airport` | Repository-scoped layout control and terminal substrate logic | `AirportControl`, airport types, substrate effects, terminal-manager controller |
| `apps/airport/terminal` | Airport terminal surfaces | airport entry routing, airport control connection, OpenTUI UI, Tower/Runway/Briefing Room surfaces |

## `packages/core` Internal Architecture

| Folder | Responsibility |
| --- | --- |
| `src/daemon` | IPC server, daemon protocol, system control-plane coordination, and daemon process/runtime entrypoints |
| `src/workspace` | Repository discovery, workspace routing, and repository-scoped control facade (`WorkspaceManager`, `MissionWorkspace`) |
| `src/mission` | Mission aggregate wrappers such as `Mission`, `MissionTask`, `MissionSession`, and `Artifact` |
| `src/repository` | Repository initialization and bootstrap preparation services |
| `src/agent` | Agent abstractions, sessions/events, runtime IDs, concrete runners, and default runtime factory wiring |
| `src/workflow/engine` | Workflow document, reducer ingestion, request execution, generation, validation |
| `src/client` | IPC client and namespaced API surfaces |
| `src/settings` | Repository workflow settings initialization, patching, revision control, validation |
| `src/lib` | Shared helpers (paths, config helpers, operator targeting, repo/workspace utilities) |
| `src/platforms` | External platform adapters (for example GitHub integration) |
| `src/workflow/templates/mission` | Mission workflow template repository and rendering |

## Package Boundary Rules

1. `packages/airport` must not absorb workflow semantics.
2. `apps/airport/terminal` must consume exported contracts rather than reaching into daemon internals.
3. `packages/core` is the main integration package that re-exports airport, daemon, runtime, and type surfaces.
4. `packages/mission` is the public npm distribution boundary for the Mission CLI and must compose publishable packages rather than monorepo-only root scripts.

## Public Export Surface

The current `packages/core/src/index.ts` re-exports:

- daemon client and API classes
- airport package exports
- agent runtime IDs and runtime-related helpers
- repository initialization and config helpers
- daemon server and process control utilities
- settings surfaces
- shared types

That makes `packages/core` the primary reusable runtime API surface for other Mission applications, while `packages/mission` is the public CLI distribution package.