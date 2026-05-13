---
layout: default
title: Agent Execution Interaction Journal Spec
parent: Architecture
nav_order: 8.8
description: Implementation spec for the canonical semantic AgentExecution interaction journal and replay model.
---

## Scope

This spec implements the requirements in [Agent Execution Interaction Journal PRD](agent-execution-interaction-journal-prd.md) and the decision in ADR-0025.

The implementation creates one durable semantic interaction path for AgentExecution without replacing Terminal recordings, Mission workflow events, AgentExecution protocol descriptors, or Entity commands.

## Authoritative Inputs

- `CONTEXT.md`: canonical Mission vocabulary.
- ADR-0004: runtime-defined AgentExecution messages.
- ADR-0011: AgentExecution logs as daemon audit material.
- ADR-0017: prompt-scoped Agent execution signals.
- ADR-0018: Agent, AgentAdapter, AgentExecutor, AgentExecution, and Terminal vocabulary.
- ADR-0022: AgentExecution structured interaction vocabulary.
- ADR-0024: Mission MCP server Agent signal transport.
- ADR-0025: AgentExecution interaction journal persistence.

## Ownership

### AgentExecution

AgentExecution owns:

- journal record schemas and inferred types.
- append-only semantic interaction state.
- replay from journal records into AgentExecution state.
- idempotency for message ids and observation ids.
- projection from journal records into chat/timeline data.
- lifecycle, attention, semantic activity, and input-request state.
- journaled runtime activity and telemetry records when runtime facts are promoted from live overlay into durable audit material.
- the storage contract for append/read/replay semantics, independent of owning Entity scope.

### AgentExecutor

AgentExecutor owns:

- writing runtime-observed records through AgentExecution, not directly to the filesystem.
- routing stdout markers, MCP tool calls, provider output, terminal heuristics, and daemon runtime facts into observations.
- delivering AgentExecutionMessages to the selected AgentAdapter or terminal controller.
- recording delivery attempts and failures.

### Mission Workflow Runtime

Mission workflow runtime owns:

- task and AgentExecution orchestration state.
- launch, completion, failure, cancellation, termination, and task-completion workflow events.
- references to AgentExecution journal and terminal recording paths for Mission-backed executions.

Mission workflow runtime does not own message transcripts, chat projection, observation policy, or terminal I/O truth.

### AgentExecution Journal Store

The AgentExecution journal store is owner-independent. Its behavior must not fork by owning Entity type. System, Repository, Mission, Task, and Artifact ownership may cause a storage adapter to choose a different filesystem path or database key, but every owner uses the same journal record schemas, append semantics, read semantics, replay semantics, and idempotency rules.

The storage contract is shaped around an AgentExecution journal reference rather than a filesystem backend location:

```ts
type AgentExecutionJournalReference = {
  journalId: string;
  ownerEntity: 'System' | 'Repository' | 'Mission' | 'Task' | 'Artifact';
  ownerId: string;
  agentExecutionId: string;
  recordCount: number;
  lastSequence: number;
};

type AgentExecutionJournalStore = {
  ensureJournal(reference: AgentExecutionJournalReference): Promise<void>;
  appendRecord(reference: AgentExecutionJournalReference, record: AgentExecutionJournalRecord): Promise<void>;
  readRecords(reference: AgentExecutionJournalReference): Promise<AgentExecutionJournalRecord[]>;
};
```

Storage adapters may inspect the journal reference and runtime context to choose where bytes live. They must not change the journal shape or implement alternate append/read/replay behavior by owner type.

Phase-one file-backed path policy is explicit:

- System-owned journals live under the configured System config/state folder.
- Repository-owned journals live under the main Repository `.mission` control state.
- Mission-owned journals live under `.mission/missions/<missionId>`.
- Task-owned journals live under the owning Mission dossier.
- Artifact-owned journals are deferred until Artifact-scoped AgentExecution persistence is implemented.

If durable storage cannot be resolved, launch must fail before the journal header is written. Phase one must not silently fall back to an in-memory journal for new AgentExecutions.

### Terminal

Terminal and TerminalRegistry own raw PTY input, output, resize, screen, exit, and terminal recording updates.

### Live Runtime Snapshot

Replay reconstructs semantic AgentExecution truth. It does not reconstruct every live process detail.

AgentExecutor and Terminal may expose a live runtime snapshot for active executions. The runtime snapshot is an overlay used for current UI and runtime control; it is not the durable semantic source of truth.

Suggested shape:

```ts
type AgentExecutionRuntimeSnapshot = {
  agentExecutionId: string;
  capturedAt: string;
  attachedTerminalAgentExecutionId?: string;
  activeTransportConnections: string[];
  currentPtyState?: {
    terminalName: string;
    connected: boolean;
    dead: boolean;
    cols?: number;
    rows?: number;
  };
  currentTerminalSnapshotRef?: string;
  activeToolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    startedAt: string;
    status: 'running' | 'cancelling';
  }>;
  inFlightDeliveries?: Array<{
    messageId: string;
    transport: 'agent-message' | 'pty-terminal' | 'adapter';
    attemptedAt: string;
  }>;
  lastHeartbeatAt?: string;
};
```

If live runtime facts should survive restart, explain durable audit, or affect deterministic replay, they must be promoted into journal records. Otherwise they remain runtime overlay data.

## Storage Layout

The first implementation uses the same AgentExecution journal store for every supported owner. The file-backed storage engine writes newline-delimited `AgentExecutionJournalRecord` values to an adapter-resolved path for an `AgentExecutionJournalReference`.

For Mission-backed AgentExecutions, the file-backed store may write under the Mission dossier in an Agent journal location distinct from terminal recordings:

```text
agent-journals/<encoded-agent-execution-id>.interaction.jsonl
terminal-recordings/<encoded-agent-execution-id>.terminal.jsonl
agent-executions/<encoded-agent-execution-id>.metadata.json
```

Mission dossier modules may expose validated path construction and reference helpers for Mission-backed Agent journal locations:

- `getMissionAgentJournalRelativePath(agentExecutionId)`
- `resolveMissionAgentJournalPath(missionDir, agentJournalPath)`

The Agent journal path pattern is:

```text
agent-journals/<agentExecutionId>.interaction.jsonl
```

Those Mission helpers must not become a separate Mission-specific journal storage engine. `ensure`, `append`, and `read` belong to the shared AgentExecution journal store after the file-backed store has resolved a path for the journal reference.

Repository and System file-backed relative paths should use the same filename convention:

```text
agent-journals/<encoded-agent-execution-id>.interaction.jsonl
```

The root path differs by owner context; the relative interaction journal filename pattern does not. This path policy is not AgentExecution journal identity and must not block a future database-backed store from writing all journal records to one table.

## Schema Model

Add the journal schemas in the AgentExecution Entity module, preferably in a dedicated file imported by `AgentExecutionSchema.ts` if the schema file becomes too broad.

Phase one should keep two explicit registries rather than one over-generalized event table.

### Journal Record Registry

The journal record registry is the canonical list of appendable journal record kinds. It owns record discrimination, schema validation, and replay routing for top-level journal entries.

| Record type | Purpose | Canonical owner |
| --- | --- | --- |
| `journal.header` | freezes launch contract and journal identity | AgentExecution journal record registry |
| `message.accepted` | records accepted owner/operator/daemon input | AgentExecution journal record registry |
| `message.delivery` | records best-effort delivery attempts and outcomes | AgentExecution journal record registry |
| `observation.recorded` | records normalized runtime observations | AgentExecution journal record registry |
| `decision.recorded` | records durable policy outcomes | AgentExecution journal record registry |
| `state.changed` | records semantic lifecycle, attention, activity, and input-request transitions | AgentExecution journal record registry |
| `activity.updated` | records compressible runtime activity and telemetry | AgentExecution journal record registry |
| `owner-effect.recorded` | records accepted owner-facing effects | AgentExecution journal record registry |
| `projection.recorded` | reserves durable projection materialization for later phases | AgentExecution journal record registry |

The journal record registry stays explicit even when some record payloads derive from narrower registries. Do not force headers, decisions, state changes, or owner effects through a signal-shaped registry.

### Signal Registry

The signal registry is narrower. It owns the canonical AgentExecution signal vocabulary used inside `observation.recorded.signal` and drives the descriptor list, the journal signal payload variants, and replay projection behavior.

| Signal type | Payload schema key | Descriptor surfaced | Replay chat projection |
| --- | --- | --- | --- |
| `progress` | `agent-signal.progress.v1` | yes | progress message |
| `status` | `agent-signal.status.v1` | yes | status message |
| `needs_input` | `agent-signal.needs-input.v1` | yes | needs-input message |
| `blocked` | `agent-signal.blocked.v1` | yes | blocked message |
| `ready_for_verification` | `agent-signal.ready-for-verification.v1` | yes | claim message |
| `completed_claim` | `agent-signal.completed-claim.v1` | yes | claim message |
| `failed_claim` | `agent-signal.failed-claim.v1` | yes | failure message |
| `message` | `agent-signal.message.v1` | yes | chat message |
| `usage` | none | no | none |
| `diagnostic` | none | no | none |

