---
layout: default
title: Agent Runtime
parent: Execution
nav_order: 1
---

# Agent Runtime

This document defines the active Mission-owned agent runtime.

Mission orchestrates external coding-agent CLIs. It does **not** delegate runtime ownership to a third-party adapter package, and it does **not** materialize per-agent MCP config files into repository workspaces.

## Relationship To Other Specifications

Read this document alongside the workflow engine and Airport control-plane specifications.

Priority rule:

1. the workflow engine specification owns mission truth, workflow events, and reducer-emitted execution requests
2. the Airport control-plane specification owns daemon control surfaces and terminal projections
3. this runtime specification owns the Mission runtime boundary that launches, tracks, and signals agent sessions

If this document is interpreted to give workflow policy, mission state, Airport layout, or operator command legality to a runner implementation, that interpretation is wrong.

## Runtime Ownership Model

Mission owns one active runtime path for agent coders:

1. `AgentRunner` and `AgentSession` define the provider-neutral lifecycle contract.
2. Mission-owned PTY-backed runner implementations launch the supported coder CLIs directly.
3. Mission-owned stream parsers convert runner output into typed observations.
4. Mission-owned signal routing and policy decide what becomes runtime messages, snapshots, or session-state changes.

There is no external Sandcastle dependency in the active runtime path.

There is no Mission-owned `AgentProviderAdapter`, `SandcastleAgentRunner`, or equivalent compatibility layer that delegates launch planning or parsing to a third-party runtime package.

## Supported Runner Implementations

Mission currently owns these runner implementations directly in `packages/core/src/daemon/runtime/agent/runtimes/**`:

| Runner id | Ownership model | Primary transport | Notes |
| --- | --- | --- | --- |
| `copilot-cli` | Mission-owned trusted CLI runner | PTY terminal | Separate from the four coder runners below. |
| `claude-code` | Mission-owned direct CLI runner | PTY terminal | Mission constructs CLI flags and parses structured output directly. |
| `pi` | Mission-owned direct CLI runner | PTY terminal | Mission constructs CLI flags and parses structured output directly. |
| `codex` | Mission-owned direct CLI runner | PTY terminal | Mission constructs CLI flags and parses structured output directly. |
| `opencode` | Mission-owned direct CLI runner | PTY terminal | Mission constructs CLI flags directly; structured output remains intentionally minimal. |

The command-building and stream-parsing behavior for these runners may be **adapted from upstream reference behavior**, but the executable launch logic that Mission ships and validates is Mission-owned code.

## Mission-Owned Responsibilities

Mission core and daemon own:

- runner registration and runner-id legality
- launch validation
- authoritative working directory selection
- PTY transport, attach, reconnect, resize, and terminal logging
- session lifecycle truth (`starting`, `running`, `awaiting-input`, `completed`, `failed`, `cancelled`, `terminated`)
- normalized session snapshots and events
- structured observation routing
- signal policy and promotion rules
- Mission MCP server lifecycle
- MCP session registration and cleanup
- MCP acknowledgement semantics
- instruction-guided MCP usage and strict fallback protocol markers
- Airport-facing interaction-mode projection

## Runner-Owned Responsibilities

Each Mission-owned runner implementation owns only executable-specific behavior:

- validating runner-specific metadata such as model or effort values
- translating `AgentLaunchConfig` into the concrete CLI command, args, and env
- parsing structured runtime output from that CLI when available
- reporting runner-specific observations back into Mission's signal router

Runner implementations do **not** own workflow policy, task completion truth, verification truth, Airport behavior, or Mission state transitions.

## Structured Launch Contract

Mission launches agent work with a structured contract rather than a provider-specific prompt blob.

```ts
export interface AgentLaunchConfig {
  missionId: string;
  workingDirectory: string;
  requestedRunnerId?: AgentRunnerId;
  task: AgentTaskContext;
  specification: AgentSpecificationContext;
  resume:
    | { mode: 'new' }
    | { mode: 'attach-or-create'; previousSessionId?: AgentSessionId }
    | { mode: 'attach-only'; previousSessionId: AgentSessionId };
  initialPrompt?: {
    source: 'engine' | 'operator' | 'system';
    text: string;
    title?: string;
  };
  metadata?: AgentMetadata;
}
```

