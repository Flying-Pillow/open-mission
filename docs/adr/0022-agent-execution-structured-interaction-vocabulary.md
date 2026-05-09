---
layout: default
title: Agent Execution Structured Interaction Vocabulary
parent: Architecture Decisions
nav_order: 22
status: proposed
date: 2026-05-07
decision_area: agent-runtime
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Agent execution structured interaction is an Entity-addressed runtime conversation between an Agent execution and the Entity that owns its scope.

This decision is proposed because the current implementation has useful pieces but overloaded terms: Agent execution messages, Agent commands, Mission protocol signals, Agent execution observations, workflow events, and Entity events all appear near the same runtime path. Future implementation needs one precise vocabulary for the ways an Agent execution can receive instructions, emit structured runtime text, and cause daemon-owned Entity behavior.

## Vocabulary

An **Entity command** is an authoritative caller-to-Entity mutation request. It enters through `entity.command`, is validated by the target Entity contract, and is handled by the target Entity class or its aggregate delegate. Entity commands are the canonical operator and daemon mutation surface.

An **Entity event** is a daemon-emitted fact that an Entity publishes after accepted behavior or observed runtime state changes. Entity events cross daemon-client boundaries through Entity contracts and event envelopes.

An **Agent execution message** is structured daemon-to-AgentExecution input. It can be operator-authored or daemon-authored. It may deliver a prompt, runtime control request, or context operation to an Agent execution. If the message changes durable Agent execution context, the context mutation is canonical when accepted by the owning daemon Entity; runtime delivery to the Agent adapter remains best effort.

An **Agent execution message descriptor** describes one daemon-to-AgentExecution message that is available for a specific execution. It names the message type, label, input shape, delivery behavior, and context effect so Airport and daemon modules can present and send messages from the same source of truth.

An **Agent-declared signal** is structured text emitted by the Agent process to the Entity that owns the execution scope. The signal marker prefix is derived from the owning Entity, such as `@task::`, `@mission::`, `@repository::`, or `@artifact::`, followed by strict JSON on the same line. The current `@mission::` marker is the first implementation of this owner-addressed pattern for Mission/task work and should converge into the owner-derived prefix model as scope support broadens.

An **Agent-declared signal descriptor** describes one structured signal payload that the owning Entity accepts for a specific Agent execution. It names the marker prefix, signal type, payload shape, validation limits, policy behavior, and possible accepted outcomes.

An **Agent execution observation** is the daemon-normalized representation of something observed from the Agent runtime, such as an Agent-declared signal, provider-structured output, terminal output heuristic, or daemon-authored observation. Observations are evaluated by policy before they can affect AgentExecution state, owner Entity state, or published Entity events.

An **Agent execution claim** is an accepted observation where the Agent declares readiness, completion, failure, or another state assertion that requires Mission or operator verification. A claim may publish an Entity event or update AgentExecution audit state. Mission task completion follows the owning Entity's workflow rules.

An **Agent execution protocol descriptor** is the complete structured interaction contract for one Agent execution. It combines the available Agent execution message descriptors and Agent-declared signal descriptors for the execution's scope, owner Entity, selected Agent, and Agent adapter.

## Source Of Truth

The source of truth for structured Agent execution interaction is the Agent execution protocol descriptor owned by the daemon for that AgentExecution scope. The descriptor is derived from the AgentExecution Entity, the selected Agent adapter, and the owning Entity resolved from `AgentExecutionScope`.

The descriptor has two distinct halves:

1. **Agent-declared signal descriptors**: the owner-addressed marker payloads that the daemon parses from Agent stdout for this execution.
2. **Agent execution message descriptors**: the structured daemon-to-AgentExecution messages that an operator or daemon module may send to the execution.

Prompt-scoped instructions are rendered from this descriptor. The descriptor is the source of truth for supported marker payloads, and rendered prompt text is a delivery view of that descriptor. Marker JSON carries only the Agent execution id, event id, version, and signal payload; owner and scope context come from the active `AgentExecutionScope` and protocol descriptor.

The current `AgentExecutionMessageDescriptor` concept is only one half of this source of truth. Mission also needs an explicit descriptor for accepted Agent-declared signals so the launch instructions, parser, policy, and surface documentation share one vocabulary.

## Ownership

The public architecture is owner-Entity resolution:

```text
AgentExecutionScope
  -> owning Entity
      -> Entity contract methods
      -> Entity contract events
```

For task-scoped executions, the immediate owning Entity is the Task, while the Running Mission aggregate remains the delegate for workflow state changes. For mission-scoped executions, the owning Entity is Mission. For repository-scoped executions, the owning Entity is Repository. For artifact-scoped executions, the owning Entity is Artifact, with optional Mission or Task context carried by scope data when present.

AgentExecutor is the daemon runtime orchestrator and manager for launch, terminal attachment, provider output parsing, and observation routing. AgentExecutionRegistry is only the daemon collection and lookup boundary for active AgentExecution Entity instances. Scoped meaning belongs to the owning Entity. When an observation can affect scoped behavior, AgentExecutor routes the observation to the owning Entity path and applies the accepted result from that Entity path.

