# Agent Runtime Definition Specification

This document defines the target provider-neutral runtime contract for Mission.

This is a from-scratch specification.

It does not preserve compatibility with the current `MissionAgentRuntime` shape, the current `WorkflowTaskRunner` shape, the current `CopilotAgentRuntime`, or the current `CopilotWorkflowTaskRunner` split.

The purpose of this document is to define the exact runtime boundary that the workflow engine may steer before any adapter rewrites begin.

## Goals

The runtime contract must be:

- provider-neutral
- workflow-engine-first
- session-centric
- explicit about lifecycle and control
- capable of operator prompts against running sessions
- capable of engine-defined commands against running sessions
- minimal by default
- extensible without aliases or compatibility shims
- object-oriented in ownership

## Clean Break Requirement

This contract is a replacement, not a bridge.

Implementation must assume a full semantic reset of Mission's agent execution boundary.

That means:

- no fallback to the current runtime contracts is allowed
- no compatibility adapter that preserves both old and new runtime contracts is allowed
- no aliasing between old type names and new type names is allowed
- no long-term coexistence of `MissionAgentRuntime` and `WorkflowTaskRunner` is allowed
- no Copilot-specific behavior may define the core contract

The current Copilot runtime code may remain temporarily as implementation reference, but it must not define the new architecture.

## Problem Statement

The repository currently has two competing runtime boundaries:

1. an interactive mission-plane session contract
2. a thinner workflow-engine task runner contract

That split is architecturally wrong for the target system.

The workflow engine must own one authoritative runtime boundary.

That boundary must support both of the following through the same abstraction:

1. engine-driven lifecycle control over agent sessions
2. prompt submission to a running agent session from an operator or orchestrator

If these concerns are split across separate contracts, Mission will keep leaking workflow semantics into adapters and provider-specific code paths.

## Non-Goals

This specification does not attempt to solve:

- dynamic extraction of every prompt form a provider supports
- dynamic discovery of every provider-native slash command or tool command
- transcript formatting rules for a specific UI surface
- provider-native tool protocol modeling beyond normalized lifecycle facts
- legacy mission aggregate behavior preservation

For the first implementation pass, runtime adapters may publish a static command set and static capability declaration.

## Architectural Boundaries

The runtime architecture has four layers.

### 1. Workflow Engine

The workflow engine is the authority for:

- when a session should start
- when a session should be interrupted
- when a session should be cancelled or terminated
- when a prompt should be sent into a running session
- how runtime facts are reduced into mission state

The engine owns workflow semantics.

The engine does not own provider protocol translation.

### 2. Session Orchestrator

The orchestrator is the coordination layer between workflow events and runtime adapters.

Responsibilities:

- choose the configured runtime adapter
- create or attach session handles
- subscribe to normalized events
- relay prompts and commands to the session
- reconcile persisted session references with live provider state

The orchestrator maps workflow-engine `session.prompt` effects directly to `AgentSession.submitPrompt()`.

The orchestrator maps workflow-engine `session.command` effects directly to `AgentSession.submitCommand()`.

The orchestrator owns coordination.

The orchestrator does not own provider-specific SDK logic.

### 3. Agent Runner Adapter

The adapter is the provider-specific implementation of the Mission runtime contract.

Responsibilities:

- translate Mission session requests into provider-native operations
- normalize provider-native events into Mission events
- normalize provider-native lifecycle facts into Mission snapshots
- reject unsupported commands explicitly

The adapter owns translation.

The adapter does not own workflow policy.

### 4. Provider Runtime

This is the external system such as Copilot, Claude Code, Codex, Aider, or a generic process runtime.

Mission must not treat any provider as architecturally privileged.

## Terminology

### Agent Runner

The provider-neutral runtime adapter registered with Mission.

It is called a runner because the workflow engine steers it as an execution backend.

### Agent Session

A live or resumable provider-backed conversation or execution context.

### Prompt

Freeform text that Mission sends into a session.

Prompts may originate from:

- the workflow engine
- an operator
- a future automated policy layer

### Command

A structured, engine-defined control message sent to a running session.

Commands are not provider-native slash commands.

Commands are normalized Mission intents that an adapter must map, reject, or partially support.

### Snapshot

The latest normalized state Mission knows about a session.

### Event

A normalized runtime fact emitted by a runner or session.

Events are append-only observations.

### Governed Terminal Input

Input that Mission intentionally injects into a terminal-backed session.

This may be expressed as:

- prompt text
- control-key signals such as `Ctrl+C`
- line-oriented operator replies
- other adapter-approved keystroke sequences

Governed terminal input is part of the runtime control surface.

It must not be treated as an invisible out-of-band action.

### Semantic Runtime Messaging

Structured messages exchanged between a running agent and Mission outside raw terminal text.

The long-term preferred mechanism is a Mission-owned daemon MCP server exposed to the runtime when available.

Semantic runtime messaging is additive.

It does not replace the baseline prompt, command, and lifecycle requirements of this contract.

## Design Principles

1. Core owns normalized contracts only.
2. Provider-specific implementations belong outside the core contract definition.
3. Session control and prompt submission belong to the same session abstraction.
4. Unsupported behavior must be rejected explicitly, never silently ignored.
5. Capability reporting must be truthful and static enough for deterministic UI and workflow behavior.
6. A session is a first-class object with methods and invariants, not a loose collection of callbacks.
7. Shared behavior may be implemented in an abstract base class, but the normative contract is interface-first.

## Required Runtime Responsibilities

The workflow engine requires the runtime boundary to support the following minimum responsibilities.

### Session Lifecycle

Mission must be able to:

- start a session
- attach to an existing session when supported
- inspect the latest normalized session snapshot
- cancel a session
- terminate a session

For terminal-backed runtimes, session lifecycle control may be implemented through tmux target management plus process-state inspection, as long as the adapter exposes only normalized Mission session state.

### Prompt Submission

Mission must be able to submit a freeform prompt to a running session.

This is required.

If a provider cannot accept prompts once running, then it is not a valid session runtime for the target architecture.

For terminal-backed runtimes, prompt submission may be implemented by injecting line-oriented input into the live terminal session.

That still counts as prompt submission as long as:

- Mission intentionally initiates the input
- the adapter reports acceptance or rejection explicitly
- the resulting session snapshot remains authoritative

### Command Submission

Mission must be able to submit structured engine-defined commands to a running session.

This is required.

The minimal required command family is:

- `interrupt`
 `continue`
 `checkpoint`

Optional commands may include:

- `finish`
- `summarize`

`cancel` and `terminate` are not command kinds.

They are explicit lifecycle methods on `AgentSession` and must be routed through `cancel()` and `terminate()`, not through `submitCommand()`.

The engine owns canonical command identifiers.

Adapters must map those identifiers to provider-native operations or reject them with an explicit unsupported result.

For terminal-backed runtimes, command mapping may use terminal signals or adapter-defined keystroke sequences.

Example mappings may include:

- `interrupt` to `Ctrl+C`
- `continue` to an adapter-specific prompt or newline sequence
- `checkpoint` to an engine-authored terminal instruction

These mappings are adapter implementation details and must remain outside the normalized core contract.

### Event Streaming

Mission must be able to subscribe to normalized session events.

At minimum the runtime must emit:

- session started
- session attached
- state changed
- prompt accepted or rejected
- command accepted or rejected
- awaiting input
- message emitted
- session completed
- session failed
- session cancelled
- session terminated

For terminal-backed runtimes, the adapter must also emit normalized events for Mission-governed input injection when that input materially changes control flow or auditability.

### Reconciliation

Mission must be able to recover live session state after daemon restart.

At minimum a runner must support one of these patterns:

- attach by session reference
- list active sessions
- return a terminal not-found result for dead sessions

For tmux-backed runtimes, a session reference may be backed by persisted tmux identifiers plus Mission-owned metadata that can be reattached or reconciled after daemon restart.

