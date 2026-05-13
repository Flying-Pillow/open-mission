---
layout: default
title: Architecture Decisions
nav_order: 6
has_children: true
description: Accepted architectural decisions that constrain Mission changes.
---

ADRs are the durable architecture register for Mission.

Read them when a change touches ownership, naming, state, runtime behavior, repository initialization, Airport surfaces, compatibility policy, or documentation authority. Each ADR carries frontmatter so the docs site and architecture skills can treat decisions as structured records.

`CONTEXT.md` defines the canonical language and relationships. ADRs define the durable rules and trade-offs behind that language. The old specifications corpus has been removed from the active docs tree after its relevant architecture was registered here.

## Register Map

### Architecture Authority

- [Clean-Sheet Implementation Discipline](0000-clean-sheet-implementation-discipline.md)
- [Architecture Decision Records As System Register](0019-architecture-decision-records-as-system-register.md)

### Airport Application

- [Airport Application Host Boundaries](0020-airport-application-host-boundaries.md)

### Entity Model And Contracts

- [Canonical Entity Identity And Metadata](0001-canonical-entity-identity-and-metadata.md)
- [Retire Projection As Canonical Vocabulary](0002-retire-projection-as-canonical-vocabulary.md)
- [Authoritative Thick Entity Classes](0012-authoritative-thick-entity-classes.md)
- [Entity Schema And Type Naming Convention](0013-entity-schema-and-type-naming-convention.md)
- [Entity Commands As Canonical Operator Surface](0015-entity-commands-as-canonical-operator-surface.md)

### Mission Runtime And State

- [Mission Runtime Data Migrations](0005-mission-runtime-data-migrations.md)
- [Daemon-Owned State Store With Surface Replication Path](0009-daemon-owned-state-store-with-surface-replication-path.md)
- [State Store Transactions As Canonical Write Interface](0010-state-store-transactions-as-canonical-write-interface.md)
- [Mission Workflow Definition Seam](0014-mission-workflow-definition-seam.md)
- [Repository Initialization Before Mission Start](0016-repository-setup-before-mission-start.md)
- [Repository Workflow Settings Control Contract](0021-repository-workflow-settings-control-contract.md)
- [Daemon-Owned Runtime Supervision Graph](0028-daemon-owned-runtime-supervision-graph.md)
- [Daemon-Owned System Status Snapshot](0029-daemon-owned-system-status-snapshot.md)
- [SurrealDB Backed Code Intelligence Index](0031-surrealdb-backed-repository-code-intelligence-index.md)

### Agent Execution

- [Explicit Agent Execution Context](0003-explicit-agent-execution-context.md)
- [Runtime-Defined Agent Execution Messages](0004-runtime-defined-agent-execution-messages.md)
- [Agent Execution Logs As Daemon Audit Material](0011-agent-execution-logs-as-daemon-audit-material.md)
- [Prompt-Scoped Agent Execution Signals](0017-prompt-scoped-agent-execution-signals.md)
- [Agent Execution And Agent Adapter Vocabulary](0018-agent-execution-and-agent-adapter-vocabulary.md)
- [Agent Execution Structured Interaction Vocabulary](0022-agent-execution-structured-interaction-vocabulary.md)
- [Mission MCP Server Agent Signal Transport](0024-mission-mcp-server-agent-signal-transport.md)
- [Agent Execution Interaction Journal](0025-agent-execution-interaction-journal.md)
- [Typed Agent Execution Journal Ledger](0027-typed-agent-execution-journal-ledger.md)
- [Mission MCP Agent Execution Semantic Operations](0030-mission-mcp-agent-execution-semantic-operations.md)

### Mission Control And Surfaces

- [Surface-Controlled Mission Control Selection](0007-surface-controlled-daemon-resolved-selection.md)
- [Local Surface Preferences](0008-local-surface-preferences.md)
- [Mission Control Task List From Entity State](0023-mission-control-task-list-from-entity-state.md)
