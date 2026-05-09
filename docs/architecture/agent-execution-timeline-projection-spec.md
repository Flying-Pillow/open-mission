---
layout: default
title: Agent Execution Timeline Projection Spec
parent: Architecture
nav_order: 8.10
description: Implementation spec for the Airport AgentExecution timeline projection model.
---

## Scope

This spec implements the requirements in [Agent Execution Timeline Projection PRD](agent-execution-timeline-projection-prd.md).

The implementation defines a projection contract and Airport rendering architecture for AgentExecution timelines. It does not change AgentExecution journal authority, terminal recording authority, Mission workflow authority, or any ADR.

## Authoritative Inputs

- `CONTEXT.md`: canonical Mission vocabulary.
- ADR-0018: AgentExecution, AgentExecutor, AgentAdapter, and Terminal vocabulary.
- ADR-0022: AgentExecution structured interaction vocabulary.
- ADR-0025: AgentExecution interaction journal persistence.
- [Agent Execution Interaction Journal PRD](agent-execution-interaction-journal-prd.md).
- [Agent Execution Interaction Journal Spec](agent-execution-interaction-journal-spec.md).
- `packages/core/src/entities/AgentExecution/AgentExecutionJournalSchema.ts`: current top-level journal record family schemas and discriminated journal record contract.
- `packages/core/src/entities/AgentExecution/AgentExecutionSignalRegistry.ts`: current signal registry, descriptor source, signal payload schema source, and signal-to-timeline projection source.
- `packages/core/src/entities/AgentExecution/AgentExecutionJournalReplayer.ts`: current replay owner for hydrating AgentExecution state and AgentExecution projection data from journal records.

## Ownership

### AgentExecution

AgentExecution owns:

- deriving projection data from journal replay and AgentExecution semantic state.
- exposing projection fields through the AgentExecution read model.
- preserving provenance from projection items back to source journal records when available.
- marking whether projection items are durable journal-derived material or live runtime overlay material.
- providing zone, primitive, behavior, and severity data when it can do so from canonical state.
- using the journal record registry as the source of top-level journal record family coverage and replay dispatch.
- using the AgentExecution signal registry as the source of signal payload variants, signal descriptors, and signal-specific projection behavior.

### Airport Application

Airport owns:

- rendering AgentExecution projection data.
- grouping, filtering, layout, and component composition for timeline items.
- local UI state such as expanded/collapsed items, scroll position, selected filters, and active terminal panel visibility.
- accessibility labels, responsive layout, and visual hierarchy.

Airport does not own:

- AgentExecution journal records.
- AgentExecution journal record registry semantics.
- AgentExecution signal registry semantics.
- semantic replay.
- workflow legality.
- terminal transport truth.
- provider-specific interpretation.

### Terminal

Terminal remains the owner of raw PTY screen state, terminal input, resize, exit, and terminal recordings. Airport may embed terminal replay or selected terminal snippets, but those views are inspectable runtime evidence, not semantic interaction truth.

## Registry-Driven Projection Semantics

AgentExecution projection must be driven by the same registries and schemas that govern journal replay.

The journal record registry is the canonical source for top-level journal entry families. In the current implementation, that registry is represented by `AgentExecutionJournalRecordTypeSchema` and `AgentExecutionJournalRecordSchema`; if the implementation later exposes a named `AgentExecutionJournalRecordRegistry`, the projection layer should consume that named registry rather than preserve a parallel mapping. Record-family coverage includes `journal.header`, `message.accepted`, `message.delivery`, `observation.recorded`, `decision.recorded`, `state.changed`, `activity.updated`, `owner-effect.recorded`, and `projection.recorded`.

The AgentExecution signal registry is the canonical source for structured signals inside `observation.recorded.signal`. It owns signal payload validation, descriptor publication through `baselineAgentDeclaredSignalDescriptors`, and signal-specific timeline projection through `projectAgentExecutionObservationSignalToTimelineItem`. Timeline projection should extend this ownership model rather than introduce a second signal switch in Airport.

Registry ownership rules:

- New journal record families must be added to the journal record registry/schema before projection code or Airport components can treat them as first-class timeline sources.
- New signal families must be added to the signal registry before projection code can render them as first-class signal-derived timeline items.
- Projection code may map registry-backed records and signals into timeline primitives, zones, behavior, severity, payloads, and provenance.
- Airport components must select render components from projection behavior and primitive metadata, not directly from raw journal record type or signal type.
- Coverage tests must fail when a registry-backed record or descriptor-backed signal has no intentional projection behavior, explicit hidden/collapsed behavior, or documented non-UI reason.

## Projection Contract

The AgentExecution read model should expose timeline projection data directly.

```ts
type AgentExecutionProjection = {
  timelineItems: AgentExecutionTimelineItem[];
  currentActivity?: AgentExecutionActivityProjection;
  currentAttention?: AgentExecutionAttentionProjection;
  runtimeOverlay?: AgentExecutionRuntimeOverlayProjection;
};
```

The initial implementation should expose `timelineItems` directly rather than preserve a parallel message transcript projection.

## Timeline Item Core Shape

```ts
type AgentExecutionTimelineItem = {
  id: string;
  occurredAt: string;
  zone: AgentExecutionTimelineZone;
  primitive: AgentExecutionTimelinePrimitive;
  behavior: AgentExecutionRenderBehavior;
  severity?: AgentExecutionTimelineSeverity;
  provenance: AgentExecutionTimelineProvenance;
  payload: AgentExecutionTimelinePayload;
};
```

`zone` is required because it controls layout, grouping, filtering, summarization, and mobile ordering. `severity` is optional because ordinary conversation and neutral activity should not need explicit urgency. Explicit affordances are intentionally not part of the current item schema; they should be added only when AgentExecution can expose operator-action authority without collapsing permissions into presentation state.

## Zone Type

```ts
type AgentExecutionTimelineZone =
  | 'conversation'
  | 'activity'
  | 'workflow'
  | 'runtime'
  | 'artifact';
```

Zone assignment rules:

- Human or agent-authored conversational material uses `conversation`.
- Runtime posture, progress, tool activity, target labels, and telemetry use `activity`.
- Entity events, owner effects, verification, task state, delegation, replay markers, and summaries use `workflow`.
- Terminal, transport, adapter, delivery, heartbeat, and infrastructure material use `runtime`.
- Files, diffs, structured outputs, tables, snippets promoted as outputs, and inspectable generated material use `artifact`.

## Severity Type

```ts
type AgentExecutionTimelineSeverity =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'critical';
```

Severity rules:

- Use `success` for verified success, accepted completion, or positive workflow result.
- Use `warning` for blocked-but-recoverable states, skipped delivery, degraded runtime, or operator attention that is not failure.
- Use `error` for failed claims, failed delivery, rejected critical observations, failed verification, or runtime errors.
- Use `critical` only when the AgentExecution or daemon can no longer provide a reliable operator experience without intervention.
- Omit severity for ordinary conversation and neutral activity.

Backend projection should provide severity when derived from canonical state. Airport may derive display severity from primitive and payload only as a presentation fallback, not as domain truth.

## Primitive Type

```ts
type AgentExecutionTimelinePrimitive =
  | 'conversation.operator-message'
  | 'conversation.agent-message'
  | 'conversation.system-message'
  | 'conversation.reasoning-summary'
  | 'attention.input-request'
  | 'attention.blocked'
  | 'attention.verification-requested'
  | 'attention.verification-result'
  | 'activity.status'
  | 'activity.progress'
  | 'activity.tool'
  | 'activity.target'
  | 'workflow.event'
  | 'workflow.state-changed'
  | 'runtime.indicator'
  | 'runtime.warning'
  | 'terminal.snippet'
  | 'artifact.created'
  | 'artifact.updated'
  | 'artifact.diff'
  | 'replay.marker'
  | 'summary.generated';
```

Primitive names are projection-level vocabulary. They should not replace journal record type names and should not be used as durable source-of-truth records unless emitted inside explicit `projection.recorded` material.

The `attention.*` primitive namespace is a phase-one convenience for operator-attention items. It should not be treated as proof that attention is permanently a primitive family. If blocked states, collaboration requests, runtime interruptions, and artifact review states start sharing behavior across zones, the projection contract should promote attention into an orthogonal axis rather than multiplying primitive names.

## Render Behavior

