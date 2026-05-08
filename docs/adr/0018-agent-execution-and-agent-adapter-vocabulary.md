---
layout: default
title: Agent Execution And Agent Adapter Vocabulary
parent: Architecture Decisions
nav_order: 18
status: accepted
date: 2026-05-06
decision_area: agent-execution-model
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission uses Agent, AgentAdapter, AgentExecutor, AgentExecution, and Terminal as distinct canonical runtime concepts.

An Agent is the registered Mission capability that can perform work, such as Copilot CLI, Claude Code, Codex, Pi, or OpenCode. Agent is an Entity. Agent owns its identity, display name, configuration, availability policy, and exactly one AgentAdapter. AgentSchema owns the shared Agent payload and Agent id vocabulary. AgentRegistry is the first-class catalogue of available Agents. There is no separate AgentAdapter registry, catalog, or set: resolving an Agent through the AgentRegistry is the only domain lookup needed before execution.

An AgentAdapter is the provider or tool translation object owned by one Agent. It is not an Entity and is not independently registered. The adapter validates adapter-specific metadata, translates an AgentLaunchConfig into provider-specific command, args, and env, parses provider-structured output when available, and reports provider observations to the daemon-owned execution pipeline. AgentAdapter does not own lifecycle truth, TerminalRegistry, prompt-scoped signal instruction, signal policy, Mission state transitions, or AgentExecution mutation.

An AgentExecutor is the daemon-owned lifecycle coordinator and manager for Agent executions. It resolves an Agent, uses that Agent's AgentAdapter to create a launch plan, prepends mandatory prompt-scoped signal instructions, opens or reconciles Terminal resources through TerminalRegistry when needed, creates or updates live AgentExecution state, routes observations, applies AgentExecutionSignalPolicy, and exposes start, reconcile, prompt, command, cancel, and terminate operations to workflow and daemon control surfaces. AgentExecutor is not an Entity, not a registry, and not provider-specific. Per-execution terminal attachment behavior is private AgentExecutor coordination, not a separate domain object.

AgentExecutionRegistry is the daemon collection of active AgentExecution Entity instances. It indexes AgentExecutor-managed AgentExecutions by AgentExecution id and owner-derived key so repository-scoped, mission-scoped, task-scoped, artifact-scoped, and system-scoped executions can be read or commanded through the AgentExecution Entity contract. Like other Mission registries, it is a collection and lookup boundary for instantiated domain objects; it does not own lifecycle orchestration, terminal control, adapter translation, observation policy, or scoped domain behavior. Those responsibilities remain with AgentExecutor, TerminalRegistry, AgentAdapter, AgentExecution, and the owning Entity respectively. AgentExecutionRegistry must not be implemented as a static map or child-session table inside Repository, Mission, Task, Artifact, or any other owning Entity.

An AgentExecution is one concrete execution of one Agent under an explicit AgentExecutionScope. AgentExecution replaces the previous AgentSession concept as canonical vocabulary. AgentExecution owns execution identity, scope, durable context, log references, progress, terminal handle reference, structured message surface, protocol snapshots, and audit-facing execution state. AgentExecution does not own PTY spawning, TerminalRegistry lookup, process kill behavior, prompt-scoped signal instruction, or provider output routing.

AgentExecution is scoped to an owning Entity; it is not structurally owned by that Entity. Repository, Mission, Task, Artifact, and System scopes must not introduce owner-specific AgentExecution classes, owner-specific child execution records, or owner-specific prompt/command/cancel/complete wrappers. A Mission may keep workflow references to the AgentExecution ids that participate in Mission workflow state, but that does not make a second MissionAgentExecution model. The single AgentExecution Entity data contract remains the shape exposed for execution state and interaction.

