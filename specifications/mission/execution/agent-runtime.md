---
layout: default
title: Agent Runtime
parent: Execution
nav_order: 1
---

# Agent Runtime

This document defines the target provider-neutral agent execution contract for Mission.

Mission is an orchestrator of external coding-agent processes. It is not a wrapper around any one LLM API.

The purpose of this document is to define the hard boundary between Mission core and executable-specific adapters before the runtime redesign is completed.

## Relationship To Other Specifications

This document must be read alongside the workflow engine specification and the airport control plane specification.

Priority rule:

1. the workflow engine specification defines mission truth, workflow events, and reducer-emitted execution requests
2. the airport control plane specification defines daemon-owned control surfaces, projections, and external command routing
3. this runtime specification defines the provider-neutral runner and session contracts used to execute those requests

If this document is interpreted to give adapters ownership of workflow policy, mission truth, Airport layout, or operator command policy, that interpretation is wrong.

## Core Boundary

Mission enforces one hard boundary:

- Mission core owns intent, lifecycle, governance, and normalized state.
- Adapters own translation, transport, parsing, and executable control.

That boundary means the responsibilities split as follows.

### Mission Core Responsibilities

Mission core owns:

- when a task should start
- what instruction and structured context the agent receives
- which worktree or working directory is authoritative
- whether a session is `starting`, `running`, `awaiting-input`, `completed`, `failed`, `cancelled`, or `terminated`
- human governance actions such as interrupt, panic stop, cancel, and terminate
- normalized session events and snapshots persisted into mission state
- daemon-owned routing so workflow effects and external clients use the same execution control path

### Adapter Responsibilities

Each adapter owns:

- translating Mission launch config into executable-specific flags, environment, or transport setup
- validating adapter-specific launch requirements before process start
- starting or reattaching the real executable session
- parsing stdout, stderr, PTY output, SDK callbacks, or provider event streams
- converting provider observations into Mission `AgentSessionEvent` and `AgentSessionSnapshot`
- process and transport control such as prompt injection, interrupt, graceful cancel, and force terminate

### Explicit Non-Responsibilities

Mission core must not own:

- package installation
- executable login or account bootstrap
- provider-specific configuration UX such as proprietary reasoning modes as first-class core fields
- direct parsing of one provider's stdout format outside the adapter layer

Environment setup is the operator's responsibility. Mission assumes the configured binary is present and usable.

## Design Decision

Mission standardizes on two core execution contracts:

1. `AgentRunner`
2. `AgentSession`

The runner is the factory and capability boundary.

The session is the live instance boundary.

Mission may use a daemon-owned agent control service internally to resolve runners, persist references, reconcile restarts, and expose IPC methods. That control service is important operational infrastructure, but the core execution model is still defined by runner and session.

## Goals

The runtime contract must be:

- provider-neutral
- explicit about Mission-owned lifecycle truth
- explicit about adapter-owned executable translation
- recoverable after daemon restart
- suitable for both workflow-driven launches and externally initiated commands
- small enough that CLI-backed adapters stay thin

## Non-Goals

This specification does not attempt to solve:

- provider-specific slash-command discovery as part of the core contract
- provider transcript rendering conventions as first-class mission semantics
- package management, login, or update workflows
- Airport pane topology as part of the session contract
- a second public orchestration abstraction beyond runner and session

## Canonical Types

```ts
export type AgentRunnerId = string;
export type AgentSessionId = string;
export type AgentMetadataValue = string | number | boolean | null;
export type AgentMetadata = Record<string, AgentMetadataValue>;

export type AgentRuntimeErrorCode =
  | 'runner-not-available'
  | 'invalid-launch-config'
  | 'session-not-found'
  | 'prompt-not-accepted'
  | 'command-not-supported'
  | 'invalid-session-state'
  | 'launch-failed'
  | 'reconcile-failed';

export type AgentSessionStatus =
  | 'starting'
  | 'running'
  | 'awaiting-input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'terminated';

export type AgentProgressState =
  | 'unknown'
  | 'working'
  | 'waiting-input'
  | 'blocked'
  | 'done'
  | 'failed';

export type AgentAttentionState =
  | 'none'
  | 'autonomous'
  | 'awaiting-operator'
  | 'awaiting-system';
```

## Structured Launch Contract

Mission launches agent work with a structured contract, not a provider prompt blob.

