---
layout: default
title: Agent Execution Timeline Projection PRD
parent: Architecture
nav_order: 8.9
description: Product requirements for the Airport AgentExecution timeline projection UI.
---

## Purpose

Airport needs a canonical operator-facing presentation model for AgentExecution interaction journals. The product surface should evolve from an AI chat transcript into an execution timeline that can present conversation, activity, workflow, runtime, and artifact material without making Airport the source of truth.

The central product requirement is:

```text
AgentExecution interaction journal -> AgentExecution projection -> Airport timeline UI
```

Airport must render a projection derived from AgentExecution semantic state, AgentExecution journal records, and live runtime snapshot overlays. It must not interpret raw terminal output, local component state, or provider-specific events as semantic interaction truth.

The AgentExecution projection must stay aligned with the two phase-one registries defined by the interaction journal specification:

- the journal record registry owns top-level journal record families, record discrimination, schema validation, and replay routing.
- the signal registry owns `observation.recorded.signal` payload variants, signal descriptors, and signal-specific projection behavior.

Airport consumes the resulting AgentExecution projection. It does not duplicate either registry in component code.

## Problem

The current Airport AgentExecution surface is useful but still too conversation-weighted. It renders bounded timeline items and can show a terminal panel, but the emerging AgentExecution journal contains richer semantic material:

- operator and daemon messages.
- Agent-authored observations and claims.
- policy decisions.
- lifecycle, attention, and activity state changes.
- high-frequency runtime activity and telemetry updates.
- owner effects linked to Entity events or workflow events.
- future artifact, terminal snippet, replay, and summary material.

If Airport keeps treating this as a list of messages, it will hide important product distinctions. Progress is not a message. Verification is not a message. Runtime warning state is not a message. Terminal output is not the product UI. Mission needs a timeline architecture rather than a messenger architecture.

## Goal

Define the AgentExecution timeline projection product model used by Airport surfaces.

The projection must allow Airport to present:

- durable human conversation.
- current and historical activity.
- input requests and other operator-attention states.
- workflow milestones and owner effects.
- runtime indicators and runtime warnings.
- terminal snippets as inspectable evidence, not primary interaction truth.
- artifact previews, diffs, and structured outputs when those projection records exist.
- replay, compaction, and summary boundaries in future journal windows.

The first implementation should preserve the existing operator workflow while improving the semantic rendering of current `timelineItems`. The target model is a Mission execution timeline with chat-like conversation regions inside it.

## Non-Goals

- Do not modify AgentExecution journal authority or journal record schemas in Airport.
- Do not make Airport chat, timeline, browser state, or component state authoritative.
- Do not parse raw terminal output into semantic UI truth.
- Do not require a full virtualized timeline engine before the existing chat surface evolves.
- Do not require filesystem, git, artifact, or diff projection support before backend journal replay and idempotency are stable.
- Do not create owner-specific timeline models for Mission, Task, Repository, Artifact, or System scopes.
- Do not introduce provider-specific UI primitives for Copilot, Claude, Codex, OpenCode, or any other Agent.

## Product Principles

### Timeline Before Transcript

Airport presents an AgentExecution timeline. Conversation is one timeline region, not the whole model.

### Projection Before Component

Airport components should render projection primitives and behavior classes. They should not infer domain meaning directly from journal record internals or terminal text.

### Registry-Driven Semantics

Projection semantics come from AgentExecution-owned replay and registries. The journal record registry decides which record families exist and how replay dispatches them. The signal registry decides which structured signal types exist, what descriptors are advertised to Agents, and how signals project into operator-facing material. Airport may adapt projection items for layout, but it must not maintain a parallel switch table for journal record or signal meaning.

### Intelligent Timeline, Not Journal List

Airport must not render journal records as a flat chronological list. Journal records are source material for a composed operator experience: grouped progress, collapsible reasoning summaries, synchronized terminal evidence, streaming diffs, review surfaces, replay controls, and navigation landmarks.

### Terminal Is Inspectable, Not Primary

Terminal output is an execution viewport, runtime substrate, and audit surface. It is not the semantic AgentExecution interaction UI.

### Durable And Live Facts Stay Distinct

Journal-derived items are durable projection material. Live runtime snapshot data is an overlay. Airport may compose both in one view, but it must not present live-only runtime facts as replayable truth.

### Attention Has A Stronger Shape Than Chat

Input requests, blocked states, verification failures, delivery failures, and runtime warnings should render as attention surfaces, not ordinary bubbles.

### Noisy Activity Must Collapse

High-frequency activity, progress, telemetry, current target, and streaming updates should compact into current activity rows, activity groups, summaries, or sampled history.

### Zone And Severity Are First-Class UI Semantics

Timeline items need a required zone for layout and filtering. Items that can affect urgency need optional severity for visual hierarchy, notification routing, summarization, compaction, and mobile rendering.

### Attention May Become Orthogonal

Phase one can represent attention-oriented states with `attention.*` primitives and approval-style behavior. Future projection work should revisit whether attention deserves its own orthogonal axis, similar to severity and behavior, because blocked or operator-attention states may originate from conversation, runtime, workflow, collaboration, or artifact review.

