---
layout: default
title: Agent Execution Interaction Journal PRD
parent: Architecture
nav_order: 8.7
description: Product requirements for the canonical semantic AgentExecution interaction journal.
---

## Purpose

Mission needs one canonical semantic interaction model for AgentExecution. The current architecture already separates Agent adapters, Terminal, AgentExecution, Mission workflow state, stdout markers, MCP tools, observations, and terminal recordings. The missing piece is a durable semantic journal that records what the Mission system understood and accepted during an AgentExecution.

The central product requirement is:

```text
PTY stream != semantic interaction
terminal recording != interaction journal
```

Terminal recordings preserve raw transport audit. Mission workflow events preserve orchestration truth. The AgentExecution interaction journal must preserve semantic execution truth: accepted owner/operator messages, runtime observations, policy decisions, state effects, and projection material needed to reconstruct AgentExecution state after restart or replay.

## Problem

AgentExecution interaction is currently split across several useful but incomplete records:

- Mission workflow runtime persists AgentExecution lifecycle participation and terminal recording references, but not semantic interaction.
- Terminal recordings persist raw input/output, but not normalized messages, observations, policy decisions, or owner effects.
- AgentExecution `chatMessages` provide a UI-friendly view, but they are not a durable source of truth for Mission-backed executions.
- Observation idempotency is held in memory, so daemon restart or adapter replay can lose the durable duplicate ledger.
- `execution.message` events carry loose text rather than a schema-backed semantic interaction record.
- `awaiting-input` currently behaves like lifecycle in some places, even though it is collaboration attention plus input-request state.

Without a canonical semantic journal, Airport timelines, recovery, audit, replay, and future provider integrations will each be tempted to derive truth from different sources.

## Goal

Create a durable AgentExecution interaction journal that is append-only, schema-validated, replayable, and owned by the AgentExecution Entity model.

The journal must allow the daemon to reconstruct:

- AgentExecution lifecycle, attention, semantic activity, and current input-request state.
- accepted AgentExecution messages sent by operator, daemon, system, or owning Entity.
- runtime observations from stdout markers, MCP tools, provider output, terminal heuristics, filesystem/git observation, or daemon-authored facts.
- policy decisions and rejection reasons.
- input requests and corresponding operator responses.
- claims, owner effects, workflow effects, and projection-facing timeline material.
- latest retained runtime activity and telemetry when those facts are promoted into journal records.
- idempotency state for processed observations and delivered messages.

## Non-Goals

- Do not make Message a standalone Entity.
- Do not collapse Terminal recordings, AgentExecution interaction journals, and Mission workflow event logs into one file or one event type.
- Do not make Airport chat/timeline state authoritative.
- Do not treat Agent-declared file activity as filesystem truth.
- Do not store raw private reasoning as semantic `thinking` content.
- Do not expose MCP tools as stable public automation APIs.
- Do not introduce owner-specific execution classes such as MissionAgentExecution, TaskAgentExecution, RepositoryAgentExecution, or ArtifactAgentExecution.

## Product Principles

### Durable Truth Before Projection

The journal is the source for AgentExecution semantic state. Chat messages, timelines, badges, grouped event views, and terminal decorations are projections over journal records and live runtime snapshots.

### Transport Neutrality

The same semantic observation can arrive through stdout marker, `mission-mcp`, provider SDK output, terminal heuristic, filesystem watcher, git watcher, or daemon-owned runtime code. Transport affects provenance and confidence, not the domain path.

### Owner Separation

AgentExecution owns execution interaction truth. Mission workflow runtime owns orchestration truth. Terminal owns PTY truth. Owning Entities decide scope-specific meaning and legal effects.

### Storage Neutrality

AgentExecution journals are not Entity-specific storage formats. A System, Repository, Mission, Task, or Artifact owner may cause a storage adapter to choose a different path or table key, but all owners use the same AgentExecution journal records, append/read behavior, replay behavior, and idempotency rules.

The canonical journal reference names the owner and AgentExecution, not a filesystem backend. Filesystem roots such as the Mission dossier, Repository `.mission` directory, or System config/state folder are implementation details of the file-backed store. A later database store may persist records in one table keyed by the same journal reference.

### Replayability

The journal is correct only if AgentExecution semantic state and projection data can be reconstructed deterministically from it, within documented live-runtime limitations.

### Runtime Overlay

Replay reconstructs semantic truth. Active PTY state, active transport connections, in-flight delivery attempts, current terminal screen buffers, active tool calls, and heartbeats belong to a live runtime snapshot overlay unless they are explicitly promoted into journal records.

## Canonical Directionality

Mission must preserve these directional terms:

| Direction | Canonical term | Meaning |
| --- | --- | --- |
| owner/operator/daemon to AgentExecution | AgentExecutionMessage | structured input accepted by the daemon for delivery or context mutation |
| Agent runtime to Mission system | Observation | normalized observed thing from a transport, adapter, runtime, filesystem, git, or daemon source |
| Agent-authored structured output | AgentDeclaredSignal | one possible observation payload authored by the Agent |
| policy result | AgentExecutionDecision | accepted, rejected, recorded-only, promoted, or state-changing interpretation |
| durable audit | AgentExecutionJournalRecord | append-only semantic interaction record |
| UI | projection | derived chat/timeline/status view |

## Status Dimensions

AgentExecution status must separate orchestration lifecycle from collaboration attention and semantic activity.

Recommended dimensions:

```ts
type AgentExecutionLifecycle =
  | 'starting'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'terminated';

type AgentExecutionAttention =
  | 'none'
  | 'autonomous'
  | 'awaiting-operator'
  | 'awaiting-system'
  | 'blocked';

type AgentExecutionActivity =
  | 'idle'
  | 'planning'
  | 'reasoning'
  | 'communicating'
  | 'editing'
  | 'executing'
  | 'testing'
  | 'reviewing';
```

Capabilities are separate snapshots, not status values:

```ts
type AgentExecutionCapabilitySnapshot = {
  terminalAttached: boolean;
  streaming: boolean;
  toolCallActive: boolean;
  filesystemMutating: boolean;
};
```

`awaiting-input` should converge from lifecycle into:

```text
lifecycle: running
attention: awaiting-operator
activity: idle or communicating
currentInputRequestId: <journal record id>
```

Noisy progress and runtime telemetry should not be stored inside semantic state transitions. Progress percentages, token counts, streaming summaries, active file labels, and transient execution metadata belong in runtime activity records such as `activity.updated`, where they can be compacted or summarized without changing lifecycle replay.

Live runtime state is a separate overlay:

```ts
type AgentExecutionRuntimeSnapshot = {
  attachedTerminalAgentExecutionId?: string;
  activeTransportConnections: string[];
  activeToolCalls?: Array<{ toolCallId: string; toolName: string; startedAt: string }>;
  inFlightDeliveries?: Array<{ messageId: string; attemptedAt: string }>;
  lastHeartbeatAt?: string;
};
```

## Journal Separation

For Mission-backed executions, the Mission dossier may retain separate records:

```text
agent-journals/<agent-execution-id>.interaction.jsonl   semantic AgentExecution interaction truth
terminal-recordings/<agent-execution-id>.terminal.jsonl raw PTY transport audit
agent-executions/<agent-execution-id>.metadata.json      runtime metadata and terminal references
mission.events.jsonl                                    Mission workflow orchestration truth
```

Mission runtime data should store only workflow participation and references:

```ts
type AgentExecutionRuntimeState = {
  agentExecutionId: string;
  taskId: string;
  agentId: string;
  lifecycle: AgentExecutionLifecycle;
  agentJournalPath?: string;
  terminalLogPath?: string;
  launchedAt: string;
  updatedAt: string;
};
```

The Mission dossier path is a file-store choice, not a Mission-specific journal storage engine. The shared AgentExecution journal store writes and reads records for an owner-scoped journal reference; file-backed stores derive paths from owner context, while future database-backed stores can ignore filesystem paths entirely.

## Acceptance Criteria

- AgentExecution has one schema-backed semantic journal model.
- The journal records accepted AgentExecution messages, observations, decisions, state effects, and projection material.
- Semantic state transitions are distinct from runtime activity or telemetry updates.
- Terminal recordings remain raw transport audit and are not used as semantic source of truth.
- Mission workflow event logs remain orchestration truth and do not become transcripts.
- `chatMessages` and Airport timelines are projections over the journal.
- Observation duplicate detection survives daemon restart and replay.
- `needs_input` creates a durable input-request record; operator response is a separate AgentExecutionMessage record.
- AgentExecution state can be reconstructed from journal records in deterministic tests.
- AgentExecution lifecycle, attention, semantic activity, runtime activity, telemetry, capabilities, and live runtime snapshots are separable in data and projections.
- Existing stdout-marker and `mission-mcp` transports route through the same journal path.
- Existing AgentExecution message descriptors and Agent-declared signal descriptors are materialized from one protocol catalog.

## Phase-One Product Decisions

1. Airport reads the bounded `chatMessages` projection on AgentExecution data. Cursor-based older journal windows can be added after the replay path is stable.
2. Owner effect records are written only when an accepted observation actually emits an Entity event or Mission workflow event. No placeholder owner-effect records in phase one.
3. Filesystem and git observations wait until the interaction journal, replay path, and observation idempotency hydration are stable.
4. Journal compaction waits until there is measured read or storage pressure. Phase one keeps append-only records and derives projection at replay time.
5. New AgentExecutions must resolve durable journal storage before launch. Phase one does not silently fall back to in-memory journals.