```ts
type AgentExecutionRenderBehavior = {
  class:
    | 'conversational'
    | 'timeline-event'
    | 'live-activity'
    | 'artifact'
    | 'approval'
    | 'runtime-warning'
    | 'terminal'
    | 'replay-anchor';
  compactable: boolean;
  collapsible: boolean;
  sticky: boolean;
  actionable: boolean;
  replayRelevant: boolean;
  transient: boolean;
  defaultExpanded: boolean;
};
```

Behavior class controls component selection. Primitive controls item-specific rendering within that class. Zone controls placement and grouping. Severity controls urgency and notification treatment.

Attention is represented through `behavior.class: 'approval'`, selected `attention.*` primitives, and optional severity in phase one. A future projection version may introduce an explicit `attention` field if Airport needs to filter, group, notify, or navigate attention states independently from primitive and zone.

`actionable` means the item should render with an action-capable shape. It is not the permission contract for what the operator can do. Operator permissions and available controls should come from interaction affordances.

## Interaction Affordance

Projection items may expose explicit operator affordances in a future contract version when actionability needs to be more precise than a boolean render hint. The current phase-one `AgentExecutionTimelineItem` schema does not include this field.

```ts
type AgentExecutionInteractionAffordance = {
  canReply: boolean;
  canApprove: boolean;
  canReject: boolean;
  canInterrupt: boolean;
  canResume: boolean;
  canExpandTerminal: boolean;
  canInspectArtifact: boolean;
};
```

Affordance rules:

- Affordances derive from AgentExecution message descriptors, Entity command descriptors, interaction capabilities, runtime state, ownership, scope, and policy.
- Airport may hide, disable, or explain controls based on affordances, but it must not invent authority that the AgentExecution contract does not expose.
- `canReply` applies to conversational or input-request items that can accept an operator AgentExecutionMessage.
- `canApprove` and `canReject` apply to verification, approval, permission, or review items whose owner Entity exposes a legal decision path.
- `canInterrupt` and `canResume` apply to execution-level controls and must respect current lifecycle, attention, runtime capabilities, and command descriptors.
- `canExpandTerminal` applies only when terminal inspection is available through Terminal-owned data.
- `canInspectArtifact` applies only when an artifact reference or structured output reference is available.

Phase one should continue using `behavior.actionable` as a render hint only. Future Airport work should migrate control rendering to affordances so permissions, capabilities, runtime state, ownership, and execution mode are not collapsed into one generic flag.

## Provenance

```ts
type AgentExecutionTimelineProvenance = {
  durable: boolean;
  sourceRecordIds: string[];
  confidence?: 'authoritative' | 'high' | 'medium' | 'low' | 'diagnostic';
  liveOverlay?: boolean;
};
```

Rules:

- Journal-derived items set `durable: true` and include source record ids when available.
- Live runtime overlay items set `durable: false` and `liveOverlay: true`.
- Projection material derived from low-confidence observations should expose that confidence so Airport can collapse or label it.
- Airport must not invent source record ids.

## Payload Families

Payloads should be discriminated or schema-backed in implementation. The following shapes are the target families.

```ts
type ConversationPayload = {
  title?: string;
  text: string;
  detail?: string;
  markdown?: boolean;
  choices?: Array<{
    kind: 'fixed' | 'manual';
    label: string;
    value?: string;
    placeholder?: string;
  }>;
};

type ActivityPayload = {
  summary?: string;
  detail?: string;
  units?: { completed?: number; total?: number; unit?: string };
  currentTarget?: { kind: 'file' | 'command' | 'tool' | 'artifact' | 'unknown'; label?: string; path?: string };
  activeToolName?: string;
};

type WorkflowPayload = {
  title: string;
  summary?: string;
  entity?: 'System' | 'Repository' | 'Mission' | 'Task' | 'Artifact';
  entityEventId?: string;
  workflowEventId?: string;
  result?: 'requested' | 'accepted' | 'rejected' | 'passed' | 'failed';
};

type RuntimePayload = {
  title: string;
  summary?: string;
  transport?: 'stdout-marker' | 'mcp-tool' | 'pty-terminal' | 'adapter' | 'none';
  connected?: boolean;
  terminalAttached?: boolean;
  diagnosticCode?: string;
};

type ArtifactPayload = {
  title: string;
  artifactId?: string;
  path?: string;
  mediaType?: string;
  summary?: string;
  diffRef?: string;
};
```