### Affordances Are Not Just Styling

Phase-one behavior can use `actionable` as a rendering hint. Future projection work should introduce explicit interaction affordance semantics so Airport can distinguish what an operator can reply to, approve, reject, interrupt, resume, inspect, or expand. Affordances should derive from AgentExecution permissions, capabilities, runtime state, ownership, and interaction mode rather than local component assumptions.

## Timeline Zones

Airport should treat each timeline item as belonging to one zone:

| Zone | Meaning | Typical UI Region |
| --- | --- | --- |
| conversation | Human-readable operator, agent, daemon, or system interaction | chat-like timeline region |
| activity | Current or historical execution posture | live status row or compact activity group |
| workflow | Entity, Mission, Task, verification, delegation, or owner-effect truth | timeline milestone or review card |
| runtime | Terminal, adapter, transport, heartbeat, delivery, or infrastructure state | runtime badge, warning, or diagnostic row |
| artifact | Inspectable outputs such as files, diffs, tables, snippets, and generated material | artifact card or structured viewer |

Zone controls grouping, filtering, layout, collapse behavior, summarization, mobile ordering, and navigation. Zone is structural, not just styling.

## Severity

Timeline items may carry severity when visual urgency matters:

```ts
type AgentExecutionTimelineSeverity =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'critical';
```

Severity is most important for runtime indicators, workflow events, warnings, blocked states, and verification results. Normal operator and agent conversation does not need `severity: 'info'` by default.

Severity should influence:

- visual hierarchy.
- filtering and search facets.
- notification routing.
- mobile priority ordering.
- summarization and compaction.
- accessibility labels.

## Behavior Classes

Timeline items should declare or derive a render behavior class:

| Behavior Class | Product Behavior |
| --- | --- |
| conversational | bubble or transcript-like layout, markdown, stable history |
| timeline-event | compact milestone row for durable system or workflow facts |
| live-activity | sticky, updating, compactable execution state |
| artifact | expandable structured viewer |
| approval | actionable operator decision or input surface |
| runtime-warning | pinned or high-attention infrastructure problem |
| terminal | inspectable terminal evidence block |
| replay-anchor | boundary used for restore, replay, summary, or navigation |

Attention is best modeled as behavior rather than a zone in phase one. For example, a `needs_input` item can be `zone: 'conversation'` with `behavior.class: 'approval'`, while a verification failure can be `zone: 'workflow'` with `behavior.class: 'approval'` and `severity: 'error'`. This is a starting constraint, not a permanent claim that every blocked or attention state belongs to workflow.

## Target Projection Inventory

| Primitive | Zone | Behavior | Severity | Persistence | Frequency |
| --- | --- | --- | --- | --- | --- |
| conversation.operator-message | conversation | conversational | optional | durable | medium |
| conversation.agent-message | conversation | conversational | optional | durable | high |
| conversation.system-message | conversation | conversational | optional | durable | medium |
| conversation.reasoning-summary | conversation | conversational | optional | durable | medium |
| attention.input-request | conversation | approval | optional | durable | medium |
| attention.blocked | workflow | approval | warning/error | durable | medium |
| attention.verification-requested | workflow | approval | info/warning | durable | medium |
| attention.verification-result | workflow | timeline-event | success/error | durable | medium |
| activity.status | activity | live-activity | optional | compactable | high |
| activity.progress | activity | live-activity | optional | compactable | very high |
| activity.tool | activity | live-activity | optional/error | durable or compactable | high |
| activity.target | activity | live-activity | optional | compactable | high |
| workflow.event | workflow | timeline-event | optional | durable | low |
| workflow.state-changed | workflow | timeline-event | optional | durable | low |
| runtime.indicator | runtime | timeline-event | info/success/warning/error | overlay or durable | medium |
| runtime.warning | runtime | runtime-warning | warning/error/critical | overlay or durable | low |
| terminal.snippet | runtime | terminal | optional/error | durable | medium |
| artifact.created | artifact | artifact | optional/success | durable | medium |
| artifact.updated | artifact | artifact | optional | durable | medium |
| artifact.diff | artifact | artifact | optional | durable | medium |
| replay.marker | workflow | replay-anchor | optional | durable | low |
| summary.generated | workflow | replay-anchor | optional | durable | medium |

This inventory is a projection vocabulary. It must not be copied into journal truth as a replacement for journal record types.

## Current Experience Requirements

Phase one should adapt the current AgentExecution timeline surface rather than replacing it wholesale.

The current screen should continue to support:

- existing timeline rendering.
- structured prompt submission when allowed by AgentExecution interaction capabilities.
- structured runtime commands when exposed by message descriptors.
- optional terminal inspection panel for terminal-backed executions.
- live refresh through AgentExecution `data.changed` events.

The improved phase-one screen should add or prepare for:

- a product title that can shift from Agent chat toward Agent execution or Agent timeline where the host surface still uses chat-shaped component names.
- stronger visual separation between conversation, activity, input requests, claims, failures, and system status.
- a sticky current activity row when activity projection data is available.
- inline attention cards for input requests and blocked states.
- runtime status badges for terminal attachment and selected structured signal transport.
- copy that avoids presenting terminal exhaust as the main product experience.

