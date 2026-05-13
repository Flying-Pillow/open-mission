---
layout: default
title: Typed Agent Execution Journal Ledger
parent: Architecture Decisions
nav_order: 27
status: proposed
date: 2026-05-10
decision_area: agent-execution-persistence
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission should treat AgentExecution logs as one ordered audit and recovery record with strongly typed entry classes. The AgentExecution instance remains the canonical execution object while active; replayable recovery material must come from typed log entries, not from terminal paint, provider prose, or reconstruction across multiple auxiliary stores.

This proposal does not require collapsing every persistence concern into one undifferentiated text stream. It requires one ordered AgentExecution log and an explicit taxonomy that separates semantic observations, daemon-observed Agent execution facts, execution assessments, transport evidence, and replay-irrelevant projection material.

## Context

ADR-0011 and ADR-0025 correctly establish that AgentExecution logs and terminal recordings have different authority. The current implementation also already uses one append-only JSONL interaction log file with typed records such as `message.accepted`, `observation.recorded`, `decision.recorded`, `state.changed`, and `activity.updated`.

The current weakness is not the number of files. The weakness is that the journal vocabulary remains too signal-centric at the semantic boundary and too thin on replay-relevant execution context:

- agent-authored structured signals are first-class.
- daemon-observed Agent execution facts such as artifact reads and writes are not yet first-class.
- replay-relevant entries do not yet carry a normalized execution context for later diagnostics, evaluation, and orchestration.
- evaluative and verification-oriented metadata does not yet have a first-class non-semantic family.
- transport evidence is represented only indirectly through `rawText` or separate raw recordings.
- projection material exists, but its replay authority is not explicit.

That shape pressures the system toward brittle output-to-signal inference. A provider-native file read that occurs outside Mission-owned structured transport can be visible to an operator and still fail to become canonical semantic truth. The `BRIEF.md` read gap is one example.

## Decision

Mission should evolve AgentExecution logs into typed execution logs with one ordered sequence per AgentExecution.

The journal remains append-only. The important change is the taxonomy, execution context contract, and replay contract.

### Execution context metadata

Every replay-relevant entry should carry normalized execution context metadata.

Mission is not merely recording transcript fragments or PTY paint. Mission is recording execution semantics and the execution context under which those semantics were produced.

That means replay-relevant entries must preserve not only what happened, but also enough stable context to answer later:

- which owner Entity produced or owned the entry.
- which Mission, stage, task, session, repository, and worktree context owned it.
- which AgentAdapter, provider, model, and runtime mode produced it.
- which reasoning level or reasoning policy was active.
- which workflow stage or execution policy profile emitted it.
- which verifier or audit runtime emitted it when the entry came from a verification surface.
- which daemon/runtime and protocol version generated the record.

The exact field names may evolve, but the shared target shape should be normalized rather than buried in ad hoc payload fields.

For example:

```ts
executionContext: {
  owner: {
    entityType: 'MissionTask',
    entityId: 'task_123'
  },
  mission: {
    missionId: 'mission_456',
    stageId: 'implementation',
    taskId: 'task_123',
    agentExecutionId: 'agent-execution-789'
  },
  repository: {
    repositoryId: 'repo_001',
    worktreeId: 'worktree_002',
    branch: 'mission/typed-ledger'
  },
  runtime: {
    agentAdapter: 'copilot-cli',
    provider: 'openai',
    model: 'gpt-5.5',
    reasoningLevel: 'high',
    executionMode: 'interactive',
    executionProfile: 'implementation-default',
    verifier: false
  },
  daemon: {
    runtimeVersion: '1.2.3',
    protocolVersion: '2026-05-10'
  }
}
```

This context exists to support deterministic replay, evaluation, diagnostics, benchmarking, provider comparison, orchestration policy decisions, and future analytics. Contextual metadata does not replace journal family semantics; it makes replay-relevant records legible and comparable over time.

### Authority and trust

Every replay-relevant journal entry should carry an explicit authority/trust classification.

Mission does not need to preserve one exact field name, but the journal contract must distinguish at least these cases:

- who asserted or observed the entry.
- whether the entry is authoritative, advisory, or diagnostic.
- which transport, runtime, verifier, or surface produced it.
- whether the entry is safe to replay as semantic truth.

The trust contract should explicitly distinguish at least:

- daemon-observed authoritative facts.
- agent-authored claims.
- provider-native events.
- verifier assessments.
- diagnostic heuristics.
- transport evidence.

For example, these two records are not equivalent:

```ts
{
  type: 'runtime-fact',
  fact: 'artifact-read',
  path: 'BRIEF.md',
  authority: 'mission-artifact-tool',
  assertionLevel: 'authoritative',
  sourceSurface: 'open-mission-mcp'
}
```

```ts
{
  type: 'agent-observation',
  observation: 'message',
  text: 'I read BRIEF.md',
  authority: 'agent-authored',
  assertionLevel: 'informational',
  sourceSurface: 'provider-output'
}
```

The first is daemon-observed semantic truth. The second is an agent claim that may be useful to operators but must not silently upgrade into authoritative replay state.

Likewise, a verifier assessment such as `verification-confidence = 0.81` may influence orchestration, escalation, or audit decisions, but it is evaluative metadata rather than semantic truth.

### Canonical entry families

The journal should model at least these first-class families:

- `journal.header`: frozen descriptor and launch context.
- `turn.accepted`: operator, daemon, owner, or system input accepted for delivery to the AgentExecution.
- `turn.delivery`: attempted, delivered, failed, or skipped delivery feedback.
- `agent-observation`: structured Agent-authored observations such as `message`, `status`, `progress`, `needs_input`, and other declared signals.
- `agent-execution-fact`: daemon-observed structured facts such as `artifact-read`, `artifact-written`, `tool-invoked`, `tool-result`, `filesystem-change`, or `provider-event` when the daemon has structured authority.
- `execution-assessment`: evaluative or diagnostic metadata such as self-confidence, verification-confidence, retry-pressure, instability, contradiction-risk, hallucination-risk, task-stall-risk, unresolved-concern, or verification-gap.
- `transport-evidence`: raw or near-raw output chunks, provider event payloads, stderr excerpts, terminal snippets, or other expandable evidence that is not semantic truth by itself.
- `decision.recorded`: policy decisions and routing outcomes.
- `state.changed`: authoritative lifecycle, attention, and semantic activity changes.
- `activity.updated`: compressible AgentExecution activity and telemetry.
- `owner-effect.recorded`: links from accepted observations or Agent execution facts into owner Entity effects or workflow events.
- `checkpoint.recorded`: optional sequencing, compaction, or linkage markers when replay needs them.
- `projection.recorded`: optional cached projection material, explicitly non-canonical.

Mission does not need to preserve the exact names above, but it must preserve the separation of concerns they express.

`execution-assessment` is intentionally a top-level family rather than a subtype of observation or Agent execution fact. Mission needs a first-class home for assessment overlays that may influence orchestration intelligence, human-in-the-loop escalation, verification workflows, and audit interpretation without mutating semantic replay truth.

### Replay and compression classes

Every journal entry family should declare both replay authority and retention/compression behavior.

Mission does not need to use these exact labels, but it must separate at least:

- `replay-critical`: semantic truth required for deterministic replay.
- `replay-optional`: useful derived or cache material that may be ignored during replay.
- `evidence-only`: retained for audit, debugging, and UI expansion, but never required for semantic reconstruction.

Mission should also distinguish between:

- persistent semantic entries that remain individually durable.
- compressible runtime entries such as token deltas, spinner states, progress percentages, active targets, transient statuses, streaming provider updates, PTY chunk bursts, or other high-frequency telemetry.

`activity.updated` already points in this direction, but the classification should be explicit rather than implied by naming alone.

### Entry semantics

Every journal family should also declare its entry semantics explicitly.

Mission does not need to preserve one exact field name, but the contract should distinguish at least:

- `event`: immutable facts that accumulate in replay.
- `snapshot`: latest-wins overlay state that replay folds by replacement or overwrite.
- `assessment`: evaluative or diagnostic material that may influence orchestration but does not become semantic truth.
- `evidence`: raw or near-raw retained material that may support audit or UI expansion but does not participate in semantic replay.