If `attachSession()` is called for a session that no longer exists, it must resolve to an `AgentSession` instance whose initial snapshot phase is `terminated` and which emits `session.terminated` immediately after subscription.

It must not fail through an unhandled rejection merely because the external provider session is gone.

This rule exists so the orchestrator can reconcile dead sessions deterministically after restart.

## Canonical Type Model

The following shapes define the target contract.

```ts
export type AgentRunnerId = string;
export type AgentSessionId = string;

export type AgentSessionPhase =
  | 'starting'
  | 'running'
  | 'awaiting-input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'terminated';

export type AgentPromptSource = 'engine' | 'operator' | 'system';

export type AgentCommandKind =
  | 'interrupt'
  | 'continue'
  | 'checkpoint'
  | 'finish';

export interface AgentRunnerCapabilities {
  attachableSessions: boolean;
  promptSubmission: boolean;
  structuredCommands: boolean;
  interruptible: boolean;
  interactiveInput: boolean;
  telemetry: boolean;
  terminalTransport?: boolean;
  governedInputInjection?: boolean;
  semanticMessaging?: boolean;
}

export interface AgentSessionReference {
  runnerId: AgentRunnerId;
  sessionId: AgentSessionId;
  transport?: {
    kind: 'tmux';
    sessionName: string;
    windowName?: string;
    paneId?: string;
  };
}

export interface AgentSessionStartRequest {
  missionId: string;
  taskId: string;
  workingDirectory: string;
  initialPrompt?: AgentPrompt;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AgentPrompt {
  source: AgentPromptSource;
  text: string;
  title?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AgentCommand {
  kind: AgentCommandKind;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AgentSessionSnapshot {
  runnerId: AgentRunnerId;
  sessionId: AgentSessionId;
  phase: AgentSessionPhase;
  workingDirectory?: string;
  taskId: string;
  missionId: string;
  acceptsPrompts: boolean;
  acceptedCommands: AgentCommandKind[];
  awaitingInput: boolean;
  transportKind?: 'tmux';
  failureMessage?: string;
  updatedAt: string;
}
```

## Core Interfaces

```ts
export interface AgentRunner {
  readonly id: AgentRunnerId;
  readonly displayName: string;
  readonly capabilities: AgentRunnerCapabilities;

  isAvailable(): Promise<{ available: boolean; detail?: string }>;
  startSession(request: AgentSessionStartRequest): Promise<AgentSession>;
  attachSession?(reference: AgentSessionReference): Promise<AgentSession>;
  listSessions?(): Promise<AgentSessionSnapshot[]>;
}

The orchestrator owns the authoritative mapping of `AgentSessionId` to `missionId` and `taskId`.

Adapters should persist these values in provider metadata when possible.

If a provider cannot persist them natively, the orchestrator must restore them from Mission's persisted runtime state before emitting normalized events back into the workflow engine.

export interface AgentSession {
  readonly runnerId: AgentRunnerId;
  readonly sessionId: AgentSessionId;

  getSnapshot(): AgentSessionSnapshot;
  onDidEvent(listener: (event: AgentSessionEvent) => void): { dispose(): void };

  submitPrompt(prompt: AgentPrompt): Promise<AgentSessionSnapshot>;
  submitCommand(command: AgentCommand): Promise<AgentSessionSnapshot>;
  cancel(reason?: string): Promise<AgentSessionSnapshot>;
  terminate(reason?: string): Promise<AgentSessionSnapshot>;
  dispose(): void;
}
```

The core contract does not require every runner to expose transport metadata.

When transport metadata exists, it is diagnostic and reconciliation data only.

Callers must not couple workflow logic to tmux naming details.

## Event Model

The event model must be normalized and minimal.

