---
layout: default
title: Agent Execution Journal Ledger Spec
parent: Architecture
nav_order: 8.9
description: Temporary working spec for the typed AgentExecution journal ledger refactor.
---

## Temporary Agent Execution Journal Ledger Spec

> Current authority: this temporary spec contains pre-convergence journal-ledger wording. Where it conflicts with `CONTEXT.md`, ADR-0004.08, or ADR-0004.13 as updated on 2026-05-13, follow the newer rule: `AgentExecution` is the canonical in-memory Entity instance; AgentExecution logs are typed audit/recovery records owned by that instance, not a separate canonical execution object.

This is the temporary working spec for the next AgentExecution journal refactor.

It is temporary on purpose. It exists to prevent implementation drift while the journal contract moves from a signal-centric semantic log toward a typed execution ledger. When the code converges, fold the durable decisions back into accepted ADRs and remove this file.

Mission is not recording chat transcript fragments or PTY logs as the primary product. Mission is recording execution semantics and the execution context under which those semantics were produced.

## Authoritative Inputs

- [CONTEXT](../../CONTEXT.md)
- [ADR-0004.07 Agent Execution Logs As Daemon Audit Material](../adr/0004.07-agent-execution-logs-as-daemon-audit-material.md)
- [ADR-0004.08 Agent Execution Interaction Journal](../adr/0004.08-agent-execution-interaction-journal.md)
- [ADR-0004.13 Typed Agent Execution Journal Ledger](../adr/0004.13-typed-agent-execution-journal-ledger.md)
- [Agent Execution Interaction Journal Spec](agent-execution-interaction-journal-spec.md)

## Why This Exists

The current interaction journal already uses one append-only typed JSONL ledger, but the semantic boundary is still too centered on `observation.recorded.signal`.

That causes several implementation pressures:

- daemon-observed runtime facts such as artifact reads and writes do not have a first-class semantic home.
- replay-relevant records do not yet carry normalized execution context sufficient for diagnostics, evaluation, or orchestration analytics.
- evaluative and verification-oriented overlays do not yet have a first-class typed family.
- raw provider or terminal output is too easy to misuse as reconstruction material.

This spec exists to keep the next implementation step narrow:

- schema first
- replay contract explicit
- Open Mission unchanged until the backend contract is clean

## Concrete-First Guardrails

This temporary spec is vocabulary and boundary discipline, not a mandate to build generalized runtime infrastructure in advance.

- do not introduce plugin systems, generic operation pipelines, abstract semantic buses, or policy engines just because the ledger families exist.
- add a new journal family producer or consumer only when a concrete Mission execution feature requires it end to end.
- keep semantic operations closed and concrete; prefer explicit handlers for real Mission capabilities over extensibility seams.
- keep fact recording thin; recording a fact is acceptable, but orchestration, replay policy, evaluation, and routing still belong to their own owners.
- `ExecutionAssessmentEntry` remains reserved vocabulary until there is a tested producer, consumer, and operational decision that needs it.

## Immediate Design Decision

Do not model `runtime-fact` as a subtype of `observation.recorded`.

Do not model `execution-assessment` as a subtype of `observation.recorded` or `runtime-fact`.

Use separate top-level journal families for daemon-observed structured facts and evaluative overlays.

The active target shape is conceptually:

```ts
type AgentExecutionJournalEntry =
  | JournalHeaderEntry
  | TurnAcceptedEntry
  | TurnDeliveryEntry
  | AgentObservationEntry
  | RuntimeFactEntry
  | ExecutionAssessmentEntry
  | TransportEvidenceEntry
  | DecisionRecordedEntry
  | StateChangedEntry
  | ActivityUpdatedEntry
  | OwnerEffectRecordedEntry
  | CheckpointRecordedEntry
  | ProjectionRecordedEntry;
```

The exact TypeScript names may differ, but the authority boundary must remain explicit:

- `AgentObservationEntry`: agent-authored or agent-signal structured material.
- `RuntimeFactEntry`: daemon-observed structured facts.
- `ExecutionAssessmentEntry`: advisory or diagnostic evaluation material.
- `TransportEvidenceEntry`: evidence only, never semantic truth by itself.

## Common Metadata Contract

Every replay-relevant journal entry should share one base metadata contract.

The active target metadata is:

```ts
type AgentExecutionJournalEntryBase = {
  recordId: string;
  sequence: number;
  agentExecutionId: string;
  occurredAt: string;
  family: JournalEntryFamily;
  entrySemantics: JournalEntrySemantics;
  authority: JournalEntryAuthority;
  assertionLevel: 'authoritative' | 'advisory' | 'informational' | 'diagnostic';
  replayClass: 'replay-critical' | 'replay-optional' | 'evidence-only';
  origin: JournalEntryOrigin;
  executionContext: ExecutionContextDescriptor;
};
```

type JournalEntrySemantics =
  | 'event'
  | 'snapshot'
  | 'assessment'
  | 'evidence';

The active target execution context is:

```ts
type ExecutionContextDescriptor = {
  owner: {
    entityType: EntityType;
    entityId: string;
  };
  mission?: {
    missionId: string;
    stageId?: string;
    taskId?: string;
    sessionId?: string;
  };
  repository?: {
    repositoryId: string;
    worktreeId?: string;
    branch?: string;
  };
  runtime: {
    agentAdapter: AgentAdapterKind;
    provider?: string;
    model?: string;
    reasoningLevel?: 'low' | 'medium' | 'high' | 'max' | 'unknown';
    executionMode?: 'interactive' | 'batch' | 'verification' | 'audit';
    workflowStage?: string;
    executionProfile?: string;
    verifier?: boolean;
  };
  daemon: {
    runtimeVersion: string;
    protocolVersion: string;
  };
};
```

Implementation note:

- keep enums constrained, not free-text strings.
- prefer `origin` over `sourceSurface` for the shared field because some entries are daemon consequences, not surface-originated events.
- preserve existing `occurredAt` naming unless the refactor deliberately renames it clean-sheet.
- treat `executionContext` as normalized metadata, not an arbitrary payload bag.
- treat `entrySemantics` as a replay contract, not a descriptive hint.

This metadata exists so replay-relevant entries remain usable for:

- deterministic replay.
- execution diagnostics.
- runtime evaluation.
- auditability.
- orchestration intelligence.
- future analytics and benchmarking.
- provider comparison.
- projection-driven UI rendering.
- execution assessment and verification workflows.

## Trust Contract

The journal must distinguish semantic truth, advisory claims, diagnostic overlays, and evidence.

Minimum authority classes:

- daemon-observed authoritative facts.
- agent-authored claims.
- provider-native events.
- verifier assessments.
- diagnostic heuristics.
- transport evidence.

Minimum interpretation rules:

- a daemon-observed filesystem write is authoritative semantic truth when the daemon has direct observation authority.
- an agent statement such as `I think this is complete` is advisory only.
- a verifier assessment such as `verification-confidence = 0.81` is evaluative metadata, not semantic truth.
- provider-native events may be authoritative only when Mission has an explicit structured contract for them.
- raw transport evidence is never semantic truth by itself.
- snapshot overlays must not be reinterpreted as immutable event history.

## Family Contract

### AgentObservationEntry

Use for structured agent-authored or agent-signal material such as:

- `message`
- `status`
- `progress`
- `needs_input`
- other declared Agent signals

These entries may affect replay, but their authority is still scoped by `authority` and `assertionLevel`. An agent-authored claim does not silently become daemon-authoritative truth.

Default semantics: `event`, unless a subtype is explicitly modeled as a snapshot-style overlay.

### RuntimeFactEntry

Use for daemon-observed structured facts such as:

- `artifact-read`
- `artifact-written`
- `tool-invoked`
- `tool-result`
- `filesystem-change`
- structured provider events when Mission has authoritative observation

