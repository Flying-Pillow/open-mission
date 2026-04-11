---
layout: default
title: Agent Runtime Plan
parent: Plans
nav_order: 1
---

# Agent Runtime Plan

This document translates the agent runtime definition spec into implementation work.

It is intentionally concrete.

It defines:

- what must be implemented first
- what current files should be deleted or replaced
- what infrastructure may be preserved
- what new ownership boundaries should be introduced

This plan assumes the clean-break rules defined by the agent runtime specification.

## Implementation Law

The runtime rewrite must follow these rules.

1. One authoritative runtime boundary only.
2. No fallback to the legacy runtime contracts.
3. No compatibility shim that translates between old and new contracts for long-term use.
4. No adapter work before the core contract and orchestrator exist.
5. No provider-specific types in the new core contract.
6. OOD is mandatory: session behavior, runner behavior, orchestration, and provider translation each need explicit ownership.
7. DRY is mandatory: shared session bookkeeping may live in a neutral base class or helper layer, but provider-specific protocol logic must remain in concrete adapters.

## Desired End State

At the end of this work, the system should have:

1. one `AgentRunner` contract in core
2. one `AgentSession` contract in core
3. one orchestrator path used by both workflow-engine execution and operator-driven session interaction
4. one provider registration mechanism for runners
5. zero use of `WorkflowTaskRunner`
6. zero use of the current `MissionAgentRuntime` contract

## Phase Order

The order is strict.

### Phase 1: Define Core Runtime Contract

Create the new normalized runtime types and interfaces in core.

Required output:

- core `AgentRunner` interface
- core `AgentSession` interface
- normalized prompt, command, snapshot, and event types
- explicit unsupported-command and unsupported-prompt behavior rules

This phase blocks all other work.

Do not start rewriting adapters before this phase is complete.

### Phase 2: Create Session Orchestrator Layer

Add the runtime coordination layer that owns:

- runner registry
- session registry
- attach or reattach behavior
- prompt routing
- command routing
- normalized event forwarding
- session snapshot persistence hooks

This layer must be the only place where Mission coordinates live sessions.

The workflow engine and daemon surfaces should both depend on this orchestrator, not on provider adapters directly.

### Phase 3: Rewire Workflow Engine To The New Runtime Boundary

Replace the current workflow-only runner path.

Required outcome:

- workflow requests launch through `AgentRunner`
- workflow requests control sessions through `AgentSession`
- workflow reconciliation uses the new runtime boundary
- workflow state stores normalized session facts from the new contract

After this phase, `WorkflowTaskRunner` must no longer be used anywhere in active code.

### Phase 4: Rewire Mission And Daemon Session Operations

Replace the current mission-plane interactive session path.

Required outcome:

- mission launch, prompt submission, input submission, cancel, terminate, and future engine commands all route through the same orchestrator
- protocol shapes stop depending on the old runtime type names
- daemon startup loads only one runtime registry type

After this phase, the legacy `MissionAgentRuntime` contract must no longer be used anywhere in active code.

### Phase 5: Rewrite Provider Adapter Against The New Contract

Only after Phases 1 through 4 are stable should the first provider adapter be rewritten.

The current Copilot runtime code may be mined for translation logic, but it must be rewritten against the new contract.

### Phase 6: Delete Legacy Contracts And Tests

Remove old runtime abstractions and tests that encode the split architecture.

The codebase should not retain dead aliases, bridge code, or duplicate factories.

## File Actions

This section is the practical map.

### Delete Or Replace

These files encode the old runtime split or expose it publicly.

#### Replace `packages/core/src/daemon/MissionAgentRuntime.ts`

Reason:

- this is the current interactive runtime contract
- it is richer than the workflow runner, but it is still the wrong canonical shape
- it mixes session contract, console model, prompt rendering helpers, session record helpers, and runtime capability definitions in one legacy boundary

Target action:

- replace with new runtime contract files under a dedicated runtime namespace
- move prompt rendering and persistence helpers out unless they remain genuinely normalized and reusable

#### Delete or replace `packages/core/src/workflow/engine/runner.ts`

Reason:

- this is the workflow-only runtime contract
- its existence is the core architectural problem

Target action:

- remove this contract entirely
- update workflow engine code to depend on the new shared runtime boundary

#### Replace `packages/core/src/adapters/CopilotAgentRuntime.ts`

Reason:

- implemented against the old interactive contract
- should not define the new architecture

Target action:

- rewrite later as a concrete `AgentRunner` adapter

#### Delete or replace `packages/core/src/adapters/CopilotWorkflowTaskRunner.ts`

Reason:

- exists only because of the split architecture
- explicitly rejects interactive session input, which is incompatible with the target design

Target action:

- remove entirely after the new adapter exists
- do not preserve as a side path

#### Replace `packages/adapters/src/index.ts`

Reason:

- currently exports two separate runtime factory paths
- currently exposes Copilot-first types directly

Target action:

- expose one configured runner factory only
- register providers as `AgentRunner` implementations only

#### Replace `packages/core/src/daemon/runDaemonMain.ts`

Reason:

- currently loads both mission runtimes and workflow task runners

Target action:

- load one configured runner registry
- remove dual factory loading

#### Replace `packages/core/src/index.ts`

Reason:

- currently re-exports the old runtime surface

Target action:

- re-export the new runtime contract only
- do not re-export legacy runtime names once replacement is complete

### Refactor Heavily

These files are not the root problem, but they will need significant rewiring.

#### Refactor `packages/core/src/workflow/engine/effectRunner.ts`

Reason:

- currently steers `WorkflowTaskRunner`
- should steer the new orchestrator or shared runtime boundary instead

Target action:

- route `session.launch`, `session.prompt`, `session.command`, `session.cancel`, and `session.terminate` through the new orchestrator-facing API
- support future engine command effects without adding another parallel path

#### Refactor `packages/core/src/workflow/engine/controller.ts`

Reason:

- currently depends on effect execution designed around the split runtime model

Target action:

- keep reducer and event ingestion logic
- swap runtime coordination dependency to the new orchestrator

#### Refactor `packages/core/src/daemon/Workspace.ts`

Reason:

- currently holds two runtime registries
- currently exposes legacy session methods and protocol routes in terms of the old runtime types

Target action:

- own one runner registry only
- delegate all live session behavior to the new orchestrator
- stop storing separate interactive runtime and workflow runner maps

#### Refactor `packages/core/src/daemon/protocol.ts`

Reason:

- currently references legacy runtime request and event types

Target action:

- rename protocol payloads around the new runtime contract
- keep transport semantics neutral
- add command submission payloads when the engine begins using structured session commands

#### Refactor `packages/core/src/daemon/mission/AgentSession.ts`

Reason:

- this is a useful object boundary, but it wraps the old session contract

Target action:

- either rewrite it as the new orchestrator-managed session wrapper or replace it with a new runtime session aggregate
- preserve object ownership, not the old type dependency

#### Refactor `packages/core/src/daemon/mission/Mission.ts`

Reason:

- currently registers legacy runtimes and forwards legacy session operations directly

Target action:

- route through the new orchestrator
- keep Mission focused on mission policy and authorization rather than provider session mechanics

### Preserve As Neutral Infrastructure

These files may survive if they are kept free of runtime semantics.

#### Preserve `packages/core/src/workflow/engine/types.ts`

Reason:

- workflow runtime state, events, and reducer types are the correct layer

Required adjustment:

- update session state structures to consume the new normalized session snapshot model where needed
- do not let provider-specific shapes leak in

#### Preserve `packages/core/src/workflow/engine/service.ts`

Reason:

- event ingestion is the correct architectural layer

Required adjustment:

- none beyond changed runtime event shapes if needed

#### Preserve `packages/core/src/workflow/engine/reducer.ts`

Reason:

- reducer ownership is correct

Required adjustment:

- only update session event handling if the normalized event vocabulary changes

#### Preserve `packages/core/src/lib/FilesystemAdapter.ts`

Reason:

- filesystem persistence is neutral infrastructure

Required adjustment:

- none unless session persistence schema changes require new read/write helpers

#### Preserve `packages/core/src/client/DaemonClient.ts`

Reason:

- transport client is neutral infrastructure

Required adjustment:

- update to the new protocol payloads only

## New Files To Introduce

These names are suggestions, but the ownership split should exist.

### Core Runtime Contracts

- `packages/core/src/runtime/AgentRunner.ts`
- `packages/core/src/runtime/AgentSession.ts`
- `packages/core/src/runtime/AgentRuntimeTypes.ts`
- `packages/core/src/runtime/AgentSessionEventEmitter.ts`

Purpose:

- isolate the new runtime contract from daemon, workflow, and provider implementation details

### Orchestration Layer

- `packages/core/src/runtime/AgentSessionOrchestrator.ts`
- `packages/core/src/runtime/AgentRunnerRegistry.ts`
- `packages/core/src/runtime/PersistedAgentSessionStore.ts`

Purpose:

- centralize live session coordination and persistence integration

### Shared Base Layer

Optional only if it stays provider-neutral:

- `packages/core/src/runtime/BaseAgentSession.ts`
- `packages/core/src/runtime/BaseAgentRunner.ts`

Purpose:

- hold shared snapshot mutation, event plumbing, and unsupported-operation guards

This layer is optional.

If it begins to accumulate provider logic, delete it and keep the interfaces only.

## Detailed Sequence

### Step 1

Create the new runtime namespace and contracts.

Do not touch provider code first.

### Step 2

Create the orchestrator and session registry.

Give it a small public API such as:

- register runners
- start session
- attach session
- list sessions
- submit prompt
- submit command
- cancel session
- terminate session
- subscribe to session events

### Step 3

Refactor workflow effect execution to call the orchestrator rather than a workflow-only runner.

### Step 4

Refactor daemon workspace and mission session flows to call the same orchestrator.

### Step 5

Rewrite the provider adapter against the new contract.

### Step 6

Delete legacy contracts, remove old exports, and rewrite tests.

## Test Rewrite Plan

### Delete Or Rewrite Legacy Runtime Tests

Rewrite any tests that prove the split architecture instead of the target contract.

Likely impacted files include:

- `packages/core/src/daemon/mission/AgentSession.test.ts`
- `packages/core/src/daemon/mission/Mission.test.ts`

### Add New Contract Tests

Required tests:

1. `AgentRunner` can start a session and report an initial snapshot.
2. `AgentSession` can accept a second prompt after startup when supported.
3. `AgentSession` can accept a structured command and emit normalized results.
4. unsupported commands reject explicitly.
5. terminal sessions reject prompts and commands.
6. workflow engine launches and controls sessions through the shared runtime path only.
7. daemon operator session calls route through the same shared runtime path only.

## Acceptance Criteria

This plan is complete only when all of the following are true.

1. There is one runtime contract in active code.
2. Workflow execution and operator session interaction use the same session abstraction.
3. The daemon loads one runner registry, not separate runtime and runner registries.
4. Provider-specific runtime code lives behind the new contract.
5. No compatibility aliases for the legacy contracts remain in the public core surface.

## Decision

The first implementation work after the new specification should be core-contract and orchestrator creation, not provider-adapter refactoring.

The old split between `MissionAgentRuntime` and `WorkflowTaskRunner` should be treated as architecture to remove, not architecture to evolve.