## Registry-Backed Journal-To-Projection Mapping

Baseline mapping from semantic journal records. This table defines required registry coverage, not an Airport-owned switch table.

| Source | Projection |
| --- | --- |
| operator `message.accepted` | `conversation.operator-message`, `zone: conversation`, `behavior: conversational` |
| daemon/system/owner `message.accepted` | `conversation.system-message`, `zone: conversation`, `behavior: conversational` |
| accepted `message` signal | `conversation.agent-message`, `zone: conversation`, `behavior: conversational` |
| `needs_input` signal and accepted decision | `attention.input-request`, `zone: conversation`, `behavior: approval`, `actionable: true` |
| `blocked` signal | `attention.blocked`, zone selected by source context, `behavior: approval`, `severity: warning` or `error` |
| `ready_for_verification` claim | `attention.verification-requested`, `zone: workflow`, `behavior: approval`, `severity: info` |
| `completed_claim` with accepted verification | `attention.verification-result`, `zone: workflow`, `severity: success` |
| `failed_claim` or failed verification | `attention.verification-result`, `zone: workflow`, `severity: error` |
| meaningful `state.changed` | `workflow.state-changed`, `zone: workflow`, `behavior: timeline-event` |
| `activity.updated` | `activity.status`, `activity.progress`, `activity.tool`, or `activity.target`, `zone: activity`, `behavior: live-activity` |
| failed or skipped `message.delivery` | `runtime.warning`, `zone: runtime`, `severity: warning` or `error` |
| accepted owner effect | `workflow.event`, `zone: workflow`, `behavior: timeline-event` |
| selected terminal excerpt | `terminal.snippet`, `zone: runtime`, `behavior: terminal` |
| materialized `projection.recorded` timeline item | hydrate as provided after schema validation |

Projection mapping must be implemented in an AgentExecution-owned projection/replay module or shared contract layer, not in Svelte components.

The backend projects `observation.recorded.signal` directly to `timelineItems` through `AgentExecutionSignalRegistry.ts`. Timeline projection should continue to reuse that registry-driven dispatch model and add timeline-specific projection metadata either to the signal registry entry or to an AgentExecution-owned projection registry keyed by signal type. It must not re-create the signal mapping inside Airport.

## Airport Component Architecture

Target component structure:

```text
AgentExecutionTimeline
AgentExecutionTimelineHeader
AgentExecutionCurrentActivity
AgentExecutionProgressRail
AgentExecutionTimelineFilters
AgentExecutionTimelineNavigation
AgentExecutionReplayControls
AgentExecutionBranchNavigator
AgentExecutionTimelineList
AgentExecutionTimelineItem
ConversationTimelineItem
ReasoningSummaryItem
AttentionTimelineItem
ActivityTimelineItem
ToolActivityItem
WorkflowTimelineItem
RuntimeTimelineItem
ArtifactTimelineItem
StreamingDiffTimelineItem
TerminalSnippetTimelineItem
SynchronizedTerminalEvidencePanel
AgentExecutionComposer
AgentExecutionTerminalPanel
```

Phase one can keep the existing component files and introduce these names gradually. Component boundaries should follow behavior class rather than journal record type.

## Journal Entry Component Matrix

Airport must not render journal records one-to-one as raw rows. It should render projection items produced from registry-backed journal replay through specialized components.

This matrix is a component coverage matrix for projection families. It is not a replacement for the journal record registry or the signal registry.