```ts
export type AgentSessionEvent =
  | {
      type: 'session.started';
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'session.attached';
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'session.state-changed';
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'session.message';
      channel: 'stdout' | 'stderr' | 'system' | 'agent';
      text: string;
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'session.awaiting-input';
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'prompt.accepted';
      prompt: AgentPrompt;
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'prompt.rejected';
      prompt: AgentPrompt;
      reason: string;
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'command.accepted';
      command: AgentCommand;
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'command.rejected';
      command: AgentCommand;
      reason: string;
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'session.input-injected';
      inputSource: 'engine' | 'operator';
      mode: 'prompt' | 'signal' | 'keystroke';
      text?: string;
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'session.semantic-message';
      channel: 'mcp' | 'adapter';
      messageType: string;
      body: Record<string, unknown>;
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'session.completed';
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'session.failed';
      reason: string;
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'session.cancelled';
      reason?: string;
      snapshot: AgentSessionSnapshot;
    }
  | {
      type: 'session.terminated';
      reason?: string;
      snapshot: AgentSessionSnapshot;
    };
```

## Command Semantics

Mission commands are canonical engine intents.

They are not a mirror of provider-native verbs.

### Required Minimal Commands

#### `interrupt`

Meaning:

- stop the current autonomous flow
- keep the session alive if the provider supports it
- return control to Mission and the operator

If a provider cannot implement a non-destructive interrupt, it must reject this command explicitly.

#### `continue`

Meaning:

- resume mid-flight progress after a checkpoint, pause, or interrupt when the provider supports that behavior

#### `checkpoint`

Meaning:

- request a controlled handoff point back to Mission or the operator without ending the session

### Lifecycle Methods

`cancel()` and `terminate()` are explicit lifecycle methods, not command kinds.

Rules:

- orchestrators must call `cancel()` for session-cancellation requests
- orchestrators must call `terminate()` for session-termination requests
- adapters must not require callers to encode either lifecycle action through `submitCommand()`

### Optional Commands

Optional command kinds may be added only by extending `AgentCommandKind` directly.

Do not add provider-specific aliases such as provider slash commands into the core contract.

## Prompt Semantics

Prompts are freeform session input.

The core contract requires:

- Mission can send a prompt to a running session
- the runtime reports whether the prompt was accepted or rejected
- the session snapshot reflects whether further prompts are currently accepted

`AgentSessionStartRequest.initialPrompt` is fresh-session bootstrap context only.

It is not a transcript-recovery mechanism.

The contract does not require:

- runtime-side prompt template discovery
- provider-native slash command introspection
- structured parsing of arbitrary prompt syntax

If a reopened task or resumed workflow needs prior mission history, the orchestrator or workflow engine must restore that context explicitly through subsequent prompt submission, restored metadata, or provider-specific resume behavior.

The core `AgentRunner` contract remains stateless regarding mission transcript history.

If future runtimes can expose richer prompt affordances, that may be added as metadata, not as a compatibility branch in the core contract.

If future runtimes expose a Mission daemon MCP server, semantic runtime messages should flow through normalized session events rather than bypassing the runtime contract.

## Session Invariants

The following invariants are required.

1. Every session belongs to exactly one runner.
2. Every session snapshot must have one authoritative phase.
3. Terminal phases are `completed`, `failed`, `cancelled`, and `terminated`.
4. Once terminal, a session must reject further prompts and commands.
5. `terminate` must always end in a terminal phase or explicit failure.
6. If `acceptsPrompts === false`, `submitPrompt` must reject explicitly.
7. If a command kind is absent from `acceptedCommands`, `submitCommand` must reject explicitly.
8. Session event order must be causally coherent for a single session.
9. Every normalized session snapshot must include authoritative `missionId` and `taskId` values before it is emitted to the workflow engine.
10. Mission-governed terminal input must produce auditable normalized events.
11. Semantic runtime messages must not mutate mission state unless reduced through normal orchestrator policy.

## Orchestrator Rules

The session orchestrator must be implemented against the new `AgentRunner` and `AgentSession` contracts only.

It must not depend on provider classes directly.

It must own:

- session registry by Mission reference
- event subscription wiring
- persistence of normalized snapshots into mission runtime state
- prompt routing from operator surfaces into the session
- command routing from workflow-engine requests into the session
- restoration of `missionId` and `taskId` ownership when provider-native session state does not retain them

For terminal-backed runtimes, the orchestrator also owns the distinction between:

- governed Mission input routed through the adapter
- uncontrolled manual terminal interaction outside Mission APIs

The former is part of Mission state and audit.

The latter may exist operationally, but should be surfaced as degraded-governance state when detectable.

`AgentContext` is not part of this runtime boundary.

Provider-neutral runtime behavior is expressed by `AgentRunner` and `AgentSession`; launch policy, environment selection, and mission execution context stay outside the adapter contract.

It must not own:

- provider SDK event parsing
- provider-specific prompt formatting
- provider-specific command naming

## Adapter Rules

Provider adapters must live behind the new contract and may use an abstract base class for shared mechanics.

If an abstract base class exists, it may own only neutral behavior such as:

- snapshot mutation helpers
- event emitter plumbing
- terminal-state guards
- explicit unsupported-command helpers

It must not embed provider-specific protocol logic.

Each concrete adapter must own only its provider translation.

For tmux-backed runtimes, provider translation includes:

- tmux target allocation and reconciliation
- safe input injection
- transcript capture
- process exit detection
- mapping raw terminal realities into normalized session phases

## Package Ownership

The core package owns:

- `AgentRunner` contract
- `AgentSession` contract
- normalized events
- normalized snapshots
- orchestrator interfaces and coordination logic

Provider-specific implementations belong in adapter packages, not in core contract design.

If an implementation remains temporarily in core during migration, that is technical debt and not part of the target architecture.

## Legacy Replacement Rules

When implementing this spec:

- delete or replace the current `WorkflowTaskRunner` contract
- delete or replace the current `MissionAgentRuntime` contract
- do not keep both contracts with translation glue between them
- do not preserve Copilot-first naming in the normalized core runtime boundary
- do not preserve separate interactive and workflow-only runtime types

There must be one runtime boundary.

## Initial Implementation Scope

The first implementation pass should deliver:

1. the new core contract types
2. a session orchestrator that depends only on those types
3. one concrete runtime adapter that satisfies the new contract
4. workflow engine integration that uses the new contract directly
5. prompt submission into running sessions
6. engine command submission into running sessions
7. one tmux-backed process adapter suitable for CLI-native coding agents

The first pass does not need:

1. dynamic provider command discovery
2. multiple provider adapters
3. advanced telemetry normalization
4. UI-specific prompt suggestion systems
5. daemon MCP semantic messaging

## Verification

The implementation must be proven with the following tests.

1. Contract tests: a test runner implementing the new contract can start, snapshot, prompt, command, cancel, and terminate sessions through one consistent interface.
2. Rejection tests: unsupported commands are rejected explicitly rather than ignored.
3. Prompt tests: a running session can accept a second prompt after the initial prompt when the runtime advertises prompt submission support.
4. Terminal-state tests: completed, failed, cancelled, and terminated sessions reject further prompts and commands.
5. Reconciliation tests: the orchestrator can reattach or reconcile sessions after restart when the adapter supports it.
6. Workflow-engine integration tests: engine requests launch sessions, send commands, and reduce normalized session events without using a separate workflow-only runtime contract.
7. Neutrality tests: a non-Copilot test adapter can satisfy the contract without importing any Copilot-specific core types.
8. Governed-input tests: terminal-backed sessions emit explicit audit events when Mission injects prompts or control signals.
9. Semantic-message tests: structured agent-to-Mission messages, when supported, are normalized without bypassing orchestrator policy.

## Decision

Mission should standardize on one interface-first runtime boundary named around `AgentRunner` and `AgentSession` semantics.

An abstract base class may exist as an implementation convenience, but it is not the architecture.

The architecture is the normalized interface contract that the workflow engine steers directly.