```ts
export interface AgentTaskContext {
  taskId: string;
  stageId: string;
  title: string;
  description: string;
  instruction: string;
  acceptanceCriteria?: string[];
}

export interface AgentContextDocument {
  documentId: string;
  kind: 'spec' | 'brief' | 'artifact' | 'note';
  title: string;
  path?: string;
  summary?: string;
}

export interface AgentSpecificationContext {
  summary: string;
  documents: AgentContextDocument[];
}

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

1. `requestedRunnerId` is advisory only.
2. Mission control or the daemon-owned agent control service resolves the actual runner.
3. `task.instruction` is the execution-ready instruction.
4. `specification` carries governing context without turning runtime into a document-loader subsystem.
5. `metadata` is an opaque escape hatch for runner-specific options that core must not reinterpret semantically.

## Opaque Metadata Rule

Provider-specific knobs such as reasoning level, effort, or transport mode must not become first-class Mission fields unless they are genuinely cross-runner semantics.

Instead, Mission passes opaque metadata through `AgentLaunchConfig.metadata`.

Example:

```json
{
  "agentRunner": "pi-cli",
  "agentMetadata": {
    "thinking": "high",
    "mode": "rpc"
  }
}
```

Mission persists and forwards this metadata.

The concrete adapter interprets it.

## Session Reference And Capabilities

```ts
export interface AgentSessionReference {
  runnerId: AgentRunnerId;
  sessionId: AgentSessionId;
  processId?: number;
  transport?: {
    kind: 'terminal';
    terminalSessionName: string;
    paneId?: string;
  };
}

export interface AgentRunnerCapabilities {
  acceptsPromptSubmission: boolean;
  acceptsCommands: boolean;
  supportsInterrupt: boolean;
  supportsResumeByReference: boolean;
  supportsCheckpoint: boolean;
  exportFormats?: string[];
  shareModes?: string[];
}
```

Capabilities exist so daemon-owned control surfaces can present or suppress features without leaking provider logic into workflow state or UI heuristics.

## Snapshot Contract

```ts
export interface AgentProgressSnapshot {
  state: AgentProgressState;
  summary?: string;
  detail?: string;
  units?: {
    completed?: number;
    total?: number;
    unit?: string;
  };
  updatedAt: string;
}

export interface AgentSessionSnapshot {
  runnerId: AgentRunnerId;
  sessionId: AgentSessionId;
  missionId: string;
  taskId: string;
  stageId: string;
  status: AgentSessionStatus;
  attention: AgentAttentionState;
  progress: AgentProgressSnapshot;
  waitingForInput: boolean;
  acceptsPrompts: boolean;
  acceptedCommands: AgentCommand['type'][];
  workingDirectory: string;
  reference: AgentSessionReference;
  failureMessage?: string;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
}

export interface AgentRuntimeError extends Error {
  readonly code: AgentRuntimeErrorCode;
  readonly runnerId?: AgentRunnerId;
  readonly sessionId?: AgentSessionId;
}
```

Rules:

1. snapshots are the public representation of live session state
2. `waitingForInput` is not the same thing as termination or failure
3. transport details are diagnostic and reconciliation data only
4. mission workflow state is derived from normalized snapshots and events, not provider-native output

## Prompt And Command Contract

```ts
export interface AgentPrompt {
  source: 'engine' | 'operator' | 'system';
  text: string;
  title?: string;
  metadata?: AgentMetadata;
}

export type AgentCommand =
  | { type: 'interrupt'; reason?: string; metadata?: AgentMetadata }
  | { type: 'checkpoint'; reason?: string; metadata?: AgentMetadata }
  | { type: 'nudge'; reason?: string; metadata?: AgentMetadata }
  | { type: 'resume'; reason?: string; metadata?: AgentMetadata };
```

These commands are Mission intents.

Adapters map them to executable-native mechanisms.

Mission core must not make provider-native slash commands the primary contract.

## Event Contract

```ts
export type AgentSessionEvent =
  | { type: 'session.started'; snapshot: AgentSessionSnapshot }
  | { type: 'session.attached'; snapshot: AgentSessionSnapshot }
  | { type: 'session.updated'; snapshot: AgentSessionSnapshot }
  | { type: 'session.awaiting-input'; snapshot: AgentSessionSnapshot }
  | {
      type: 'session.message';
      channel: 'stdout' | 'stderr' | 'system' | 'agent';
      text: string;
      snapshot: AgentSessionSnapshot;
    }
  | { type: 'session.completed'; snapshot: AgentSessionSnapshot }
  | { type: 'session.failed'; reason: string; snapshot: AgentSessionSnapshot }
  | { type: 'session.cancelled'; reason?: string; snapshot: AgentSessionSnapshot }
  | { type: 'session.terminated'; reason?: string; snapshot: AgentSessionSnapshot };
