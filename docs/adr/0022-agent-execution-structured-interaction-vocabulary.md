---
layout: default
title: Agent Execution Structured Interaction Vocabulary
parent: Architecture Decisions
nav_order: 22
status: accepted
date: 2026-05-09
decision_area: agent-execution-interaction
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Agent execution structured interaction is an Entity-addressed conversation between an AgentExecution instance and the Entity that owns its scope.

This decision exists because the current implementation has useful pieces but overloaded terms: Agent execution messages, Agent commands, Mission protocol signals, Agent execution observations, workflow events, and Entity events all appear near the same execution path. Future implementation needs one precise vocabulary for the ways an AgentExecution instance can receive instructions, accept structured process output, and cause daemon-owned Entity behavior.

## Vocabulary

An **Entity command** is an authoritative caller-to-Entity mutation request. It enters through `entity.command`, is validated by the target Entity contract, and is handled by the target Entity class or its aggregate delegate. Entity commands are the canonical operator and daemon mutation surface.

An **Entity event** is a daemon-emitted fact that an Entity publishes after accepted behavior or observed runtime state changes. Entity events cross daemon-client boundaries through Entity contracts and event envelopes.

An **Agent execution message** is structured daemon-to-AgentExecution input. It can be operator-authored or daemon-authored. It may deliver a prompt, process control request, or context operation to an Agent execution. If the message changes durable Agent execution context, the context mutation is canonical when accepted by the AgentExecution instance and its owning Entity; delivery to the Agent process remains best effort.

An **Agent execution turn** is one accepted and delivered turn-starting Agent execution message. Launch prompts, follow-up prompts, and turn-starting Agent execution messages such as `resume`, `checkpoint`, or `nudge` each begin a new turn. A turn begins from daemon-owned acceptance and delivery records, not from Agent-authored acknowledgement text.

An **Agent execution message descriptor** describes one daemon-to-AgentExecution message that is available for a specific execution. It names the message type, label, input shape, delivery behavior, and context effect so Open Mission and daemon modules can present and send messages from the same source of truth.

An **Agent signal** is structured data emitted by the Agent process to the AgentExecution instance and then evaluated through the Entity that owns the execution scope. It may arrive through MCP, stdout markers, provider-structured output, or another descriptor-backed transport. Stdout marker prefixes are derived from the owning Entity, such as `@task::`, `@mission::`, `@repository::`, or `@artifact::`, followed by strict JSON on the same line.

An **Agent signal descriptor** describes one structured signal payload that the owning Entity accepts for a specific Agent execution. It names the marker prefix, signal type, payload shape, validation limits, policy behavior, and possible accepted outcomes.

An **Agent execution observation** is the daemon-normalized representation of something observed from the Agent execution process, such as an Agent signal, provider-structured output, terminal output heuristic, or daemon-authored observation. Observations are accepted by the AgentExecution instance and evaluated by policy before they can affect AgentExecution state, owner Entity state, or published Entity events.

An **AgentExecution decision** is the durable result of policy evaluation for a message or observation. It may reject input, record it without state effects, emit an AgentExecution event, update AgentExecution state, or route an owner effect. Decisions are recorded before their effects are applied so replay and audit can explain why state changed.

An **AgentExecution log** is append-only audit material for one AgentExecution. It records accepted AgentExecution messages, observations, decisions, state effects, owner effects, and projection material. It is owned by the AgentExecution instance and is separate from terminal recordings and Mission workflow event logs. It is not a separate Entity and not the owner of AgentExecution behavior.

An **Agent execution claim** is an accepted observation where the Agent declares readiness, completion, failure, or another state assertion that requires Mission or operator verification. A claim may publish an Entity event or update AgentExecution audit state. Mission task completion follows the owning Entity's workflow rules.

An **Agent execution protocol descriptor** is the complete structured interaction contract for one Agent execution. It combines the available Agent execution message descriptors and Agent signal descriptors for the execution's scope, owner Entity, selected Agent, and Agent adapter.

## Source Of Truth

The source of truth for supported structured Agent execution interaction is the Agent execution protocol descriptor owned by the AgentExecution instance for its scope. The descriptor is derived from the AgentExecution Entity, the selected Agent adapter, and the owning Entity resolved from `AgentExecutionScope`.

