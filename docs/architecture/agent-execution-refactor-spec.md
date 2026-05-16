---
layout: default
title: Agent Execution Refactor Spec
parent: Architecture
nav_order: 7
description: Temporary working spec for the AgentExecution clean sweep and runtime-boundary convergence.
---

## Temporary Agent Execution Refactor Spec

> Current authority: `AgentExecution` is the canonical in-memory Entity instance and owner of the Agent execution process. `Terminal` is optional transport. `AgentExecutionRegistry` provides active lookup and process-handle plumbing. Live process state is modeled through AgentExecution process state rather than a separate runtime doctrine.

This is the working spec for the current AgentExecution clean sweep.

It is temporary on purpose. It exists to prevent implementation drift while the refactor is in flight. When the code converges, fold the useful parts back into the permanent architecture register and delete this file.

## Current Cleanup Rule

- Converge `Repository` and `AgentExecution` first.
- Keep `AgentExecution` narrow and canonical while deprecated Mission, Task, or workflow-era compatibility surfaces converge to it.
- `AgentExecutionSchema.ts` stays canonical-only.
- Any remaining live process-state or event vocabulary belongs behind AgentExecution and the daemon registry boundary as implementation detail.
- If a consumer still requires compatibility-only fields such as task labels, working directory projections, or duplicate lifecycle aliases, treat that as consumer debt to remove rather than a reason to expand the Entity schema.

## Vocabulary Decision

Mission uses these active concepts:

- `Agent`: the Mission-visible capability that can perform work.
- `AgentAdapter`: the narrow provider-specific translation object owned by one Agent.
- `AgentExecution`: one concrete run of one Agent under an explicit execution scope.
- `Terminal`: the daemon-addressable Entity facade for one PTY-backed terminal resource.
- `TerminalRegistry`: the Terminal Entity boundary registry and in-memory authority for process, screen, input, resize, exit state, and update publication.

Execution coordination belongs behind AgentExecution. Coordinating daemon code is named by its narrow mechanical job, such as process launch, terminal attachment, or observation intake.

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

daemon/runtime/agent-execution
  AgentExecutionRegistry
  narrow private launch/process helpers
  AgentExecutionLogWriter
  prompt-scoped signal instruction
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
  delegates execution work to AgentExecution through the daemon execution boundary
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
- prompt-scoped signal instruction
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
- prompt-scoped signal instruction
- AgentExecution creation or mutation
- Mission workflow state transitions
- Open Mission behavior
- signal promotion policy

### AgentExecution Runtime Helpers

AgentExecution owns execution lifecycle. Runtime helpers behind AgentExecution may:

- resolve the requested Agent through AgentRegistry.
- ask the Agent's AgentAdapter for launch translation.
- prepare mandatory prompt-scoped signal instructions for task-scoped executions.
- open or reconcile TerminalRegistry terminals for terminal-backed executions.
- wire TerminalRegistry updates into AgentExecution terminal attachment state.
- normalize adapter, protocol-marker, and terminal observations.
- expose mechanical process launch, input, cancellation, and termination capabilities to AgentExecution.

Those helpers are private implementation capabilities behind AgentExecution. AgentExecutionRegistry stores active AgentExecution instances and live process handles; lifecycle policy, message routing, terminal behavior, and execution state shape stay with AgentExecution.

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
- prompt-scoped signal instruction
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

Daemon runtime terminal modules under `packages/core/src/daemon/runtime/terminal` own only screen substrate behavior. TerminalRegistry owns live Terminal process leases, PTY IO, snapshots, and update publication. Agent execution modules may bind to TerminalRegistry terminals through AgentExecution terminal attachment behavior while terminal truth stays with Terminal.

Terminal may carry owner metadata for an AgentExecution, Mission, task, repository, or system operation. Owner metadata does not make Terminal a Mission Entity.

## Active Refactor Decisions

