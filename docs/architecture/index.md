---
layout: default
title: Architecture
nav_order: 5
has_children: true
description: The current Mission architecture in daemon, Entity, Open Mission, workflow, and adapter terms.
---

Mission is built around strict ownership:

- **Entity classes** own domain behavior and invariants.
- **Entity schemas** own validated payload, storage, and data shapes.
- **Entity contracts** expose daemon-readable method metadata.
- **The daemon** owns runtime state, command dispatch, and agent coordination.
- **Open Mission** is a surface over daemon-owned state.
- **Adapters** translate external systems into Mission concepts.

Generic Entity infrastructure is child-independent. It must not import concrete Entity contracts, concrete Entity classes, daemon registries, runtime services, adapters, or provider implementations. Concrete contract catalogues and daemon capability wiring belong in daemon-owned dispatch modules. See ADR-0001.07 before changing Entity infrastructure.

Read [System Context](system-context.md), [Semantic Model](semantic-model.md), [Entity Reference](entities/index.md), and [Entity Command Surface](entity-command-surface.md) first. ADR-0001.03 is the key architectural decision behind the current OOD model.

For daemon-supervised live frontend work served through the Open Mission host, read [Impeccable Live Supervision](impeccable-live-supervision.md). It defines the owner-id-only live-session model, daemon runtime-supervision ownership, host proxy behavior, and operator usage expectations.

Temporary working specs are allowed while a refactor is in flight. For Agent execution structured interaction, use [Agent Execution Structured Interaction Spec](agent-execution-structured-interaction-spec.md) as the current implementation reference until its durable decisions are folded back into `CONTEXT.md` and accepted ADRs. For the daemon-owned MCP signal transport, use [Mission MCP Server Spec](mission-mcp-server-spec.md) as the current realization blueprint for ADR-0006.06.

For the current journal-ledger refactor, use [Agent Execution Journal Ledger Spec](agent-execution-journal-ledger-spec.md) as the temporary implementation reference for the typed journal family split and replay contract tightening.

For the next AgentExecution persistence step, read [Agent Execution Interaction Journal PRD](agent-execution-interaction-journal-prd.md) and [Agent Execution Interaction Journal Spec](agent-execution-interaction-journal-spec.md). These documents define the canonical semantic interaction journal that separates AgentExecution replay truth from terminal recordings and Mission workflow events.

For the Mission-native code intelligence slice, read [Code Intelligence PRD](repository-code-intelligence-prd.md) and [Code Intelligence Spec](repository-code-intelligence-spec.md). These temporary documents define the GitNexus-inspired, SurrealDB-backed code graph and the `open-mission-mcp` semantic operations that expose it to scoped Agent executions.

For the next code-intelligence graph simplification step, read [Code Intelligence Node Edge Graph PRD](code-intelligence-node-edge-graph-prd.md) and [Code Intelligence Node Edge Graph Spec](code-intelligence-node-edge-graph-spec.md). These temporary documents define the minimal persisted graph shape built around `code_object`, `code_relation`, and explicit `snapshotId` ownership.

For the normalized Entity storage refactor, read [Entity OGM Storage/View PRD](entity-ogm-storage-view-prd.md) and [Entity OGM Storage/View Spec](entity-ogm-storage-view-spec.md). These temporary documents define the `/flying-pillow`-style OGM-backed split between canonical storage rows and hydrated Entity views, plus the relation-aware registry and SurrealDB direction needed for the general Entity-model refactor.

For the structured-first Agent interaction split, read [Agent Interaction Structured-First PRD](agent-interaction-structured-first-prd.md) and [Agent Interaction Structured-First Spec](agent-interaction-structured-first-spec.md). These temporary documents define the structured Mission control lane, optional terminal capability, slash-command taxonomy, and migration path behind ADR-0006.10.
