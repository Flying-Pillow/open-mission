---
layout: default
title: Agent Execution Interaction Journal
parent: Architecture Decisions
nav_order: 25
status: accepted
date: 2026-05-09
decision_area: agent-execution-persistence
owners:
  - maintainers
supersedes: []
superseded_by: []
---

The Mission system persists AgentExecution semantic interaction in an append-only AgentExecution interaction journal that is separate from terminal recordings and Mission workflow event logs.

The interaction journal is the durable source for AgentExecution semantic state, replay, audit, and UI projection. Terminal recordings remain raw PTY transport audit. Mission workflow event logs remain orchestration truth. Airport chat and timeline views are projections over AgentExecution journal records and live runtime snapshots, not independent sources of truth.

## Context

Mission already separates AgentExecution, AgentExecutor, AgentAdapter, Terminal, Mission workflow runtime, stdout markers, MCP tools, observations, Entity events, and terminal recordings. That separation is correct, but the persistence model has not yet caught up with the protocol vocabulary.

The current implementation records useful facts in several places:

- Mission workflow runtime stores AgentExecution lifecycle participation and terminal recording references.
- Terminal recordings store raw PTY input, output, resize, and exit records.
- AgentExecution data can include `chatMessages`, but those are projection material rather than durable semantic authority.
- AgentExecution observation duplicate detection is currently runtime-local.
- Mission workflow event logs record orchestration facts, not interaction transcripts.

Without a canonical semantic interaction journal, recovery and UI code would need to reconstruct execution truth from terminal scrollback, live memory, or surface state. That would violate repository-owned truth, deterministic validation, and Entity ownership.

## Decision

AgentExecution owns a durable interaction journal for semantic execution records. The journal identity is AgentExecution-scoped and owner-addressed: System, Repository, Mission, Task, and Artifact ownership may influence where a journal is stored, but it must not create different journal schemas, append/read behavior, replay behavior, or idempotency rules.

The AgentExecution journal reference names the owner and execution, not a filesystem backend. Filesystem paths, config-folder roots, Repository control roots, Mission dossier roots, and future database table names are storage adapter concerns.

For Mission-backed AgentExecutions, the file-backed store can write under the Mission dossier in an Agent journal location distinct from terminal recordings:

```text
agent-journals/<agent-execution-id>.interaction.jsonl
terminal-recordings/<agent-execution-id>.terminal.jsonl
agent-executions/<agent-execution-id>.metadata.json
```

The interaction journal records schema-validated facts such as:

- journal header and frozen protocol descriptor.
- accepted AgentExecution messages.
- message delivery attempts and outcomes.
- normalized AgentExecution observations.
- policy decisions, including rejected and recorded-only observations.
- semantic state changes for lifecycle, attention, activity, and current input request.
- runtime activity and telemetry updates for progress, token usage, active tools, streaming state, active targets, and other compressible runtime metadata.
- owner effects that link accepted observations to Entity events or Mission workflow events.
- projection material such as chat or timeline items when useful for efficient reads.

AgentExecution messages are owner/operator/daemon-to-AgentExecution input. Agent runtime output is not an AgentExecution message. Runtime output becomes an AgentExecution observation, optionally carrying an Agent-declared signal when the Agent authored structured output. The policy result becomes a durable decision record before state or owner effects are applied.

Mission must keep these ledgers distinct:

| Ledger | Owner | Truth |
| --- | --- | --- |
| AgentExecution interaction journal | AgentExecution | semantic interaction, replay, audit, projection source |
| Terminal recording | Terminal | raw PTY transport input/output/resize/exit audit |
| Mission workflow event log | Mission workflow runtime | orchestration state and workflow legality |

Mission workflow runtime stores workflow participation and references to the AgentExecution interaction journal and terminal recording. It must not store full message transcripts or UI chat state.

Mission dossier filesystem helpers may construct and validate Mission-backed journal paths, but they are file-adapter helpers only. The shared AgentExecution journal store owns record append, read, and replay behavior for AgentExecution journal references. A future database-backed store may persist all records in one table keyed by the same journal reference without changing AgentExecution journal identity.

## Status Model

AgentExecution status is modeled as multiple dimensions rather than one overloaded lifecycle enum.

Lifecycle is orchestration truth: starting, running, paused, completed, failed, cancelled, terminated.

Attention is collaboration truth: none, autonomous, awaiting-operator, awaiting-system, blocked.

Activity is current semantic work posture: idle, planning, reasoning, communicating, editing, executing, testing, reviewing.

Progress, token counts, streaming summaries, active file labels, active tool names, and transient execution metadata are runtime activity or telemetry. They are recorded separately from semantic `state.changed` records so they can be compacted, sampled, or summarized without changing lifecycle replay.

Capabilities are runtime affordances and observed activity flags, such as terminal attached, streaming, active tool call, or filesystem mutation. Capabilities are snapshots, not lifecycle states.

Live process state is represented by an AgentExecution runtime snapshot overlay when the execution is active. That snapshot may include attached terminal identity, active transport connections, current PTY state, active tool calls, in-flight delivery attempts, and heartbeat data. The snapshot is not a substitute for journal replay; live facts that must survive restart need explicit journal records.

`awaiting-input` should converge out of lifecycle. It is represented as a running execution with `attention: awaiting-operator` and a current input-request journal record.

## Consequences

- AgentExecution state can be reconstructed from journal records after daemon restart or reconcile.
- Semantic replay does not require retaining every noisy progress or telemetry update.
- Duplicate observation detection is hydrated from durable journal records, not only in-memory sets.
- Airport timelines and chat views become projections over AgentExecution truth.
- Terminal output can be displayed and audited without becoming semantic truth.
- Mission workflow state stays focused on tasks, AgentExecutions, gates, launch queues, and lifecycle transitions.
- Agent-declared file activity can be recorded as semantic observation or activity, but filesystem/git truth must come from filesystem/git observation or explicit daemon state.
- Interaction journal schema changes are Mission runtime data changes and must follow ADR-0005 rather than fallback parsing or compatibility aliases.

## Implementation Rules

- Do not create a standalone Message Entity unless independent message lifecycle, addressing, querying, or permissions become real requirements.
- Do not use terminal recordings as the source of AgentExecution semantic state.
- Do not store raw private reasoning as semantic thinking content.
- Do not put high-frequency progress, token usage, streaming summaries, or transient target metadata inside semantic `state.changed` records.
- Do not let Airport write transcript truth.
- Do not let MCP, stdout markers, provider SDK events, terminal heuristics, filesystem observation, or git observation bypass the observation to decision to journal path.
- Do not encode filesystem backend kinds such as Mission dossier, Repository control state, or local config folder as AgentExecution journal domain identity.
- Do not fork AgentExecution journal storage behavior by owning Entity scope; only storage adapter path/table resolution may vary by scope.
- Do not start a new AgentExecution when durable journal storage or the journal header cannot be written.
- Do keep AgentDeclaredSignal as the precise name for Agent-authored structured signals; use AgentExecutionObservation for the broader normalized observed fact.
- Do keep journal replay deterministic and covered by tests.