Journal replay should project `observation.recorded.signal` through the signal registry rather than duplicating one switch per signal family in multiple modules.

Suggested baseline:

```ts
type AgentExecutionJournalRecord =
  | AgentExecutionJournalHeaderRecord
  | AgentExecutionMessageAcceptedRecord
  | AgentExecutionMessageDeliveryRecord
  | AgentExecutionObservationRecord
  | AgentExecutionDecisionRecord
  | AgentExecutionStateChangedRecord
  | AgentExecutionActivityUpdatedRecord
  | AgentExecutionOwnerEffectRecord
  | AgentExecutionProjectionRecord;
```

Every record has:

```ts
type AgentExecutionJournalRecordBase = {
  recordId: string;
  sequence: number;
  type: string;
  schemaVersion: 1;
  agentExecutionId: string;
  ownerId: string;
  scope: AgentExecutionScopeType;
  occurredAt: string;
};
```

### Header Record

The first record identifies the journal and frozen launch contract:

```ts
type AgentExecutionJournalHeaderRecord = AgentExecutionJournalRecordBase & {
  type: 'journal.header';
  kind: 'agent-execution-interaction-journal';
  agentId: string;
  protocolDescriptor: AgentExecutionProtocolDescriptorType;
  transportState?: AgentExecutionTransportStateType;
  workingDirectory?: string;
};
```

Header creation is mandatory before the Agent runtime receives the initial prompt or launch instructions. AgentExecutor resolves durable journal storage for the journal reference, ensures the journal, appends `journal.header`, and only then starts delivery to the runtime. If header append fails, launch fails and no Agent runtime should be started.

### Message Records

Owner/operator/daemon-to-AgentExecution input is recorded as a message before delivery:

```ts
type AgentExecutionMessageAcceptedRecord = AgentExecutionJournalRecordBase & {
  type: 'message.accepted';
  messageId: string;
  source: 'operator' | 'daemon' | 'system' | 'owner';
  messageType: string;
  payload: unknown;
  mutatesContext: boolean;
};
```

Phase-one message mapping is fixed:

| Current input | Journal record | Source | Delivery record |
| --- | --- | --- | --- |
| `submitPrompt` with `source: operator` | `message.accepted` | `operator` | yes |
| `submitPrompt` with `source: system` | `message.accepted` | `system` | yes |
| `submitPrompt` with `source: engine` | `message.accepted` | `daemon` | yes |
| `submitCommand` runtime command | `message.accepted` | `operator` or `daemon` from caller context | yes |
| raw terminal input | none | n/a | no |

Raw terminal input remains Terminal transport input. It can be recorded in terminal recordings, but it must not be treated as an AgentExecutionMessage unless it entered through an AgentExecution message descriptor.

Delivery is a separate best-effort record:

```ts
type AgentExecutionMessageDeliveryRecord = AgentExecutionJournalRecordBase & {
  type: 'message.delivery';
  messageId: string;
  status: 'attempted' | 'delivered' | 'failed' | 'skipped';
  transport: 'agent-message' | 'pty-terminal' | 'adapter' | 'none';
  reason?: string;
};
```

### Observation Records

Observations are transport-neutral:

```ts
type AgentExecutionObservationRecord = AgentExecutionJournalRecordBase & {
  type: 'observation.recorded';
  observationId: string;
  source: 'pty' | 'mcp' | 'sdk' | 'provider-output' | 'terminal-heuristic' | 'filesystem' | 'git' | 'daemon';
  confidence: 'authoritative' | 'high' | 'medium' | 'low' | 'diagnostic';
  signal?: AgentExecutionSignal;
  rawText?: string;
  payload?: Record<string, unknown>;
};
```

An AgentSignal remains a structured Agent-authored signal payload. It is one kind of observation payload, not the umbrella term for all runtime observations.

The `signal` field should derive from the canonical AgentExecution signal registry. The registry owns signal payload variants, descriptor metadata, and replay projection rules. `observation.recorded` still belongs to the journal record registry; only its signal payload family derives from the signal registry.

### Decision Records

Policy decisions are durable so replay can preserve idempotency and explain accepted/rejected effects:

```ts
type AgentExecutionDecisionRecord = AgentExecutionJournalRecordBase & {
  type: 'decision.recorded';
  decisionId: string;
  observationId?: string;
  messageId?: string;
  action: 'reject' | 'record-only' | 'emit-message' | 'update-state' | 'route-owner-effect';
  reason?: string;
};
```

Phase one maps existing `AgentExecutionObservationPolicy` decisions to journal decisions exactly:

| Existing decision action | Journal action |
| --- | --- |
| `reject` | `reject` |
| `record-observation-only` | `record-only` |
| `emit-message` | `emit-message` |
| `update-execution` | `update-state` |

`route-owner-effect` is reserved for the first owner effect that actually emits an Entity event or Mission workflow event from an accepted observation. Do not emit placeholder owner-effect records before there is a concrete owner effect.

### State Records

State records contain durable semantic transitions. They should stay low-frequency and meaningful for replay:

```ts
type AgentExecutionStateChangedRecord = AgentExecutionJournalRecordBase & {
  type: 'state.changed';
  lifecycle?: AgentExecutionLifecycleStateType;
  attention?: 'none' | 'autonomous' | 'awaiting-operator' | 'awaiting-system' | 'blocked';
  activity?: 'idle' | 'planning' | 'reasoning' | 'communicating' | 'editing' | 'executing' | 'testing' | 'reviewing';
  currentInputRequestId?: string | null;
};
```

Do not put noisy progress percentages, token counts, streaming summaries, active file paths, or transient tool metadata inside `state.changed`. Those facts are runtime activity and telemetry, not semantic state transitions.

`awaiting-input` is not a valid lifecycle state. Input requests are represented as `lifecycle: running` plus `attention: awaiting-operator` and `currentInputRequestId`.

### Runtime Activity Records

Runtime activity records contain high-frequency, compressible, or telemetry-shaped updates. They can be retained, compacted, sampled, or summarized without changing semantic lifecycle replay:

```ts
type AgentExecutionActivityUpdatedRecord = AgentExecutionJournalRecordBase & {
  type: 'activity.updated';
  activity?: 'idle' | 'planning' | 'reasoning' | 'communicating' | 'editing' | 'executing' | 'testing' | 'reviewing';
  progress?: {
    summary?: string;
    detail?: string;
    units?: { completed?: number; total?: number; unit?: string };
  };
  telemetry?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    activeToolName?: string;
  };
  capabilities?: {
    terminalAttached?: boolean;
    streaming?: boolean;
    toolCallActive?: boolean;
    filesystemMutating?: boolean;
  };
  currentTarget?: {
    kind: 'file' | 'command' | 'tool' | 'artifact' | 'unknown';
    label?: string;
    path?: string;
  };
};
```

The latest activity update may inform projections and operator status. Replay must not require every historical activity update to recover semantic lifecycle, attention, or input-request state.

### Owner Effect Records

Owner effects bridge accepted interaction to Entity events or workflow events:

```ts
type AgentExecutionOwnerEffectRecord = AgentExecutionJournalRecordBase & {
  type: 'owner-effect.recorded';
  effectId: string;
  observationId?: string;
  ownerEntity: 'System' | 'Repository' | 'Mission' | 'Task' | 'Artifact';
  effectType: string;
  workflowEventId?: string;
  entityEventId?: string;
  payload?: Record<string, unknown>;
};
```

### Projection Records

Projection records are optional durable material for efficient UI reconstruction. They are not the source of domain truth if they conflict with earlier records.

```ts
type AgentExecutionProjectionRecord = AgentExecutionJournalRecordBase & {
  type: 'projection.recorded';
  projection: 'timeline-item';
  payload: Record<string, unknown>;
};
```

Phase one derives `timelineItems` directly during replay from message, observation, decision, state, and activity records. It should not write `projection.recorded` records until a measured read-performance need appears. Keep the record type in the schema so the format has an explicit future compaction/materialization path.

## Replay

Add an `AgentExecutionJournalReplayer` module owned by AgentExecution.

Replay input:

- header record.
- ordered journal records.

Replay output:

- AgentExecution data shape.
- processed message id set.
- processed observation id set.
- current lifecycle, attention, semantic activity, and current input request.
- latest retained runtime activity and telemetry snapshot when present.
- projected timeline items.

Replay must be deterministic for the same ordered records. Invalid records fail clean-slate validation; do not add fallback parsing or compatibility aliases without a Mission runtime migration ADR.

Replay should route observation signal projection through the signal registry so descriptor metadata, journal signal variants, and timeline projection behavior stay aligned.