1. `AgentExecutionProtocolTypes` belongs in `entities/AgentExecution`.
2. `AgentExecutionProtocolTypes` must define explicit AgentExecutionScope for system, repository, mission, task, and artifact execution.
3. Delete `daemon/runtime/agent/AgentExecutionProtocolTypes.ts` and move active imports to the canonical Entity boundary.
4. Delete `daemon/runtime/agent/AgentRuntime.ts`.
5. Replace `daemon/runtime/agent/AgentAdapter.ts` with the narrow adapter contract.
6. Move lifecycle, TerminalRegistry, prompt-scoped signal instruction, signal policy, and live AgentExecution mutation out of `entities/Agent/AgentAdapter.ts`.
7. Split or rename `daemon/runtime/agent/adapters/AgentPtyAdapter.ts` because the current name hides executor responsibilities.
8. Move configured runtime construction out of `entities/Agent/AgentRegistry.ts` into daemon composition or another private runtime collaborator.
9. Extract TerminalRegistry and process supervision out of `entities/AgentExecution/AgentExecution.ts` into the Terminal Entity boundary, with a private runtime collaborator coordinating lifecycle use.
10. Promote Terminal to a first-class Entity so AgentExecution and Open Mission surfaces no longer import agent runtime glue to read or write terminal state.

## Removed Swamp

The implementation had overlapping lifecycle concepts:

- `entities/Agent/AgentAdapter.ts`: concrete PTY/signal lifecycle implementation in an Entity folder.
- `daemon/runtime/agent/AgentRuntime.ts`: duplicate lifecycle abstraction.
- `daemon/runtime/agent/AgentAdapter.ts`: duplicate lifecycle abstraction with adapter naming.
- `daemon/runtime/agent/adapters/AgentPtyAdapter.ts`: runtime-side copy that still owns lifecycle behavior under an adapter name.

The target is one public lifecycle owner: `AgentExecution`, with TerminalRegistry inside the Terminal Entity boundary as terminal authority. Any daemon launcher or coordinator remains private runtime machinery and must not force parallel `AgentExecution` type families back into the Entity schema.

## Implementation Sequence

1. Keep `AgentExecutionProtocolTypes` in `entities/AgentExecution` and ensure all active imports use that path.
2. Add explicit AgentExecutionScope before completing private runtime launch coordination so the implementation does not bake in Mission/task assumptions.
3. Delete `AgentRuntime` and update tests/fakes to stop extending it.
4. Rewrite runtime-side `AgentAdapter` as the narrow provider translation contract.
5. Move PTY/signal lifecycle behavior behind a private daemon runtime collaborator instead of leaving it inside deprecated compatibility surfaces.
6. Reduce provider adapter files to launch translation and output parsing.
7. Make workflow and daemon control call the converged AgentExecution launch boundary.
8. Remove the Entity-side concrete AgentAdapter implementation.
9. Extract remaining TerminalRegistry/process supervision out of AgentExecution Entity into the Terminal Entity boundary.
10. Promote Terminal to a first-class Entity and route AgentExecution terminal reads/input through that Entity.

Execute this sequence as a clean convergence: one canonical name, one active import path, and one lifecycle path at each step.

## Implementation Status Audit 2026-05-15

This audit reflects the current checked-in code under `packages/core/src`.

### Implemented Now

- `entities/AgentExecution/AgentExecutionSchema.ts` exists and defines a canonical storage/data shape for `AgentExecution` plus durable `AgentExecutionJournalRecord` storage.
- `entities/AgentExecution/AgentExecution.ts` exists and implements:
  - identity creation
  - `createData(...)`
  - registry-backed `read(...)` and `resolve(...)`
  - `sendMessage(...)` acknowledgement handling
  - in-memory journal sequence advancement through `appendJournalRecord(...)`
  - in-memory local process start/stop/wait behavior through direct `child_process.spawn(...)`
- `entities/AgentExecution/AgentExecutionContract.ts` exists and currently exposes only `read` and `sendMessage`.
- `entities/Terminal/Terminal.ts` and `entities/Terminal/TerminalRegistry.ts` exist. `TerminalRegistry` already owns PTY lifecycle, screen state, input, resize, kill, update publication, persisted lease cleanup, and runtime supervision projection.
- `lib/factory.ts` registers `AgentExecution` and `AgentExecutionJournalRecord` for Surreal-backed Entity storage.
- `entities/AgentExecution/AgentExecution.test.ts` provides smoke coverage for:
  - repository Surreal persistence
  - journal record persistence
  - local process start/stop
  - `sendMessage(...)` acceptance

### Partially Implemented