The source of truth while an AgentExecution is active is the AgentExecution instance. AgentExecution logs defined by ADR-0025 record what was accepted, observed, decided, and applied so the instance can be audited, projected, and recovered without making the log a separate domain owner.

The descriptor has two distinct halves:

1. **Agent signal descriptors**: the owner-addressed marker payloads that the daemon parses from Agent stdout for this execution.
2. **Agent execution message descriptors**: the structured daemon-to-AgentExecution messages that an operator or daemon module may send to the execution.

Prompt-scoped instructions are rendered from this descriptor. The descriptor is the source of truth for supported marker payloads, and rendered prompt text is a delivery view of that descriptor. Marker JSON carries only the Agent execution id, event id, version, and signal payload; owner and scope context come from the active `AgentExecutionScope` and protocol descriptor.

The current `AgentExecutionMessageDescriptor` concept is only one half of this source of truth. Mission also needs an explicit descriptor for accepted Agent signals so the launch instructions, parser, policy, and surface documentation share one vocabulary.

## Ownership

The public architecture is owner-Entity resolution:

```text
AgentExecutionScope
  -> owning Entity
      -> Entity contract methods
      -> Entity contract events
```

For task-scoped executions, the immediate owning Entity is the Task, while the Running Mission aggregate remains the delegate for workflow state changes. For mission-scoped executions, the owning Entity is Mission. For repository-scoped executions, the owning Entity is Repository. For artifact-scoped executions, the owning Entity is Artifact, with optional Mission or Task context carried by scope data when present.

AgentExecution owns launch, process lifecycle, terminal attachment decisions, provider output intake, and observation routing for its own execution. AgentExecutionRegistry is only the daemon collection and lookup boundary for active AgentExecution Entity instances. Scoped meaning belongs to the owning Entity. When an observation can affect scoped behavior, AgentExecution routes or delegates the observation to the owning Entity path and applies the accepted result from that Entity path.

Owning Entities may expose commands that start, ensure, or select an AgentExecution for their scope. Those commands return an AgentExecution reference or schema-validated AgentExecution data, but the ongoing structured interaction remains AgentExecution-addressed. Repository management, Mission work, Task work, and Artifact work must not each invent duplicate `sendPrompt`, `sendRuntimeMessage`, `cancel`, or `complete` owner commands for their child executions.

The implementation must not add owner-specific AgentExecution classes such as RepositoryAgentExecution, MissionAgentExecution, TaskAgentExecution, or ArtifactAgentExecution. Scope is data on AgentExecution, not a reason to create another execution model. Owner Entities may store workflow references to AgentExecution ids when their own state needs to remember participation, but the executable interaction state remains the single AgentExecution Entity state.

## Mapping Rules

The structured runtime path is:

```text
Agent process structured output
  -> owner-addressed signal parser
  -> Agent signal
  -> Agent execution observation
  -> AgentExecution instance
  -> owning Entity policy/method
  -> AgentExecution state change, Entity event, workflow event, or rejection
```

The structured delivery path for daemon-to-AgentExecution turns is:

```text
Agent execution message accepted by the daemon
  -> delivery attempted
  -> delivery recorded
  -> AgentExecution semantic activity set to awaiting-agent-response
  -> later Agent observation clears or refines the turn state
```

Surface attachment is not a turn. Attaching Open Mission or another surface to an existing AgentExecution only resolves transport and live state. If a surface-triggered action also starts work, it must do so by sending an explicit Agent execution message that begins a new turn and therefore enters `awaiting-agent-response` through the same daemon-owned delivery path as any other turn.

An Agent signal may produce an AgentExecution Entity event after policy acceptance. When a signal represents a request for owner action, the owning Entity evaluates it as an observation or claim and decides the resulting domain behavior through its own methods, policies, and workflow delegate. The Agent is not asked to echo Mission, Task, Artifact, Repository, or owner ids in the marker payload; the daemon attaches the active route scope and rejects markers whose `agentExecutionId` does not match the active execution.

AgentExecution lifecycle truth remains daemon-owned. `completed_claim` and `failed_claim` are claims that become lifecycle transitions through daemon-authoritative owner behavior. `ready_for_verification` is a claim that the owning Entity or operator may use to surface verification work.