| Journal Source | Projection Shape | Primary Component | UX Behavior |
| --- | --- | --- | --- |
| `journal.header` | execution metadata, protocol, transport, scope | `AgentExecutionTimelineHeader` | shows Agent, owner scope, transport, protocol badges, launch context |
| operator `message.accepted` | `conversation.operator-message` | `ConversationTimelineItem` | durable operator bubble, scroll target, reply context |
| daemon/system/owner `message.accepted` | `conversation.system-message` | `ConversationTimelineItem` | compact system bubble or timeline row depending severity |
| `message.delivery` attempted/delivered | runtime delivery metadata | `RuntimeTimelineItem` or hidden detail | collapsed by default unless useful for audit |
| `message.delivery` failed/skipped | `runtime.warning` | `RuntimeTimelineItem` | warning/error row with retry or inspect affordance when legal |
| `observation.recorded` with `message` signal | `conversation.agent-message` | `ConversationTimelineItem` | durable Agent-authored output, markdown-safe rendering |
| `observation.recorded` with `progress` signal | `activity.progress` | `AgentExecutionCurrentActivity`, `ActivityTimelineItem` | sticky current progress, grouped historical activity |
| `observation.recorded` with `needs_input` signal | `attention.input-request` | `AttentionTimelineItem` | expanded inline decision/input surface, remains visible until superseded |
| `observation.recorded` with `blocked` signal | `attention.blocked` | `AttentionTimelineItem` | high-attention card, severity-driven styling, scroll landmark |
| `observation.recorded` with verification or claim signal | `attention.verification-requested` or `attention.verification-result` | `WorkflowTimelineItem`, `AttentionTimelineItem` | review card, verification status, approval affordances |
| `observation.recorded` with diagnostic signal | `runtime.warning` or diagnostic item | `RuntimeTimelineItem` | collapsed diagnostic unless warning/error/critical |
| `decision.recorded` | decision detail attached to related item | detail region inside owning item | explains accepted, rejected, recorded-only, or routed outcome |
| `state.changed` | `workflow.state-changed`, progress rail update | `WorkflowTimelineItem`, `AgentExecutionProgressRail` | milestone row, scroll-to-step target, replay state boundary |
| `activity.updated` | `activity.status`, `activity.progress`, `activity.tool`, `activity.target` | `AgentExecutionCurrentActivity`, `ActivityTimelineItem`, `ToolActivityItem` | sticky live row, grouped spans, compactable history |
| `owner-effect.recorded` | `workflow.event` | `WorkflowTimelineItem` | links AgentExecution interaction to Entity or workflow effect |
| `projection.recorded` chat-message | hydrated conversation projection | matching behavior component | optional materialized read optimization |
| `projection.recorded` timeline-item | hydrated timeline projection | matching behavior component | optional materialized read optimization |
| terminal recording timestamp/window | `terminal.snippet` | `TerminalSnippetTimelineItem`, `SynchronizedTerminalEvidencePanel` | inspectable evidence synchronized with timeline item |
| artifact or diff projection material | `artifact.created`, `artifact.updated`, `artifact.diff` | `ArtifactTimelineItem`, `StreamingDiffTimelineItem` | expandable preview, streaming-to-settled diff behavior |

## Advanced Timeline UX Components

### Collapsible Reasoning Blocks

`ReasoningSummaryItem` renders curated reasoning summaries or summarized historical regions. It must be collapsed by default unless the item is the active replay target or has warning/error severity. It must not render raw private reasoning content.

### Sticky Task Progress

`AgentExecutionCurrentActivity` and `AgentExecutionProgressRail` render the latest lifecycle, attention, activity, progress units, active tool, and current target. The sticky row should update from current projection or runtime overlay data and should not create new semantic state.

### Scroll-To-Step Navigation

`AgentExecutionTimelineNavigation` derives navigable landmarks from workflow events, state changes, input requests, verification results, replay anchors, summaries, artifact updates, and high-severity runtime warnings. Navigation should scroll to the rendered item and preserve virtualized list anchoring when virtualization exists.

### Timeline Replay

`AgentExecutionReplayControls` lets the operator inspect historical journal-derived state by record sequence, timestamp, or replay anchor. Replay mode must be read-only: it can change the displayed projection window and highlighted state, but it must not mutate AgentExecution, Mission workflow, Terminal, or Artifact state.

### Branch Navigation

`AgentExecutionBranchNavigator` handles future alternate paths: retries, delegated AgentExecutions, resumed sessions, or graph-backed causality branches. Phase one can omit this component until projection provenance names branch or delegation relationships.

### Streaming Diffs

`StreamingDiffTimelineItem` renders in-progress artifact or diff projection material when available. It should clearly distinguish streaming or provisional material from settled durable diff material and preserve source provenance for every rendered revision.

### Synchronized Terminal Output

`SynchronizedTerminalEvidencePanel` opens the terminal recording near the timestamp or sequence window associated with the selected timeline item. It should support jump-to-terminal-evidence from runtime warnings, tool activity, failures, and terminal snippets. It must not cause the full terminal stream to become the primary timeline body.