For example:

```ts
{
  family: 'agent-execution-fact',
  entrySemantics: 'event',
  fact: 'artifact-written'
}
```

This accumulates as immutable semantic history.

```ts
{
  family: 'activity.updated',
  entrySemantics: 'snapshot',
  activeTarget: 'README.md'
}
```

This is replayed as overlay state where the latest applicable snapshot wins.

```ts
{
  family: 'execution-assessment',
  entrySemantics: 'assessment',
  instability: 0.72
}
```

This contributes evaluative overlay state, not semantic truth.

```ts
{
  family: 'transport-evidence',
  entrySemantics: 'evidence',
  stdoutChunk: '...'
}
```

This remains retained evidence and never becomes semantic truth by parsing alone.

This distinction matters because replay implementations otherwise become ambiguous about whether a record should accumulate, overwrite, fold, collapse, compress, or be ignored.

### Execution-assessment and diagnostic overlays

Mission should distinguish four different classes of replay-adjacent material:

- semantic replay state.
- runtime overlay reconstruction.
- diagnostic and assessment overlays.
- evidence expansion and cached projections.

Semantic replay must remain deterministic even if all transport evidence, assessment overlays, and cached projections are removed.

Within those layers, replay should also distinguish immutable event accumulation from latest-wins snapshot folding.

- event semantics accumulate as ordered execution history.
- snapshot semantics fold into the current overlay view by replacement or overwrite.
- assessment semantics remain evaluative overlays.
- evidence semantics remain replay-external support material.

Assessment records may influence orchestration and operator workflows, including:

- human-in-the-loop escalation.
- adaptive verification requests.
- instability analysis.
- retry and pause decisions.
- post-run audit and benchmarking.

But those records must not silently rewrite semantic replay truth. They remain heuristic, advisory, evaluative, or diagnostic even when they are valuable.

Assessment sources may include:

- agent self-assessment.
- runtime-derived diagnostics.
- verification-stage assessment.
- audit-stage evaluation.

Mission should explicitly discourage treating self-confidence, emotional wording, or model prose as authoritative truth. Those signals may be recorded as assessments or evidence, but not promoted into canonical semantic facts without an authoritative decision path.

### Replay semantics matrix

The replay contract is more important than the specific record names. For each journal entry family, Mission should define whether it affects semantic replay, affects the default timeline, contributes runtime overlays, contributes diagnostic overlays, which entry semantics it uses, whether it may be compressed, whether replay accumulates or folds it, whether it is canonical semantic truth, and whether it is expandable in UI.

An initial target matrix is:

| Entry family | Affects semantic replay | Affects default timeline | Contributes runtime overlay | Contributes diagnostic overlay | Entry semantics | Replay behavior | Compressible | Canonical semantic truth | Expandable |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `turn.accepted` | yes | yes | no | no | `event` | accumulate | no | yes | yes |
| `turn.delivery` | no | optional | yes | optional | `event` or `snapshot`, by subtype | subtype-defined | yes | no | yes |
| `agent-observation` | yes | yes | optional | optional | usually `event` | usually accumulate | maybe | yes, but authority-scoped | yes |
| `agent-execution-fact` | yes | yes | yes | optional | `event` | accumulate | no by default | yes | yes |
| `execution-assessment` | no | optional | no | yes | `assessment` | fold as evaluative overlay | yes | no | yes |
| `transport-evidence` | no | optional | optional | optional | `evidence` | ignore for semantic replay | yes | no | yes |
| `decision.recorded` | yes | optional | no | yes | `event` | accumulate | no | yes | yes |
| `state.changed` | yes | yes | yes | no | `event` | accumulate | no | yes | yes |
| `activity.updated` | no for semantic replay, yes for runtime overlay reconstruction | yes | yes | optional | `snapshot` | latest-wins fold | yes | no | yes |
| `owner-effect.recorded` | yes | yes | no | optional | `event` | accumulate | no | yes | yes |
| `checkpoint.recorded` | optional | no | optional | no | `snapshot` or `event`, by subtype | subtype-defined | yes | no unless replay explicitly depends on it | optional |
| `projection.recorded` | no | no | optional | optional | `snapshot` | ignore for semantic replay | yes | no | no |

