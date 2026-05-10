---
layout: default
title: Architecture
nav_order: 5
has_children: true
description: The current Mission architecture in daemon, Entity, Airport, workflow, and adapter terms.
---

Mission is built around strict ownership:

- **Entity classes** own domain behavior and invariants.
- **Entity schemas** own validated payload, storage, and data shapes.
- **Entity contracts** expose daemon-readable method metadata.
- **The daemon** owns runtime state, command dispatch, and agent coordination.
- **Airport** is a surface over daemon-owned state.
- **Adapters** translate external systems into Mission concepts.

Read [System Context](system-context.md), [Semantic Model](semantic-model.md), and [Entity Command Surface](entity-command-surface.md) first. ADR-0012 is the key architectural decision behind the current OOD model.

Temporary working specs are allowed while a refactor is in flight. For Agent execution structured interaction, use [Agent Execution Structured Interaction Spec](agent-execution-structured-interaction-spec.md) as the current implementation reference until its durable decisions are folded back into `CONTEXT.md` and accepted ADRs. For the daemon-owned MCP signal transport, use [Mission MCP Server Spec](mission-mcp-server-spec.md) as the current realization blueprint for ADR-0024.

For the current journal-ledger refactor, use [Agent Execution Journal Ledger Spec](agent-execution-journal-ledger-spec.md) as the temporary implementation reference for the typed journal family split and replay contract tightening.

For the next AgentExecution persistence step, read [Agent Execution Interaction Journal PRD](agent-execution-interaction-journal-prd.md) and [Agent Execution Interaction Journal Spec](agent-execution-interaction-journal-spec.md). These documents define the canonical semantic interaction journal that separates AgentExecution replay truth from terminal recordings and Mission workflow events.