## Grouping And Compaction Rules

Airport and/or backend projection may group items, but semantic correctness belongs to AgentExecution replay.

Required grouping rules:

- Consecutive `activity.updated` items with the same current target may collapse into one activity group.
- Current activity should be sticky while an execution is active.
- Input requests remain expanded and visible until answered or superseded.
- Blocked states, runtime warnings, verification failures, and critical severity items remain visible until superseded.
- Low-confidence diagnostics default collapsed.
- Terminal snippets default collapsed unless explicitly selected or tied to a failure.
- Old inactive spans may summarize only after the source window is preserved by cursor or summary provenance.
- Streaming diff revisions may collapse into the latest visible revision while retaining access to settled durable revisions.
- Terminal evidence windows may group adjacent terminal snippets when they refer to the same command, tool activity, or failure window.

Compaction must preserve:

- source record ids or cursor boundaries.
- the highest severity in a grouped span.
- unresolved actionable items.
- replay anchors and summary markers.

## Filtering And Navigation

The timeline should eventually support filters by:

- zone.
- severity.
- behavior class.
- primitive.
- confidence.
- text query.
- actionable/unresolved state.

Navigation landmarks should include:

- lifecycle and activity step changes.
- input requests and operator responses.
- verification requests and results.
- blocked states and runtime warnings.
- tool activity groups.
- artifact and diff updates.
- replay anchors and generated summaries.
- delegation or branch boundaries when present.

Mobile layout should prioritize unresolved actionable items, `error` and `critical` severity, active current activity, and recent conversation before low-value historical activity.

## Runtime Overlay Composition

Runtime overlay data may produce `runtime.indicator` or `runtime.warning` items when useful for live operation. These items must set `provenance.durable: false` unless they are also backed by journal records.

Examples:

- terminal attached.
- MCP transport available.
- terminal disconnected.
- heartbeat stale.
- provider stream interrupted.
- in-flight delivery attempt.

If a runtime overlay fact must survive restart or explain a past decision, backend code should promote it into a journal record. Airport must not make that promotion locally.

Runtime overlay composition may drive sticky progress, terminal attachment badges, synchronized terminal evidence affordances, and streaming indicators. These UI states must be visibly live or provisional when they are not journal-backed.

## Terminal Presentation

Terminal presentation has three modes:

1. Live terminal panel for active terminal-backed executions.
2. Persisted terminal replay for raw PTY audit inspection.
3. Terminal snippet timeline item for selected evidence.

The timeline should not render the full terminal stream inline by default. Terminal snippets should be explicit projection material or operator-selected evidence.

Timeline and terminal synchronization rules:

- A timeline item may link to a terminal timestamp, sequence window, command label, or terminal snippet id.
- Selecting the timeline item may open or focus terminal evidence without changing timeline scroll position unless the operator requests it.
- Selecting terminal output may highlight related timeline items only when provenance or timestamp correlation exists.
- Correlation by timestamp alone should be presented as approximate unless backend provenance marks it authoritative.

## Virtualization And Materialization

Do not build a full timeline engine before projection volume requires it.

Phase sequencing:

1. Render bounded `timelineItems` from AgentExecution-owned replay.
2. Add cursor-based older journal windows.
3. Add grouping and compaction summaries for high-volume activity.
4. Add virtualization when measured item volume causes rendering or scroll performance problems.
5. Add durable `projection.recorded` materialization only after measured read cost justifies it.

Virtualization must preserve keyboard navigation, scroll anchoring, item measurement, and unresolved attention visibility.

## Multi-Agent Timeline Composition

Single-AgentExecution timelines are the first implementation boundary. Future Mission views will need to compose multiple AgentExecution projections without merging their durable truth.

Multi-agent composition should be modeled as a higher-level projection over AgentExecution projections, not as a replacement for each AgentExecution timeline. It should preserve:

- per-AgentExecution provenance and source record ids.
- delegated execution relationships.
- concurrent activity lanes.
- shared artifact evolution.
- cross-Agent workflow causality.
- unresolved attention items across active executions.

The first multi-agent view should prefer bounded composition and explicit delegation cards over a global virtualized event engine. Global virtualization should wait for measured timeline volume and real navigation requirements.