The exact matrix may evolve, but the important rule is that each family has an explicit replay contract rather than relying on reader assumptions.

### Replay authority

Replay of AgentExecution semantic state and default timeline/chat projection must depend only on typed canonical entries.

That means:

- `agent-observation`, `agent-execution-fact`, `decision.recorded`, `state.changed`, `activity.updated`, and `owner-effect.recorded` may affect semantic replay.
- `execution-assessment` may affect orchestration, escalation, benchmarking, and diagnostic interpretation, but not semantic replay truth.
- `transport-evidence` must never be required to infer semantic truth.
- `projection.recorded` may accelerate reads, but replay must remain correct if all projection records are ignored.

Replay should therefore apply family semantics explicitly:

- event entries accumulate into ordered execution history.
- snapshot entries fold into current overlay state with latest-wins behavior.
- assessment entries remain evaluative overlays.
- evidence entries are ignored for semantic replay.

Replay-critical semantic truth must remain stable even if:

- all `transport-evidence` entries are removed.
- all `execution-assessment` entries are removed.
- all `projection.recorded` entries are removed.

If Mission cannot reconstruct semantic state without parsing `transport-evidence`, the model has regressed into terminal inference.

### Evidence and UI expansion

Raw output and evidence may live in the same ordered journal if they are explicitly typed as `transport-evidence` and marked non-canonical for semantic replay.

Open Mission surfaces should project compact operator views by default and expose transport evidence, telemetry overlays, or assessment overlays only when the operator expands a row or opens a deeper execution trace. The UI must not need to infer semantics from evidence; it only reveals already-recorded supporting detail.

Diagnostic overlays and confidence overlays may enrich the operator view, but they are additive projections over the typed ledger rather than hidden semantic dependencies.

### High-frequency telemetry handling

High-frequency telemetry should remain first-class in retention design without being confused for semantic truth.

Examples include:

- token deltas.
- spinner and progress updates.
- active target changes.
- transient execution statuses.
- streaming provider updates.
- PTY chunk bursts.

Mission should define per telemetry class whether it is:

- replay-critical.
- compressible.
- externalizable.
- evidence-only.
- event-shaped or snapshot-shaped.

The default expectation is:

- semantic state transitions are durable and non-compressible.
- runtime overlays such as `activity.updated` are compressible snapshot records and reconstructable by latest-wins folding.
- transport-heavy chunk streams may be externalized while preserving canonical sequence identity.
- evidence-only PTY or provider exhaust must never become hidden replay inputs.

### Storage boundary

This proposal treats one-file versus two-file persistence as a storage optimization boundary, not as the semantic architecture boundary.

The canonical architecture rule is:

- one canonical ordered semantic ledger per AgentExecution.
- zero or more auxiliary evidence mirrors or retention stores.

Mission should preserve one logical ordering model even if physical evidence storage later splits. That means canonical sequence identity must remain stable whether evidence is:

- stored inline in the journal.
- stored as externalized chunks referenced by journal sequence.
- mirrored into a PTY-specific recording file for transport retention.
- projected into cached timeline or chat material.
- accompanied by external benchmark, audit, or assessment stores that reference the same sequence.

The canonical contract is the ordering identity, not the physical file layout. This keeps future storage options open without fragmenting replay semantics.

Mission may retain dedicated terminal recordings for PTY-specific audit, retention, or streaming performance. If it does, those recordings are evidence mirrors or lossless transport audit, not an additional required source for semantic replay.

Large `transport-evidence` entries are the main operational pressure point. Mission should therefore allow externalized chunk storage keyed by canonical journal ordering while preserving the same logical execution timeline.

## BRIEF.md Example

For an AgentExecution that summarizes `BRIEF.md`, the acceptable outcomes are:

1. Mission-owned artifact access emits a first-class `agent-execution-fact` such as `artifact-read(path: 'BRIEF.md')`, and replay can show that deterministically.
2. Mission only knows the artifact was made available in context, so it records availability, not a false read.
3. A provider reads the file through opaque private tooling and emits no structured fact, so Mission records no `artifact-read` semantic truth.

The unacceptable outcome is:

- storing only raw text like `Read BRIEF.md` and reconstructing semantic truth later by parsing it.

## Consequences

- Mission gets one monotonic AgentExecution ledger for prompts, observations, Agent execution facts, decisions, state changes, effects, and evidence ordering.
- Replay remains deterministic because semantic truth never depends on parsing transport exhaust.
- Replay-relevant entries become evaluable and diagnosable because they carry normalized execution context metadata.
- Operator-facing chat and timeline become visibility projections over a typed ledger instead of transcript reconstruction code.
- Daemon-observed Agent execution facts such as artifact reads and writes become explicit first-class contracts instead of overloading `signal` or `rawText`.
- Execution assessments become first-class overlays for orchestration intelligence, audit workflows, verification analysis, and benchmarking without mutating semantic truth.
- Replay implementation becomes less ambiguous because immutable event accumulation and latest-wins snapshot folding are explicit rather than implied.
- Projection caching becomes safer because replay can ignore cached entries and still rebuild the same semantic state.
- Auxiliary transport stores remain allowed, but they cannot become hidden semantic dependencies.
- Authority and trust become explicit on replay-relevant entries instead of being inferred from entry shape alone.
- High-frequency runtime telemetry can be retained without forcing it into the same permanence class as semantic state changes.

## Implementation Rules

- Do not infer semantic truth from terminal paint, provider prose, or raw output chunks.
- Do not treat `rawText` as a semantic catch-all for facts that deserve typed structure.
- Do not make semantic replay depend on a separate terminal recording, provider transcript, or UI cache.
- Do not let execution-assessment entries silently mutate semantic truth.
- Do not let `projection.recorded` become required replay input.
- Do not treat snapshot overlays as if they were immutable semantic events.
- Do not treat agent-authored claims and daemon-observed facts as equivalent authority classes.
- Do not treat verifier scores, self-confidence, emotional tone, or heuristic instability ratings as authoritative facts.
- Do promote daemon-observed artifact access, filesystem changes, and structured provider events into first-class runtime-fact entries when Mission has authority to observe them.
- Do attach stable execution context metadata to replay-relevant entries so later evaluation, diagnostics, benchmarking, and provider comparison remain possible.
- Do model execution assessments as first-class typed overlays with explicit trust and replay contracts.
- Do allow transport evidence to be stored inline in the journal when it remains typed, collapsible, and non-canonical for replay.
- Do allow transport evidence to be externalized by chunk or mirror while preserving canonical journal ordering.
- Do keep one canonical ordering model across accepted turns, observations, Agent execution facts, decisions, state changes, and evidence.
- Do preserve canonical ordering identity even when evidence, telemetry, projections, or assessments are stored out-of-line.
- Do define replay, compression, and expansion behavior per entry family rather than leaving that behavior implicit.
- Do define whether each family and subtype replays by accumulation or latest-wins folding.

## Follow-On Work

- Refine `observation.recorded` so the schema distinguishes Agent-authored observations from daemon-observed Agent execution facts and transport evidence.
- Introduce a normalized `executionContext` contract shared by replay-relevant families.
- Add a first-class `execution-assessment` family and wire it into orchestration, verification, and audit flows as advisory metadata.
- Add explicit `entrySemantics` fields or equivalent schema-level semantics markers so replay behavior is machine-checkable.
- Define concrete Zod schemas for each family and subtype rather than extending prose indefinitely.
- Tighten the replay contract in code so `projection.recorded` is always optional.
- Tighten replay code so assessment and evidence families remain optional overlays rather than semantic dependencies.
- Add replay-engine contract tests that prove semantic replay succeeds with evidence, projections, and assessments removed.
- Add Agent execution fact emission seams for artifact access, tool execution, filesystem changes, and verification outputs.
- Introduce Mission-owned artifact access/runtime-fact emission paths before attempting more provider-specific output parsing.