AgentExecutionScope is the daemon-owned statement of what the execution is attached to. Supported scopes are system, repository, mission, task, and artifact. Mission, task, repository, and artifact ids are scope fields, not separate AgentExecution locator fields. A task-scoped execution participates in workflow request and event handling. A mission-scoped execution supports Mission-level work without selecting a task. A repository-scoped execution supports repository operations outside a specific Mission. A system-scoped execution supports daemon/system maintenance. An artifact-scoped execution supports focused work on one artifact and may optionally reference the repository, Mission, or task that owns that artifact.

AgentExecution interaction and terminal transport are addressed by the owner-independent pair `ownerId` and `sessionId`. `ownerId` is the owner-derived AgentExecution address for the active scope; it is not a Mission-only field and must not be replaced by branching locators such as `missionId` or `repositoryRootPath` in the AgentExecution contract. Scope fields remain on `AgentExecutionScope` for domain meaning and owner routing.

AgentExecution launch location is separate from AgentExecution address. `AgentLaunchConfig.workingDirectory` defines the process working directory used when AgentExecutor opens the terminal. For a repository-owned execution, the working directory must be the repository root. For a Mission or task execution, the working directory may be the Mission worktree or another explicitly selected path owned by that launch request. Terminal snapshot and input queries must not infer launch location from `ownerId`; they use `ownerId` only to address the execution after launch.

AgentExecutionProtocol is the provider-neutral type contract for controlling, observing, and messaging an AgentExecution. The protocol types belong with the AgentExecution Entity module because they describe the public execution surface and snapshots. Lifecycle orchestration belongs to AgentExecutor. Mission does not use AgentRuntime as canonical vocabulary because the current AgentRuntime implementation duplicates AgentAdapter/AgentExecutor responsibilities without a distinct domain meaning.

TerminalRegistry is the Terminal Entity boundary owner of live Terminal objects. It is application-level and must not be bound to Mission as its root owner. A Terminal is one PTY-backed terminal resource with process lease, screen state, input, resize, exit state, and snapshot/update behavior. Terminal may be owned by an AgentExecution, Mission, task, repository, or system-level operation through explicit owner metadata. Runtime terminal modules provide terminal screen substrate behavior only.

TerminalSession is not canonical Mission vocabulary. Terminal-related contracts must use TerminalHandle, TerminalSnapshot, TerminalUpdate, TerminalOwner, terminalId, or terminalName as appropriate. TerminalRuntime may exist only as a backend abstraction for terminal implementations such as NodePtyTerminalRuntime; it is not the same concept as Terminal.

The clean ownership graph is:

```text
AgentRegistry
  -> Agent
      -> AgentAdapter

AgentExecutor
  -> Agent
  -> AgentAdapter
  -> AgentExecution
  -> AgentExecutionScope
      -> optional TerminalHandle

AgentExecutionRegistry
  -> active AgentExecution collection and lookup only
  -> delegates lifecycle operations to AgentExecutor

TerminalRegistry
  -> Terminal
```

AgentRuntime is not canonical Mission vocabulary. A class named AgentRuntime must not remain as an alias for AgentAdapter or AgentExecutor. The current implementation's AgentRuntime copy of AgentAdapter is duplicate vocabulary and must be deleted during convergence.

This decision requires clean-sheet convergence. The implementation must not introduce aliases, compatibility exports, tolerant readers, duplicate old/new names, or transitional parallel concepts. When the codebase moves from AgentSession to AgentExecution or from Runtime wording to AgentExecutor/AgentAdapter/AgentExecution wording, the old vocabulary must be removed in the same bounded change. If persisted Mission runtime data needs to change, the change must be handled by an explicit runtime migration decision or by updating disposable mission state directly, not by accepting both shapes.

Owning Entities may start or request Agent executions for their scope and may evaluate accepted observations that target their scope. They must not wrap AgentExecution prompt, command, cancellation, completion, or terminal behavior in owner-specific command vocabularies. After launch, operator follow-up input is addressed to AgentExecution through the AgentExecution Entity contract or through an explicitly documented non-command transport such as Terminal input, using the AgentExecution `ownerId` plus `sessionId` locator.