Turn state is separate from lifecycle truth. When the daemon accepts and delivers an Agent execution turn, AgentExecution enters semantic activity `awaiting-agent-response` immediately and remains there until a meaningful Agent observation clears it, replaces it with another activity, or requests input. Surfaces must not wait for an Agent signal `initializing` marker before showing that a turn is in flight.

`needs_input` is an observation that keeps AgentExecution lifecycle `running`, sets `attention: awaiting-operator`, attaches a current input-request id, and may publish an Entity event. Its signal payload carries a required `question` and required `choices` array. Each choice is either `kind: "fixed"` with `label` and `value`, or `kind: "manual"` with `label` and optional `placeholder` for freeform operator input. The operator response is a separate Agent execution message or Entity command.

`progress` can update AgentExecution activity or telemetry after policy evaluation. It should not be modeled as a semantic state transition unless it changes lifecycle, attention, activity, or current input request. `blocked` can update attention or owner-visible claim state. `message` can update audit-facing projection state. Any Mission workflow effect flows through an explicit owning Entity rule covered by tests.

AgentExecution status must separate lifecycle, attention, activity, and runtime capabilities. `awaiting-input` is collaboration attention and input-request state, not a lifecycle state. Clean-sheet implementations must reject old `awaiting-input` lifecycle values rather than preserve compatibility readers or aliases.

## Event Listener Discipline

Owning Entities may listen to AgentExecution events for executions they own. Those listeners are part of the owning Entity's behavior. A listener may coordinate local reactions, such as refreshing command views or applying workflow events through the Running Mission aggregate.

Entity events publish accepted facts. Owning Entity methods and policies validate whether an observation is allowed and decide what state changes follow.

## Consequences

- Agent launch instructions are generated from Agent execution protocol descriptors.
- AgentExecution exposes both message descriptors and signal descriptors in its protocol snapshot or data model.
- AgentExecution records semantic interaction in AgentExecution logs, while Terminal persists raw PTY recordings and Mission workflow runtime persists orchestration events.
- AgentExecution chat or timeline views are projections over AgentExecution state, logs, and live process state, not source-of-truth transcripts.
- AgentExecution routes accepted observations through owner-Entity resolution.
- AgentExecutionRegistry indexes active AgentExecution instances by AgentExecution id and owner-derived key. It must not duplicate AgentExecutor lifecycle management or become an owner-specific session controller.
- AgentExecution command, query, terminal snapshot, and terminal input locators use `ownerId` plus `agentExecutionId`. Scope-specific fields such as Mission id, task id, artifact id, and repository root path stay inside `AgentExecutionScope`; they must not leak into owner-specific AgentExecution locator branches.
- AgentExecution launch requests carry `workingDirectory` separately from `ownerId`. Repository-owned executions start in the repository root; Mission/task executions start in the launch-selected Mission worktree or other explicit working directory. Terminal interaction after launch addresses the execution by `ownerId` and `agentExecutionId`, not by recomputing a process location.
- Owner Entities may initiate scoped Agent executions, but they do not persist full AgentExecution data inside their own Entity data schemas unless a separate ADR explicitly makes that Entity the durable owner of that child record. Runtime attachment is represented by AgentExecution scope and daemon runtime lookup, not by owner-specific session maps.
- Owner-specific AgentExecution wrapper classes and owner-specific execution record models are forbidden. They multiply layers for every future owner and obscure the single AgentExecution contract.
- The Agent signal parser remains strict and deterministic. Domain acceptance happens in the owning Entity path.
- The word `command` names Entity commands and intentional daemon/operator-to-AgentExecution command messages. Agent-authored stdout markers are signals, observations, or claims.
- The word `event` names accepted daemon-published facts. Raw Agent stdout becomes an event only after daemon code accepts and publishes it as one.
- The word `signal` names the structured line of Agent-authored text and its parsed payload. Implementation names should prefer `AgentSignal` where precision helps.

## Remaining Open Questions

1. Should owner-Entity observation handling be exposed as normal Entity contract methods, or through daemon-internal owner methods until there is a client-facing need?
2. Which accepted observations should publish first-class AgentExecution Entity events beyond `data.changed` and terminal updates?
3. Should artifact-scoped execution choose Artifact as the immediate owner even when it carries Mission and Task scope data, or should Task own artifact-scoped execution when `taskId` is present?
