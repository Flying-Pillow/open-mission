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
| `packages/core` | Main domain, daemon, workflow, runtime, client, settings, initialization | `Daemon`, `DaemonClient`, `MissionSystemController`, workflow engine, runtime adapters, types |
| `packages/airport` | Repository-scoped layout control and terminal substrate logic | `AirportControl`, airport types, substrate effects, terminal-manager controller |
| `apps/airport/terminal` | Airport terminal surfaces | airport entry routing, airport control connection, OpenTUI UI, Tower/Runway/Briefing Room surfaces |

## `packages/core` Internal Architecture

| Folder | Responsibility |
| --- | --- |
| `src/daemon` | IPC server, workspace routing, mission system control plane |
| `src/daemon/mission` | Mission aggregate wrappers such as `Mission`, `MissionTask`, `MissionSession`, and `Artifact` |
| `src/workflow/engine` | Workflow document, reducer ingestion, request execution, generation, validation |
| `src/runtime` | Provider-neutral runner, session, runtime types, and daemon-facing control helpers |
| `src/adapters` | Concrete runtime adapters and transports |
| `src/client` | IPC client and namespaced API surfaces |
| `src/settings` | Repository workflow settings initialization, patching, revision control, validation |
| `src/lib` | Path resolution, config helpers, operator targeting helpers |

## Package Boundary Rules

1. `packages/airport` must not absorb workflow semantics.
2. `apps/airport/terminal` must consume exported contracts rather than reaching into daemon internals.
3. `packages/core` is the main integration package that re-exports airport, daemon, runtime, and type surfaces.
4. `packages/mission` is the public npm distribution boundary for the Mission CLI and must compose publishable packages rather than monorepo-only root scripts.

## Public Export Surface

The current `packages/core/src/index.ts` re-exports:

- daemon client and API classes
- airport package exports
- runtime interfaces and concrete Copilot adapters
- repository initialization and config helpers
- daemon server and process control utilities
- settings surfaces
- top-level shared types

That makes `packages/core` the primary reusable runtime API surface for other Mission applications, while `packages/mission` is the public CLI distribution package.