```

The event stream is the adapter-normalized observation surface that Mission uses to keep workflow state and operator surfaces current.

## Agent Runner Interface

`AgentRunner` is the factory and adapter boundary.

```ts
export interface AgentRunner {
  readonly id: AgentRunnerId;
  readonly displayName: string;

  getCapabilities(): Promise<AgentRunnerCapabilities>;
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  validateLaunchConfig(config: AgentLaunchConfig): Promise<void>;
  startSession(config: AgentLaunchConfig): Promise<AgentSession>;
  reconcileSession(reference: AgentSessionReference): Promise<AgentSession>;
}
```

Meaning:

- `getCapabilities()` exposes daemon-usable feature support
- `isAvailable()` reports whether the runner can actually be used on this machine
- `validateLaunchConfig(...)` rejects invalid configuration before process spawn
- `startSession(...)` launches or resumes according to Mission config
- `reconcileSession(...)` reattaches after daemon restart or external reconnect

## Agent Session Interface

`AgentSession` is the live instance boundary.

```ts
export interface AgentSession {
  readonly reference: AgentSessionReference;

  getSnapshot(): AgentSessionSnapshot;
  onDidEvent(listener: (event: AgentSessionEvent) => void): { dispose(): void };

  submitPrompt(prompt: AgentPrompt): Promise<AgentSessionSnapshot>;
  submitCommand(command: AgentCommand): Promise<AgentSessionSnapshot>;

  cancel(reason?: string): Promise<AgentSessionSnapshot>;
  terminate(reason?: string): Promise<AgentSessionSnapshot>;
}
```

Rules:

1. `submitPrompt(...)` and `submitCommand(...)` reject with `AgentRuntimeError` when unsupported or invalid for current state
2. `cancel(...)` is best-effort graceful stop
3. `terminate(...)` is hard stop when graceful control is insufficient
4. the session owns no workflow policy; it only executes Mission intents against one live external process or provider session

## Daemon-Owned Agent Control Path

Mission should expose one daemon-owned control path for both workflow and external surfaces.

That shared path is responsible for:

- resolving a runner for launch or reconciliation
- holding live `AgentSession` instances in memory
- persisting `AgentSessionReference` and normalized snapshots where needed
- subscribing to session events and translating them into workflow events and daemon broadcasts
- serving `task.launch` and `session.*` IPC methods for surfaces such as Tower, Airport, or future clients

Surfaces do not talk to adapters directly.

The workflow engine does not parse provider output directly.

Both rely on the same daemon-owned control path built on `AgentRunner` and `AgentSession`.

## Reconciliation Rule

Recovery after daemon restart is owned by the daemon-side control layer using `AgentRunner.reconcileSession(...)`.

The workflow engine must not perform executable-specific reattachment.

The adapter must determine whether the previously persisted reference still represents a live session and normalize the result back into a session snapshot and event stream.

## Fresh-System Rule

The new runtime system must be built from this boundary downward.

Do not preserve an `AgentRuntime` public wrapper just because current code has one.

Do not preserve a workflow-only runner path and a separate interactive runtime path.

Do not preserve a Tower-specific session control model.

The durable execution model is:

1. Mission emits intent
2. daemon-owned control resolves a runner
3. runner creates or reconciles a session
4. session executes and emits normalized observations
5. Mission persists workflow truth from those observations

## Invariants

1. Mission core owns intent and lifecycle truth.
2. Adapters own executable translation and parsing.
3. The runner is the factory boundary.
4. The session is the live instance boundary.
5. Workflow launches and external session commands use the same daemon-owned control path.
6. Provider-native controls remain adapter detail unless they become real cross-runner Mission semantics.

## Initial Implementation Scope

The first implementation pass should deliver:

1. one `AgentRunner` interface in core
2. one `AgentSession` interface in core
3. one daemon-owned control service using those interfaces
4. one thin CLI-backed adapter implementation
5. workflow and external session control routed through the same service

The first pass does not need:

1. a public `AgentRuntime` wrapper interface
2. Tower-specific session command models
3. public transport abstractions beyond session references and diagnostic transport data
4. provider-specific settings elevated into core semantic fields