## Intelligent Timeline Experience Requirements

The mature AgentExecution timeline should support the following UX capabilities when projection data exists:

- collapsible reasoning blocks for durable reasoning summaries or curated explanation spans.
- sticky task progress that remains visible while the execution is active or replaying.
- scroll-to-step navigation for workflow milestones, input requests, verification points, tool groups, and replay anchors.
- timeline replay that can scrub or step through journal-derived state without mutating execution truth.
- branch navigation for alternate execution paths, retries, delegated executions, or future graph-backed causality views.
- streaming diffs that update as artifact or file-change projection material arrives, then settle into durable diff cards.
- synchronized terminal output where selected timeline items can reveal the corresponding terminal recording window without making terminal output the primary UI.
- grouped tool and activity regions that collapse high-frequency events while preserving source provenance.
- unresolved attention surfacing so input requests, failures, blocked states, and critical runtime warnings remain visible across scroll and mobile layouts.

## Future Experience Requirements

As `timelineItems` mature beyond the bounded phase-one projection, Airport should support:

- zone filters.
- severity filters.
- grouped activity spans.
- collapsible details for diagnostics, tools, terminal snippets, and artifacts.
- durable replay anchors and summary boundaries.
- cursor-based older timeline windows.
- mobile-first ordering where critical workflow and runtime items surface above low-value activity noise.
- keyboard navigation by timeline item and by zone.
- timeline replay controls for journal-backed historical state.
- branch or delegation navigation when projection provenance references alternate executions.
- synchronized terminal evidence panes linked to timeline items by provenance or timestamp window.
- streaming diff and artifact viewers for in-progress output projection.

Later multi-agent timelines should support concurrent AgentExecution lanes, delegated execution cards, merged activity regions, shared artifact evolution, and cross-Agent workflow causality without making any one Airport surface own execution truth.

Beyond multi-agent timeline composition, Mission may need execution graph visualization. Timelines, delegation, causality, artifacts, workflow effects, ownership, and concurrency naturally produce a timeline-and-graph hybrid view. That graph should be a higher-level projection over AgentExecution, Mission workflow, and Artifact projections, not a replacement for their canonical owners.

## Acceptance Criteria

- Airport can render current `timelineItems` without losing existing operator workflows.
- The documented target model can express non-message timeline items.
- Timeline items have a required zone.
- Timeline items can carry optional severity.
- Attention surfaces render differently from normal conversation.
- Runtime warnings and verification results can be visually prioritized and filtered.
- Terminal output remains available for inspection without becoming semantic UI truth.
- High-frequency activity can be collapsed or summarized without changing durable semantic state.
- The UI model remains provider-neutral and scope-neutral.
- Projection material is derived from AgentExecution data and journal replay, not locally invented by Airport components.
- Projection semantics are registry-driven: record-family coverage comes from the journal record registry, and signal-family coverage comes from the AgentExecution signal registry.
- Every descriptor-backed signal that can produce operator-facing material has a projection path into `timelineItems` or another explicit projection family.
- Airport defines component shapes for each projection behavior class and journal-derived primitive family.
- Airport can navigate, replay, collapse, expand, and synchronize timeline regions without treating journal records as raw UI rows.

## Phase Plan

1. Keep `timelineItems` as the canonical operator-facing projection and improve their current semantic presentation.
2. Refactor the current AgentExecution UI around behavior-class components while preserving operator workflows.
3. Extend AgentExecution-owned replay/projection coverage from the current registry-backed `timelineItems` projection toward richer grouping, replay, and artifact presentation.
4. Add grouping and compaction rules for activity, progress, telemetry, diagnostics, and runtime overlay updates.
5. Add cursor-based journal windows and timeline virtualization after measured volume requires it.
6. Add rich artifact, diff, terminal snippet, delegation, and multi-agent execution items as backend projection support lands.
7. Add replay, branch navigation, synchronized terminal evidence, and streaming artifact/diff components after projection provenance can support them.

## Open Questions

1. Should the Airport route and visible heading use Agent execution, Agent timeline, or retain Agent chat during phase one?
2. Should severity be authored by the backend projection, derived by Airport from primitive and payload, or both with backend severity taking precedence?
3. Should attention input requests remain in the conversation zone, or should future multi-agent coordination introduce a separate attention zone?
4. What is the first cursor window size that keeps long AgentExecutions usable without premature virtualization complexity?
5. Should attention become an orthogonal projection axis once blocked states span runtime, workflow, conversation, collaboration, and artifact review?
6. What is the minimum projection shape needed for multi-agent timeline composition without prematurely building a global timeline engine?
7. Which operator interaction affordances should become explicit projection semantics instead of generic `actionable` rendering hints?
8. What is the first execution graph visualization that adds value without turning timeline projection into a graph engine too early?
9. Should signal registry entries eventually expose timeline primitive, zone, severity, and behavior metadata directly, or should those remain in a separate AgentExecution projection registry layered over the signal registry?
