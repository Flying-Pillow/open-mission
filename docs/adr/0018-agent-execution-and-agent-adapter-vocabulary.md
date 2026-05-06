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

An AgentAdapter is the provider or tool translation object owned by one Agent. It is not an Entity and is not independently registered. The adapter validates adapter-specific metadata, translates an AgentLaunchConfig into provider-specific command, args, and env, parses provider-structured output when available, and reports provider observations to the daemon-owned execution pipeline. AgentAdapter does not own lifecycle truth, TerminalRegistry, MCP server lifecycle, signal policy, Mission state transitions, or AgentExecution mutation.

An AgentExecutor is the daemon-owned lifecycle coordinator for Agent executions. It resolves an Agent, uses that Agent's AgentAdapter to create a launch plan, provisions daemon-owned MCP execution access, opens or reconciles Terminal resources through TerminalRegistry when needed, creates or updates live AgentExecution state, routes observations, applies AgentExecutionSignalPolicy, and exposes start, reconcile, prompt, command, cancel, and terminate operations to workflow and daemon control surfaces. AgentExecutor is not an Entity and is not provider-specific. Per-execution terminal attachment behavior is private AgentExecutor coordination, not a separate domain object.

An AgentExecution is one concrete execution of one Agent under an explicit AgentExecutionScope. AgentExecution replaces the previous AgentSession concept as canonical vocabulary. AgentExecution owns execution identity, scope, durable context, log references, progress, terminal handle reference, structured message surface, protocol snapshots, and audit-facing execution state. AgentExecution does not own PTY spawning, TerminalRegistry lookup, process kill behavior, MCP provisioning, or provider output routing.

AgentExecutionScope is the daemon-owned statement of what the execution is attached to. Supported scopes are system, repository, mission, task, and artifact. Mission and task ids are scope fields, not required AgentExecution identity fields. A task-scoped execution participates in workflow request and event handling. A mission-scoped execution supports Mission-level work without selecting a task. A repository-scoped execution supports repository operations outside a specific Mission. A system-scoped execution supports daemon/system maintenance. An artifact-scoped execution supports focused work on one artifact and may optionally reference the repository, Mission, or task that owns that artifact.

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

TerminalRegistry
  -> Terminal
```

AgentRuntime is not canonical Mission vocabulary. A class named AgentRuntime must not remain as an alias for AgentAdapter or AgentExecutor. The current implementation's AgentRuntime copy of AgentAdapter is duplicate vocabulary and must be deleted during convergence.

This decision requires clean-sheet convergence. The implementation must not introduce aliases, compatibility exports, tolerant readers, duplicate old/new names, or transitional parallel concepts. When the codebase moves from AgentSession to AgentExecution or from Runtime wording to AgentExecutor/AgentAdapter/AgentExecution wording, the old vocabulary must be removed in the same bounded change. If persisted Mission runtime data needs to change, the change must be handled by an explicit runtime migration decision or by updating disposable mission state directly, not by accepting both shapes.
