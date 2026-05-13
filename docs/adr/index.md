---
layout: default
title: Architecture Decisions
nav_order: 6
has_children: true
description: Architecture decisions that constrain Mission changes.
---

ADRs are the durable architecture register for Mission.

Read them when a change touches ownership, naming, state, runtime behavior, repository initialization, Open Mission surfaces, compatibility policy, or documentation authority. Each ADR carries frontmatter so the docs site and architecture skills can treat decisions as structured records.

`CONTEXT.md` defines the canonical language and relationships. ADRs define the durable rules and trade-offs behind that language. The old specifications corpus has been removed from the active docs tree after its relevant architecture was registered here.

## Register Map

Accepted ADRs are binding architecture law. Proposed ADRs are active design candidates and must not be treated as settled rules until their status changes.

ADR numbers use a decimal registry key. The four-digit prefix identifies the architecture family; the decimal suffix orders focused subdecisions inside that family. Use gaps in suffixes only when inserting a decision between existing decisions would clarify the registry.

### 0000 Architecture Authority

- [Clean-Sheet Implementation Discipline](0000.01-clean-sheet-implementation-discipline.md)
- [Architecture Decision Records As System Register](0000.02-architecture-decision-records-as-system-register.md)

### 0001 Entity Model And Contracts

- [Canonical Entity Identity And Metadata](0001.01-canonical-entity-identity-and-metadata.md)
- [Entity Class Schema And Contract Architecture](0001.02-entity-class-schema-and-contract-architecture.md)
- [Authoritative Thick Entity Classes](0001.03-authoritative-thick-entity-classes.md)
- [Entity Schema And Type Naming Convention](0001.04-entity-schema-and-type-naming-convention.md)
- [Entity Commands As Canonical Operator Surface](0001.05-entity-commands-as-canonical-operator-surface.md)
- [Artifacts Are File-Rooted Entities](0001.06-artifacts-are-file-rooted-entities.md)

### 0002 Mission Runtime, Repository State, And Daemon Runtime

- [Mission Runtime Data Migrations](0002.01-mission-runtime-data-migrations.md)
- [Daemon-Owned State Store With Surface Replication Path](0002.02-daemon-owned-state-store-with-surface-replication-path.md)
- [State Store Transactions As Canonical Write Interface](0002.03-state-store-transactions-as-canonical-write-interface.md)
- [Mission Workflow Definition Seam](0002.04-mission-workflow-definition-seam.md)
- [Repository Initialization Before Mission Start](0002.05-repository-setup-before-mission-start.md)
- [Repository Workflow Settings Control Contract](0002.06-repository-workflow-settings-control-contract.md)
- [Daemon-Owned Runtime Supervision Graph](0002.07-daemon-owned-runtime-supervision-graph.md)
- [Daemon-Owned System Status Snapshot](0002.08-daemon-owned-system-status-snapshot.md)
- [SurrealDB Backed Code Intelligence Index](0002.09-surrealdb-backed-repository-code-intelligence-index.md)

### 0003 Open Mission App And Surfaces

- [Open Mission App Host Boundaries](0003.01-open-mission-app-host-boundaries.md)
- [Surface-Controlled Mission Control Selection](0003.02-surface-controlled-mission-control-selection.md)
- [Local Surface Preferences](0003.03-local-surface-preferences.md)
- [Mission Control Task List From Entity State](0003.04-mission-control-task-list-from-entity-state.md)

### 0004 Agent And AgentExecution

- [Agent Execution And Agent Adapter Vocabulary](0004.01-agent-execution-and-agent-adapter-vocabulary.md)
- [Explicit Agent Execution Context](0004.02-explicit-agent-execution-context.md)
- [Descriptor-Defined Agent Execution Messages](0004.03-descriptor-defined-agent-execution-messages.md)
- [Prompt-Scoped Agent Execution Signals](0004.04-prompt-scoped-agent-execution-signals.md)
- [Agent Execution Structured Interaction Vocabulary](0004.05-agent-execution-structured-interaction-vocabulary.md)
- [Mission MCP Server Agent Signal Transport](0004.06-mission-mcp-server-agent-signal-transport.md)
- [Agent Execution Logs As Daemon Audit Material](0004.07-agent-execution-logs-as-daemon-audit-material.md)
- [Agent Execution Interaction Journal](0004.08-agent-execution-interaction-journal.md)
- [Mission MCP Agent Execution Semantic Operations](0004.09-mission-mcp-agent-execution-semantic-operations.md)
- [Structured-First Agent Interaction With Terminal Capability](0004.10-structured-first-agent-interaction-with-terminal-capability.md)
- [Runtime-Owned Agent Model Selection](0004.11-runtime-owned-agent-model-selection.md)
- [Agent Connection Tests As Agent Entity Commands](0004.12-agent-connection-tests-as-agent-entity-commands.md)

### Proposed Decisions

- [Typed Agent Execution Journal Ledger](0004.13-typed-agent-execution-journal-ledger.md)