Live runtime snapshots are composed after replay for active read models. They must not change replay output, idempotency hydration, or semantic state reconstruction.

## Write Path

### Owner/Operator Message

```text
Entity command or AgentExecution command
  -> validate AgentExecutionMessageDescriptor
  -> append message.accepted
  -> mutate AgentExecution context if needed
  -> attempt adapter/terminal delivery
  -> append message.delivery
  -> append state/projection records if applicable
```

### Runtime Observation

```text
transport/provider/runtime input
  -> normalize AgentExecutionObservation
  -> append observation.recorded if not duplicate
  -> evaluate AgentExecutionObservationPolicy
  -> append decision.recorded
  -> append state.changed, activity.updated, or owner-effect.recorded records
  -> publish Entity events from accepted records
```

Duplicate observations must return an acknowledgement based on the durable journal state and must not append repeated effects.

## Read Model

AgentExecution data should expose projection fields derived from replay, not stored independently as authority:

- `projection.timelineItems` as recent or bounded projection data.
- `journal` metadata with path, cursor, record count, and last sequence.
- `status` dimensions for lifecycle, attention, and semantic activity.
- latest journaled runtime activity, telemetry, and capabilities.
- live runtime snapshot overlay when the execution is active.
- `protocolDescriptor` and message/signal descriptors.
- terminal recording reference when available.

The phase-one persisted AgentExecution data fields are:

```ts
type AgentExecutionJournalReference = {
  journalId: string;
  ownerEntity: 'System' | 'Repository' | 'Mission' | 'Task' | 'Artifact';
  ownerId: string;
  agentExecutionId: string;
  recordCount: number;
  lastSequence: number;
};
```

Mission workflow runtime should store only the Mission-backed Agent journal relative path needed for workflow participation and audit references:

```ts
agentJournalPath?: string;
```

The richer journal reference belongs on AgentExecution read data, not Mission workflow runtime data.

Open Mission should render from these projections and request older journal windows by cursor when needed.

## Migration Strategy

This is a Mission runtime data change because Mission workflow runtime needs an Agent journal location reference. Follow ADR-0005: no tolerant readers or hidden fallback parsers.

The first implementation may initialize an interaction journal for newly launched AgentExecutions only. Existing disposable local Mission state can be regenerated or migrated through an explicit runtime migration if preservation is required.

Repository and System journal roots are file-store path policy, not Mission runtime data migrations. They still use clean-slate validation for every journal record.

## Test Plan

- Schema tests for every journal record kind.
- Filesystem tests for shared journal store append/read behavior and Mission-backed location validation.
- Replay tests that reconstruct state from journal records.
- Replay tests proving semantic state reconstruction does not depend on retaining every `activity.updated` record.
- Replay tests proving live runtime snapshots do not affect deterministic replay output.
- Policy tests proving progress, token usage, streaming summaries, and transient targets append `activity.updated` rather than `state.changed`.
- Duplicate observation replay tests across fresh `AgentExecutionObservationPolicy` instances.
- `needs_input` tests proving request and response are separate records.
- MCP and stdout-marker tests proving both transports produce equivalent observation/decision records.
- Terminal recording tests proving raw terminal logs remain separate from interaction journals.
- Mission workflow tests proving runtime AgentExecution records store journal references while workflow state remains orchestration-only.
- Journal reference tests for owner-scoped identity and file-store path resolution.
- Header write tests proving launch fails before runtime start when the journal header cannot be appended.

## Implementation Sequence

1. Add AgentExecution journal schemas and types.
2. Add shared AgentExecution journal reference and store contracts.
3. Add owner-scoped AgentExecution journal references.
4. Add shared AgentExecution journal writer and reader over journal references, with filesystem path resolution kept inside the file-backed store.
5. Append `journal.header` before Agent runtime start and fail launch if it cannot be written.
6. Add journal replay and idempotency hydration.
7. Add live runtime snapshot overlay for active executions.
8. Route owner/operator messages through journal writes.
9. Route observations and decisions through journal writes.
10. Route noisy progress, telemetry, and transient target updates into `activity.updated` rather than `state.changed`.
11. Add Agent journal location references to Mission workflow runtime AgentExecution records through an explicit runtime data change.
12. Keep `timelineItems` as a replay-derived projection without writing `projection.recorded` records in phase one.
13. Keep input-request semantics out of lifecycle by representing them as `running` plus `attention` and `currentInputRequestId` in AgentExecution data.
14. Update Open Mission readers to consume projection fields rather than inventing local transcript truth.