Owning Entities may expose commands that start, ensure, or select an AgentExecution for their scope. Those commands return an AgentExecution reference or schema-validated AgentExecution data, but the ongoing structured interaction remains AgentExecution-addressed. Repository management, Mission work, Task work, and Artifact work must not each invent duplicate `sendPrompt`, `sendRuntimeMessage`, `cancel`, or `complete` owner commands for their child executions.

The implementation must not add owner-specific AgentExecution classes such as RepositoryAgentExecution, MissionAgentExecution, TaskAgentExecution, or ArtifactAgentExecution. Scope is data on AgentExecution, not a reason to create another execution model. Owner Entities may store workflow references to AgentExecution ids when their own state needs to remember participation, but the executable interaction state remains the single AgentExecution Entity state.

## Mapping Rules

The structured runtime path is:

```text
Agent stdout line with owner prefix
  -> owner-addressed signal parser
  -> Agent-declared signal
  -> Agent execution observation
  -> owning Entity policy/method
  -> AgentExecution state change, Entity event, workflow event, or rejection
```

An Agent-declared signal may produce an AgentExecution Entity event after policy acceptance. When a signal represents a request for owner action, the owning Entity evaluates it as an observation or claim and decides the resulting domain behavior through its own methods, policies, and workflow delegate. The Agent is not asked to echo Mission, Task, Artifact, Repository, or owner ids in the marker payload; the daemon attaches the active route scope and rejects markers whose `agentExecutionId` does not match the active execution.

AgentExecution lifecycle truth remains daemon-owned. `completed_claim` and `failed_claim` are claims that become lifecycle transitions through daemon-authoritative owner behavior. `ready_for_verification` is a claim that the owning Entity or operator may use to surface verification work.

`needs_input` is an observation that can put AgentExecution into an awaiting-input state and publish an Entity event. Its signal payload carries a required `question` and required `choices` array. Each choice is either `kind: "fixed"` with `label` and `value`, or `kind: "manual"` with `label` and optional `placeholder` for freeform operator input. The operator response is a separate Agent execution message or Entity command.

`progress`, `blocked`, and `message` can update AgentExecution progress or audit-facing state after policy evaluation. Any Mission workflow effect flows through an explicit owning Entity rule covered by tests.

## Event Listener Discipline

Owning Entities may listen to AgentExecution events for executions they own. Those listeners are part of the owning Entity's behavior. A listener may coordinate local reactions, such as refreshing command views or applying workflow events through the Running Mission aggregate.

Entity events publish accepted facts. Owning Entity methods and policies validate whether an observation is allowed and decide what state changes follow.

## Consequences

- Agent launch instructions are generated from Agent execution protocol descriptors.
- AgentExecution exposes both message descriptors and signal descriptors in its protocol snapshot or data model.
- AgentExecutor routes accepted observations through owner-Entity resolution.
- AgentExecutionRegistry indexes active AgentExecution instances by AgentExecution id and owner-derived key. It must not duplicate AgentExecutor lifecycle management or become an owner-specific session controller.
- AgentExecution command, query, terminal snapshot, and terminal input locators use `ownerId` plus `sessionId`. Scope-specific fields such as Mission id, task id, artifact id, and repository root path stay inside `AgentExecutionScope`; they must not leak into owner-specific AgentExecution locator branches.
- AgentExecution launch requests carry `workingDirectory` separately from `ownerId`. Repository-owned executions start in the repository root; Mission/task executions start in the launch-selected Mission worktree or other explicit working directory. Terminal interaction after launch addresses the execution by `ownerId` and `sessionId`, not by recomputing a process location.
- Owner Entities may initiate scoped Agent executions, but they do not persist full AgentExecution data inside their own Entity data schemas unless a separate ADR explicitly makes that Entity the durable owner of that child record. Runtime attachment is represented by AgentExecution scope and daemon runtime lookup, not by owner-specific session maps.
- Owner-specific AgentExecution wrapper classes and owner-specific execution record models are forbidden. They multiply layers for every future owner and obscure the single AgentExecution contract.
- The Agent signal parser remains strict and deterministic. Domain acceptance happens in the owning Entity path.
- The word `command` names Entity commands and intentional daemon/operator-to-AgentExecution command messages. Agent-authored stdout markers are signals, observations, or claims.
- The word `event` names accepted daemon-published facts. Raw Agent stdout becomes an event only after daemon code accepts and publishes it as one.
- The word `signal` names the structured line of Agent-authored text and its parsed payload. Implementation names should prefer `AgentDeclaredSignal` where precision helps.

## Open Questions

1. Should Agent-declared signal descriptors live in `AgentExecutionSchema.ts` beside message descriptors, or in a separate protocol schema owned by the AgentExecution Entity module?
2. Should owner-Entity observation handling be exposed as normal Entity contract methods, or through daemon-internal owner methods until there is a client-facing need?
3. Which accepted observations should publish first-class AgentExecution Entity events beyond `data.changed` and terminal updates?
4. Should artifact-scoped execution choose Artifact as the immediate owner even when it carries Mission and Task scope data, or should Task own artifact-scoped execution when `taskId` is present?
