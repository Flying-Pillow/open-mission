---
layout: default
title: Agent Runtime
parent: Architecture
nav_order: 6
---

# Agent Runtime

The agent runtime is the provider-neutral execution layer that satisfies workflow session requests. It is deliberately separate from workflow semantics and from airport/layout semantics.

## Primary Components

| Component | Responsibility | Owned state | Runtime boundary |
| --- | --- | --- | --- |
| `AgentRunner` | Contract implemented by each provider adapter | none at interface level | Provider-specific |
| `AgentSession` | Live session object with prompt, command, cancel, and terminate operations | provider-backed session state | Provider-specific |
| `AgentSessionOrchestrator` | Registers runners, starts or attaches sessions, listens for normalized session events | runner registry, attached sessions, optional store coordination | Daemon/runtime |
| `PersistedAgentSessionStore` | Optional persistence hook for session references and snapshots | implementation-defined | Daemon runtime |
| `TerminalAgentTransport` | Terminal-oriented transport bridge for runtime adapters | transport-specific session handles | Runtime transport |
| `CopilotCliAgentRunner` / `CopilotSdkAgentRunner` | Current concrete adapters | adapter-local state | Copilot provider APIs |

## Lifecycle Contract

The orchestrator normalizes provider runtime into a consistent session snapshot lifecycle.

| Runtime phase | Meaning |
| --- | --- |
| `starting` | Session was requested and is booting |
| `running` | Session accepts work or is actively executing |
| `completed` | Session reached a successful terminal state |
| `failed` | Session ended unsuccessfully |
| `cancelled` | Session was cancelled intentionally |
| `terminated` | Session was force-terminated or could not be reattached |

## Session Start Boundary

The workflow engine provides a structured `AgentSessionStartRequest` including mission id, task id, working directory, transport id, and initial prompt. The runtime chooses the correct runner, injects any MCP server references the runner supports, and returns a live `AgentSession`.

## Runtime Event Boundary

Runtime adapters emit normalized `AgentSessionEvent` values. The request executor translates those events into workflow events so that the workflow engine remains the authority for mission state.

That means:

- provider events are never written straight into `mission.json`
- provider event streams are not UI truth by themselves
- provider snapshots become mission truth only after workflow ingestion

## Optional Persistence Hook

`AgentSessionOrchestrator` supports an optional `PersistedAgentSessionStore`. The hook exists to persist session references and snapshots outside `mission.json`, but the core interface is optional and implementation-specific. The workflow architecture therefore treats provider session persistence as a runtime concern, not as the canonical mission history.

## Invariants

1. The workflow engine chooses when sessions should start or stop.
2. Runners translate provider protocol; they do not define workflow policy.
3. Session control uses normalized Mission prompts and commands, not provider-native slash commands as the core contract.
4. Runtime session state must be reconciled back through workflow events before it becomes mission truth.

## Adjacent Components

- See [workflow-engine.md](./workflow-engine.html) for how runtime events are ingested into mission state.
- See [contracts.md](./contracts.html) for session-related IPC methods.
- See [airport-control-plane.md](./airport-control-plane.html) for how agent sessions are projected into the `agentSession` gate.