- The new Entity storage shape is present, but deprecated Mission/workflow compatibility surfaces still expect richer runtime projections that are not canonical AgentExecution truth.
- `sendMessage(...)` only records acceptance through an optional injected writer callback and updates activity state. It does not yet provide the broader structured delivery and observation flow expected by the rest of core.
- Journal metadata exists on the Entity, but the richer journal/runtime package structure expected elsewhere in core remains only partially converged.
- `Terminal` is a first-class Entity boundary, but `AgentExecution` does not yet expose the `attachTerminal(...)` style ownership/update path described in this spec.
- `AgentExecution` currently owns direct OS process spawning in `entities/AgentExecution/AgentExecution.ts`. That is a temporary implementation convenience, not a converged ownership model under current authority.

### Not Implemented In This Tree

- Only a minimal runtime compatibility boundary should exist under `packages/core/src/daemon/runtime/agent-execution/*`. Those files may carry registry-scoped runtime types for deprecated callers while canonical AgentExecution schema ownership stays in the Entity module.
- Runtime implementations under `daemon/runtime/agent-execution/` are convergence work, not canonical Entity schema authority. If `AgentExecutionRegistry` is present, it must remain lookup/process-handle plumbing only.
- No `AgentExecutionCommunicationSchema.ts` is present even though Mission, Agent, and workflow code import it.
- No canonical `AgentExecutionScope` type is implemented. Current storage uses `ownerEntity` plus `ownerId`, but the explicit scope vocabulary from the refactor spec is not yet represented.
- No canonical `AgentExecution.attachTerminal(...)` API exists.
- No current implementation provides the richer observation, signal-decision, console-event, prompt, command, terminal-handle, or launch-config types imported by legacy Mission/workflow/daemon code.
- `AgentExecutionContract` does not export daemon event helper constructors currently imported by `DaemonIpcServer`.

### Confirmed Build Blockers

Running `pnpm exec tsc --noEmit -p tsconfig.json` in `packages/core` currently confirms that the repository is in a half-migrated state.

The first AgentExecution-related blockers are:

- daemon imports missing `createAgentExecutionDataChangedEvent` and `createAgentExecutionTerminalEvent` from `AgentExecutionContract`
- daemon imports missing runtime files under `daemon/runtime/agent-execution/`
- Mission, Agent, and workflow imports missing many `AgentExecutionSchema` exports such as prompt/command/event/observation/terminal/launch types
- Agent and Mission imports missing `AgentExecutionCommunicationSchema.ts`

This means the current blockade is broader than OGM persistence. The storage layer can persist the new narrow `AgentExecution` Entity shape, but the rest of core has not yet been migrated to consume that shape.

### What OGM Storage Can Safely Assume Right Now

- Surreal table registration for `agent_execution` and `agent_execution_journal` is real and usable.
- Repository-owned Entity persistence for the narrow `AgentExecutionStorageSchema` is real and should not be reshaped casually during the OGM session.
- The current in-memory process snapshot in `AgentExecution.ts` is not durable Entity truth and should not be treated as settled storage contract.
- The remaining runtime coordination modules should be completed without forcing the in-progress OGM storage work or the canonical Entity schema to adopt legacy runtime-only payloads.

### Safe Completion Order From Here

1. Converge the compile surface around one canonical AgentExecution API before expanding storage work.

1. Decide explicitly whether the next step is to migrate daemon, Mission, workflow, and Agent callers down to the new narrow Entity contract, or to keep only the smallest registry-owned runtime compatibility boundary needed while those callers are being deleted or rewritten.

1. Keep `AgentExecutionStorageSchema` canonical and migrate legacy workflow imports toward it.

1. Keep runtime snapshot and runtime event exports outside `AgentExecutionSchema.ts` unless the accepted Entity model promotes them.

1. Implement explicit scope and terminal attachment in the canonical `AgentExecution` model before asking OGM storage to absorb richer runtime state.

1. Once the compile surface is converged, finish journal, observation, and signal routing on top of the stable Entity contract.

### Practical Conclusion

`AgentExecution` is not blocked because Entity storage is missing. It is blocked because the repository contains a new narrow Entity/storage implementation and an older richer runtime/mission surface at the same time, with the runtime side mostly absent from disk. Complete the API convergence first, then continue the OGM entity-storage session against the converged `AgentExecution` contract.
