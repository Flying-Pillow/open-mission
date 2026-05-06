---
layout: default
title: Explicit Agent Execution Context
parent: Architecture Decisions
nav_order: 3
status: accepted
date: 2026-05-04
decision_area: agent-execution-context
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission uses agents to perform controlled engineering work. The context for an Agent execution must be explicit, inspectable, and daemon-owned; it must not depend on adding a broad prompt and hoping the agent discovers the correct artifacts.

An Agent execution context is modeled as explicit artifact and Entity references with roles and ordering. When the execution is Mission-scoped or task-scoped, those references commonly include Mission artifacts. Agent-session artifacts are first-class Mission artifacts produced by or attached to an Agent execution, such as transcript summaries, extracted test output, patch summaries, or generated implementation notes. The Mission control outline may place artifacts at Mission, stage, task, or Agent execution level without changing their canonical Entity identity.

Raw Agent execution logs are not Mission artifacts by default. They are daemon-owned audit material retained with daemon runtime state, and with the Mission dossier/state store when the execution is Mission-scoped. If a transcript summary, test output, patch note, or implementation note becomes useful to a Mission, the daemon or operator promotes that curated material into a separate Agent-session artifact that may reference or extract from the log.

Agent execution context ordering is durable Agent execution state. The order of artifacts and instructions given to an Agent execution is part of its working context and audit trail, so the daemon owns and persists that order with the Agent execution context. Mission control placement may visualize context order or request reorder commands, but it is not the source of truth for ordering.

Changes to Agent execution context become canonical when accepted by the daemon. An Agent execution is indeterministic and may ignore, misunderstand, or fail to structurally acknowledge a delivered message, so runtime delivery must never be treated as proof that the Agent execution applied the context change. If Mission also sends a message to the Agent adapter, that delivery is best-effort instruction and audit evidence, not the source of context truth.

When an Agent-session artifact becomes useful beyond the session that produced it, Mission keeps the same canonical Mission artifact and adds another role or Mission control outline placement if needed. Promotion is a relationship or placement change, not a content copy into a new artifact. A future copy operation would need explicit lineage semantics and should not be the default.

This keeps agent behavior auditable and controllable: prompts can explain intent, but artifact references define the working context.