Rules:

1. `requestedRunnerId` is advisory.
2. Mission runtime or daemon control resolves the concrete runner.
3. `task.instruction` remains the execution-ready instruction.
4. `metadata` is the only supported escape hatch for runner-specific knobs such as model or reasoning effort.
5. Provider-specific metadata must not become first-class Mission semantics unless it is genuinely cross-runner.

## Interaction Modes

Mission derives operator interaction capabilities from the live session state, not from provider branding.

Supported interaction modes:

- `pty-terminal`: live terminal-backed session; Airport preserves the current attach/input/resize/reconnect behavior
- `agent-message`: structured follow-up path for non-terminal sessions that honestly support it
- `read-only`: session no longer accepts follow-up input

The PTY terminal remains the primary UX for interactive coder sessions. A structured composer must never replace the active terminal for a live PTY session.

## Mission MCP Signaling

Mission owns one active MCP signaling path:

1. `MissionMcpSignalServer` owns local-only MCP server lifecycle.
2. `MissionMcpSessionRegistry` owns token registration, scoping, and idempotency.
3. `MissionMcpSignalTools` owns lean tool names, validation, and acknowledgement payloads.
4. `AgentSessionMcpAccessProvisioner` owns session registration plus launch-env handoff for supported runners.
5. `MissionMcpRunnerLaunchSupport` owns runner-native launch adaptation for providers that need extra MCP wiring beyond raw session env.
6. `MissionAgentRuntimeProtocolLaunchContext` owns the instruction text that tells agents to use Mission MCP first and fall back to strict Mission protocol markers when needed.

Mission uses a checked-in project MCP entry that passes only `MISSION_MCP_ENDPOINT` and `MISSION_MCP_SESSION_TOKEN` to the local bridge. The daemon resolves the session token to mission/task/session scope, allowed tools, and idempotency state.

When Mission wires a local MCP bridge into a runner, it targets the Mission-owned `mission-command` entry point and may resolve that entry point to a concrete local executable path instead of assuming a globally installed `mission-command` binary is already on `PATH`.

Mission does **not** persist per-session MCP credentials, session tokens, session ids, or endpoint secrets into tracked repository files, and does **not** mutate user-global runner settings as part of routine runtime provisioning.

Mission does **not** assume one universal `.agents/mcp.json`.

Mission does **not** write per-session MCP credentials, session tokens, session ids, or endpoint secrets into tracked repository files.

## Observation And Promotion Rules

Mission treats all runner output as observations until Mission policy evaluates it.

Allowed observation sources:

- daemon-authoritative runtime state
- validated Mission MCP tool calls
- runner-structured output parsing
- strict Mission protocol markers
- terminal heuristics

Promotion rules:

1. runner output may produce messages, usage, or diagnostics
2. MCP acknowledgements do not prove verification or completion
3. agent-declared completion and ready-for-verification remain advisory
4. terminal heuristics are diagnostic only
5. only Mission signal policy may update session snapshots or emit authoritative runtime events

## Non-Goals

This runtime does not attempt to own:

- package installation or login/bootstrap flows for external CLIs
- provider-specific slash-command discovery as Mission semantics
- remote MCP services or hosted endpoints
- per-agent config-file mutation paths
- sandbox, worktree, branch, or orchestration ownership delegated to a third-party runtime package

## Compatibility Policy

Mission preserves:

- the Mission-owned PTY transport
- current Airport terminal behavior
- Mission-owned lifecycle truth
- Mission-owned logs and snapshot/event emission
- Mission-owned interaction-mode projection
- Mission-owned MCP lifecycle, session registration, and acknowledgement semantics

Mission does **not** preserve:

- obsolete Sandcastle-backed adapter layers
- direct Pi-only legacy command-building paths as a parallel truth
- per-agent MCP config materializers
- any second runtime path that competes with the Mission-owned direct runner implementations