This is the new semantic home for facts that should be replay-safe without pretending they were agent-authored.

Default semantics: `event`.

### ExecutionAssessmentEntry

Use for evaluative or diagnostic metadata that may influence orchestration, audits, verification, escalation, or analytics without changing semantic replay truth.

Examples include:

- `self-confidence`
- `verification-confidence`
- `retry-pressure`
- `instability`
- `contradiction-risk`
- `hallucination-risk`
- `task-stall-risk`
- `unresolved-concern`
- `verification-gap`

Allowed sources include:

- agent self-assessment.
- runtime-derived diagnostics.
- verification-stage assessment.
- audit-stage evaluation.

Non-negotiable rules:

- these entries are not canonical semantic truth.
- these entries may influence orchestration and human-in-the-loop escalation.
- self-confidence, emotional wording, or model prose must not be upgraded into authoritative facts without a separate authoritative path.

Default semantics: `assessment`.

### TransportEvidenceEntry

Use for raw or near-raw evidence such as:

- stdout/stderr chunks
- provider stream payloads
- PTY snippets
- raw adapter event bodies

These entries are never required for semantic replay.

They may be:

- inline in the canonical journal
- externalized into chunk storage
- mirrored into terminal-specific evidence files

But all variants must preserve the same canonical sequence/order model.

Default semantics: `evidence`.

### ActivityUpdatedEntry

Use for runtime overlay material such as:

- spinner status
- active file or target
- token progress
- transient execution status
- currently active tool or phase

These entries are not immutable semantic facts. They are overlay snapshots.

Non-negotiable rules:

- replay folds them by latest-wins replacement rather than accumulating them as semantic history.
- they may be compressed or sampled without changing semantic replay truth.
- they may support runtime overlay reconstruction and operator views.

Default semantics: `snapshot`.

## Replay Layers

The ledger contract should be read as four adjacent but distinct layers:

- semantic replay state.
- runtime overlay reconstruction.
- diagnostic and assessment overlays.
- evidence expansion and cached projections.

Semantic replay must remain deterministic even if evidence, assessment overlays, and cached projections are absent.

Replay must also distinguish immutable event accumulation from latest-wins snapshot folding.

- `event`: accumulate in sequence order.
- `snapshot`: fold into current overlay state by replacement or overwrite.
- `assessment`: fold into evaluative overlay state without mutating semantic truth.
- `evidence`: retain for audit and expansion, but ignore for semantic replay.

## Replay Contract

The replay contract matters more than the exact schema labels.

Current target behavior:

| Family | Affects semantic replay | Affects default timeline | Contributes runtime overlay | Contributes diagnostic overlay | Entry semantics | Replay behavior | Compressible | Canonical semantic truth |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `turn.accepted` | yes | yes | no | no | `event` | accumulate | no | yes |
| `turn.delivery` | no | optional | yes | optional | `event` or `snapshot`, by subtype | subtype-defined | yes | no |
| `agent-observation` | yes | yes | optional | optional | usually `event` | usually accumulate | maybe | authority-scoped |
| `runtime-fact` | yes | yes | yes | optional | `event` | accumulate | no by default | yes |
| `execution-assessment` | no | optional | no | yes | `assessment` | fold evaluative overlay | yes | no |
| `transport-evidence` | no | optional | optional | optional | `evidence` | ignore for semantic replay | yes | no |
| `decision.recorded` | yes | optional | no | yes | `event` | accumulate | no | yes |
| `state.changed` | yes | yes | yes | no | `event` | accumulate | no | yes |
| `activity.updated` | no for semantic replay, yes for runtime overlay reconstruction | yes | yes | optional | `snapshot` | latest-wins fold | yes | no |
| `owner-effect.recorded` | yes | yes | no | optional | `event` | accumulate | no | yes |
| `checkpoint.recorded` | optional | no | optional | no | `snapshot` or `event`, by subtype | subtype-defined | yes | optional |
| `projection.recorded` | no | no | optional | optional | `snapshot` | ignore for semantic replay | yes | no |

