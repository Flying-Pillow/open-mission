---
layout: default
title: Agent Execution Refactor Spec
parent: Architecture
nav_order: 7
description: Temporary working spec for the Agent, AgentAdapter, AgentExecutor, AgentExecution, and Terminal refactor.
---

## Temporary Agent Execution Refactor Spec

This is the working spec for the current Agent, AgentAdapter, AgentExecutor, AgentExecution, and Terminal refactor.

It is temporary on purpose. It exists to prevent implementation drift while the refactor is in flight. When the code converges, fold the useful parts back into the permanent architecture register and delete this file.

## Vocabulary Decision

Mission uses these active concepts:

- `Agent`: the Mission-visible capability that can perform work.
- `AgentAdapter`: the narrow provider-specific translation object owned by one Agent.
- `AgentExecutor`: the daemon-owned lifecycle coordinator that executes Agents through their adapters.
- `AgentExecution`: one concrete run of one Agent under an explicit execution scope.
- `Terminal`: the daemon-addressable Entity facade for one PTY-backed terminal resource.
- `TerminalRegistry`: the Terminal Entity boundary registry and in-memory authority for process, screen, input, resize, exit state, and update publication.

An execution scope may be system, repository, mission, task, or artifact. Mission and task are common workflow scopes, not mandatory AgentExecution roots.

Mission does not use `AgentRuntime` as canonical vocabulary. The current `AgentRuntime` class is duplicate lifecycle vocabulary and must be deleted.

Mission does not introduce `ProviderAdapter`. Provider-specific translation is `AgentAdapter`.

## Ownership Map

```text
entities/Agent
  Agent entity only

entities/AgentExecution
  AgentExecution entity
  AgentExecution schema and contract
  AgentExecutionProtocolTypes

entities/Terminal
  Terminal entity
  Terminal schema and contract
  TerminalRegistry

daemon/runtime/agent
  AgentExecutor
  AgentExecutionLogWriter
  MCP execution provisioning
  observation routing
  signal policy
  provider observation vocabulary

daemon/runtime/agent/adapters
  Copilot, Claude Code, Codex, Pi, OpenCode AgentAdapters

daemon/runtime/terminal
  TerminalScreen
  screen substrate helpers

workflow/engine
  emits execution requests
  delegates runtime work to AgentExecutor through the request executor
```

## Responsibilities

### Agent

Agent belongs in `packages/core/src/entities/Agent`.

Agent owns:

- `agentId` and display name
- availability and capability metadata
- configuration metadata used to select/use the Agent
- Entity query/read surface
- reference to exactly one AgentAdapter

Agent does not own:

- PTY launch
- TerminalRegistry
- MCP provisioning
- signal policy
- runtime output routing
- AgentExecution lifecycle mutation

### AgentAdapter

AgentAdapter belongs in `packages/core/src/daemon/runtime/agent/adapters`.

AgentAdapter owns:

- adapter-specific metadata validation
- `AgentLaunchConfig` to command/args/env translation
- provider-structured output parsing
- provider-specific observation creation

AgentAdapter does not own:

- lifecycle truth
- TerminalRegistry or PTY process mechanics
- MCP server lifecycle or session registration
- AgentExecution creation or mutation
- Mission workflow state transitions
- Airport behavior
- signal promotion policy

### AgentExecutor

AgentExecutor belongs in `packages/core/src/daemon/runtime/agent`.

AgentExecutor owns:

- resolving the requested Agent through AgentRegistry
- asking the Agent's AgentAdapter for launch translation
- daemon-owned MCP execution provisioning
- opening or reconciling TerminalRegistry terminals for terminal-backed executions
- creating live AgentExecution snapshots for terminal-backed execution
- wiring TerminalRegistry updates into `AgentExecution.attachTerminal(...)`
- routing adapter, MCP, protocol-marker, and terminal observations
- applying AgentExecutionSignalPolicy
- exposing start, reconcile, prompt, command, cancel, and terminate operations

AgentExecutor is the only active daemon lifecycle path for Agent executions.

AgentExecutor contains the private per-execution terminal controller behavior. It opens or attaches one TerminalRegistry terminal, creates the AgentExecution with a Terminal reference, and wires TerminalRegistry updates into `AgentExecution.attachTerminal(...)`. There is no separate binding class because the behavior is executor-owned coordination, not a standalone domain concept.

AgentExecutionLogWriter is daemon runtime infrastructure. It may subscribe to TerminalRegistry updates to persist Agent execution logs, but AgentExecution Entity files do not own that subscription.

### AgentExecution

AgentExecution belongs in `packages/core/src/entities/AgentExecution`.

AgentExecution owns:

- execution identity
- explicit execution scope
- durable execution state
- context and log references
- progress and attention state
- terminal handle reference
- terminal-backed execution state transitions from terminal output and exit events
- structured message surface
- protocol payloads, snapshots, references, prompts, commands, and events

AgentExecution does not own:

- `node-pty`
- TerminalRegistry lookup
- process spawning or killing
- MCP provisioning
- adapter output parsing
- signal policy application
- workflow task ownership

### Terminal And TerminalRegistry

Terminal Entity and TerminalRegistry belong in `packages/core/src/entities/Terminal`.

Terminal owns:

- daemon command/query contract for terminal read and input
- terminal snapshot shape exposed across Entity remote boundaries
- generic terminal input and resize command validation
- TerminalRegistry as the live in-memory registry for terminal IO and update publication

Terminal does not own:

- AgentExecution lifecycle state
- Agent adapter launch translation
- Mission workflow state
- provider output parsing

TerminalRegistry owns:

- terminal registration
- open, attach, read, resize, input, kill, and update publication
- process lease
- screen state
- exit state
- terminal snapshot/update events

Daemon runtime terminal modules under `packages/core/src/daemon/runtime/terminal` own only screen substrate behavior. TerminalRegistry owns live Terminal process leases, PTY IO, snapshots, and update publication. Agent execution modules may bind to TerminalRegistry terminals through AgentExecutor and `AgentExecution.attachTerminal(...)`, but they do not become authoritative for terminal truth.

Terminal may carry owner metadata for an AgentExecution, Mission, task, repository, or system operation. Owner metadata does not make Terminal a Mission Entity.

## Active Refactor Decisions

1. `AgentExecutionProtocolTypes` belongs in `entities/AgentExecution`.
2. `AgentExecutionProtocolTypes` must define explicit AgentExecutionScope for system, repository, mission, task, and artifact execution.
3. Delete `daemon/runtime/agent/AgentExecutionProtocolTypes.ts`; do not keep a compatibility export.
4. Delete `daemon/runtime/agent/AgentRuntime.ts`.
5. Replace `daemon/runtime/agent/AgentAdapter.ts` with the narrow adapter contract.
6. Move lifecycle, TerminalRegistry, MCP provisioning, signal policy, and live AgentExecution mutation out of `entities/Agent/AgentAdapter.ts`.
7. Split or rename `daemon/runtime/agent/adapters/AgentPtyAdapter.ts` because the current name hides executor responsibilities.
8. Move configured runtime construction out of `entities/Agent/AgentRegistry.ts` into daemon composition or AgentExecutor setup.
9. Extract TerminalRegistry and process supervision out of `entities/AgentExecution/AgentExecution.ts` into the Terminal Entity boundary, with AgentExecutor coordinating lifecycle use.
10. Promote Terminal to a first-class Entity so AgentExecution and Airport surfaces no longer import agent runtime glue to read or write terminal state.

## Removed Swamp

The implementation had overlapping lifecycle concepts:

- `entities/Agent/AgentAdapter.ts`: concrete PTY/MCP/signal lifecycle implementation in an Entity folder.
- `daemon/runtime/agent/AgentRuntime.ts`: duplicate lifecycle abstraction.
- `daemon/runtime/agent/AgentAdapter.ts`: duplicate lifecycle abstraction with adapter naming.
- `daemon/runtime/agent/adapters/AgentPtyAdapter.ts`: runtime-side copy that still owns lifecycle behavior under an adapter name.

The target is one lifecycle owner: `AgentExecutor`, with TerminalRegistry inside the Terminal Entity boundary as terminal authority, Terminal as the Entity command surface for terminal IO, and `AgentExecution.attachTerminal(...)` owning the AgentExecution state transitions caused by terminal output and exit.

## Implementation Sequence

1. Keep `AgentExecutionProtocolTypes` in `entities/AgentExecution` and ensure all active imports use that path.
2. Add explicit AgentExecutionScope before implementing AgentExecutor so the new lifecycle owner does not bake in Mission/task assumptions.
3. Delete `AgentRuntime` and update tests/fakes to stop extending it.
4. Rewrite runtime-side `AgentAdapter` as the narrow provider translation contract.
5. Create `AgentExecutor` and move PTY/MCP/signal lifecycle behavior into it.
6. Reduce provider adapter files to launch translation and output parsing.
7. Make workflow and daemon control call AgentExecutor.
8. Remove the Entity-side concrete AgentAdapter implementation.
9. Extract remaining TerminalRegistry/process supervision out of AgentExecution Entity into the Terminal Entity boundary.
10. Promote Terminal to a first-class Entity and route AgentExecution terminal reads/input through that Entity.

Do not introduce aliases, compatibility exports, duplicate old/new names, or parallel lifecycle paths while executing this sequence.