## Execution Graph Visualization

Execution graph visualization is a later frontier, not a phase-one requirement. Once timelines, delegation, causality, artifacts, workflow effects, ownership, and concurrency coexist in operator workflows, Airport may need a graph or timeline-and-graph hybrid view.

The graph view should be a higher-level projection over existing owners:

- AgentExecution projections for execution lanes, attention, runtime state, and provenance.
- Mission workflow projections for stages, tasks, gates, and workflow effects.
- Artifact projections for produced, consumed, and evolved Mission artifacts.
- Repository projections for branch, worktree, and SCM context when relevant.

Graph nodes and edges must retain source projection provenance. The graph must not become a new source of execution truth, workflow legality, artifact ownership, or runtime state.

## Tests And Validation

Implementation should add deterministic coverage when code changes begin:

- projection schema tests for zone, primitive, severity, behavior, provenance, and payload families.
- mapping tests from representative journal records into timeline items.
- journal record registry coverage tests proving every appendable record family has intentional projection, grouping, hidden-detail, or non-UI treatment.
- signal registry coverage tests proving every descriptor-backed signal has intentional timeline projection behavior.
- tests proving `usage` and `diagnostic` signals are intentionally projected, collapsed, or excluded according to severity and operator value.
- grouping tests that preserve highest severity and unresolved actionable items.
- Airport component tests for input request, blocked, runtime warning, verification result, activity, and normal conversation rendering.
- accessibility checks for severity labels and actionable controls.
- responsive checks for mobile layout with long text, unresolved input requests, and runtime warnings.
- terminal separation tests proving terminal panel/snippets do not become semantic timeline truth.
- component mapping tests proving each journal-derived projection family renders through the intended component class.
- replay UI tests proving replay mode changes displayed state without mutating AgentExecution or Mission state.
- scroll-to-step tests proving navigation landmarks survive grouping, compaction, and virtualization.
- synchronized terminal evidence tests proving terminal panes open to correlated evidence without treating terminal output as semantic truth.
- streaming diff tests proving provisional diff content is visually distinct from settled durable diff content.

## Implementation Sequence

1. Keep the AgentExecution signal registry and journal replay as the only projection sources.
2. Add AgentExecution-owned projection coverage tests for the journal record registry and signal registry.
3. Refactor Airport AgentExecution presentation around behavior-class components while preserving visual parity.
4. Add current activity and attention presentation surfaces when backend data exposes them.
5. Add grouping, filtering, and compaction once item volume and product workflows justify the complexity.
6. Add cursor windows and virtualization after measured performance need.
7. Add journal-driven component mapping for reasoning summaries, sticky progress, replay, branch navigation, streaming diffs, and synchronized terminal evidence as projection provenance becomes available.

## Open Questions

1. Should `AgentExecutionTimelineItem.payload` be a discriminated union from the start, or a strict record with primitive-specific parsing in phase one?
2. Should backend projection provide render behavior directly, or should it provide only primitive plus zone and let Airport derive behavior from a shared table?
3. Should runtime overlay indicators be mixed into `timelineItems`, or exposed as a separate `runtimeOverlay` collection that Airport composes visually?
4. What event should mark an input request as superseded when the operator responds through a normal prompt rather than a fixed choice?
5. What is the smallest useful journal cursor API for older timeline windows without prematurely designing search and replay navigation?
6. Should attention become an explicit projection axis once blocked states span runtime, workflow, conversation, collaboration, and artifact review?
7. What higher-level projection should compose delegated or concurrent AgentExecutions without weakening each AgentExecution's own timeline provenance?
8. Which affordances should be derived by AgentExecution projection, and which should stay as Airport-only control state?
9. What graph nodes and edges are useful enough to justify an execution graph visualization without overbuilding before multi-agent workflows require it?
10. Which timeline replay controls are necessary for operators before cursor-based replay windows exist?
11. What provenance is required before terminal synchronization can be authoritative rather than timestamp-approximate?
12. Should streaming diffs be represented as repeated projection items, grouped revisions, or one live artifact projection with revision metadata?
13. Should timeline projection metadata live directly on `AgentExecutionSignalRegistryEntry`, or in a separate AgentExecution projection registry that composes signal entries with journal record families?