Non-negotiable rule:

- replay of semantic AgentExecution truth must not require parsing `TransportEvidenceEntry`.
- replay of semantic AgentExecution truth must not require `ExecutionAssessmentEntry`.
- replay of semantic AgentExecution truth must not require `ProjectionRecordedEntry`.

Replay implementation rule:

- event entries accumulate.
- snapshot entries fold by latest-wins replacement.
- assessment entries remain evaluative overlays.
- evidence entries are excluded from semantic replay.

## Telemetry Handling

High-frequency telemetry should be modeled explicitly rather than leaking into semantic state changes.

Examples include:

- token deltas.
- spinner and progress updates.
- active target changes.
- transient execution statuses.
- streaming provider updates.
- PTY chunk bursts.

Per telemetry class, the implementation should declare whether it is:

- replay-critical.
- compressible.
- externalizable.
- evidence-only.
- event-shaped or snapshot-shaped.

Default direction:

- `state.changed` remains non-compressible semantic truth.
- `activity.updated` carries compressible snapshot-style runtime overlay material.
- transport-heavy bursts may be externalized or mirrored as evidence while preserving canonical ordering.
- evidence-only streams must never become hidden replay dependencies.

## Implementation Sequence

1. Split the current journal schema so `observation.recorded` becomes an agent-observation family rather than a generic semantic catch-all.
2. Add a sibling `runtime-fact.recorded` family with its own schema and type.
3. Add a sibling `execution-assessment.recorded` family with its own schema and type.
4. Add shared base metadata for `entrySemantics`, `authority`, `assertionLevel`, `replayClass`, `origin`, and `executionContext`.
5. Update the journal replayer so event families accumulate, snapshot families fold by latest-wins behavior, and evidence or assessment families remain non-semantic overlays.
6. Update the journal writer so daemon-observed runtime facts have a first-class append path and assessment emitters have an explicit advisory append path.
7. Only after the schema and replay boundary are clean, update Open Mission/chat/timeline projection.

## Explicit Non-Goals For This Step

- Do not redesign Open Mission components yet.
- Do not infer `artifact-read` from terminal paint.
- Do not collapse terminal recordings into the semantic replay path.
- Do not treat `execution-assessment` as semantic truth.
- Do not treat `activity.updated` or other overlay snapshots as immutable semantic events.
- Do not preserve compatibility with the old journal contract unless a migration ADR explicitly requires it.
- Do not add provider-specific parsing as a substitute for Mission-owned runtime-fact emission.

## BRIEF.md Test Case

For the `summarize the brief.md` case, the acceptable backend outcomes remain:

1. Mission-owned artifact access emits `runtime-fact: artifact-read`.
2. Mission records only artifact availability if the file was made available but not observed as read.
3. Mission records no `artifact-read` if the provider used opaque private tooling with no structured authority.

The unacceptable backend outcome remains:

- reconstructing `artifact-read` later from raw output like `Read BRIEF.md`.

## Concrete Schema Direction

Strong preference for the next schema step:

- `runtime-fact` remains a top-level journal family.
- `execution-assessment` becomes a top-level journal family.
- `transport-evidence` remains non-canonical and non-required for semantic replay.
- replay contracts are explicit per family.
- entry semantics are explicit per family and subtype.
- execution context metadata is shared and normalized across replay-relevant families.

Do not collapse these concepts back into:

- `signal`
- `rawText`
- generic observation blobs

## Next Step Direction

After this conceptual model is stable, the next implementation step should shift from prose into executable contracts:

1. concrete Zod schemas for each family and subtype.
2. replay-engine contract tests proving semantic replay succeeds with evidence removed.
3. replay-engine contract tests proving semantic replay succeeds with projections removed.
4. replay-engine contract tests proving semantic replay succeeds with assessments removed.
5. runtime-fact emission seams for artifact access, tool execution, filesystem changes, and verification outputs.
