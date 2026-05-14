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

ADR numbers use a decimal registry key. The four-digit prefix identifies the architecture family; the decimal suffix orders focused subdecisions inside that family. Families are structural, not chronological: move a decision when its owner, authority level, or subject boundary changes. Use gaps in suffixes only when inserting a decision between existing decisions would clarify the registry.

The register is ordered from system-wide authority to domain contracts, repository control, Mission runtime, daemon services, operator surfaces, and AgentExecution behavior. That order mirrors Mission's ownership model: durable authority first, runtime coordination next, presentation and adapter-specific interaction after the owning model is clear.

### 0000 Architecture Governance

System-wide rules for how Mission changes are allowed to evolve. These ADRs constrain the register itself and the discipline used when replacing architecture.

- [Clean-Sheet Implementation Discipline](0000.01-clean-sheet-implementation-discipline.md)
- [Architecture Decision Records As System Register](0000.02-architecture-decision-records-as-system-register.md)

### 0001 Entity Model And Contract Architecture

Canonical Entity identity, schema roles, class authority, naming, and Entity command contracts. Put decisions here when they define shared domain object structure or cross-boundary Entity contracts.

- [Canonical Entity Identity And Metadata](0001.01-canonical-entity-identity-and-metadata.md)
- [Entity Class Schema And Contract Architecture](0001.02-entity-class-schema-and-contract-architecture.md)
- [Authoritative Thick Entity Classes](0001.03-authoritative-thick-entity-classes.md)
- [Entity Schema And Type Naming Convention](0001.04-entity-schema-and-type-naming-convention.md)
- [Entity Commands As Canonical Operator Surface](0001.05-entity-commands-as-canonical-operator-surface.md)
- [Artifacts Are File-Rooted Entities](0001.06-artifacts-are-file-rooted-entities.md)

### 0002 Repository Control And Setup

Repository-scoped control state, initialization, and repository workflow defaults. Put decisions here when the Repository is the owner before any Mission instance starts.

- [Repository Initialization Before Mission Start](0002.01-repository-setup-before-mission-start.md)
- [Repository Workflow Settings Control Contract](0002.02-repository-workflow-settings-control-contract.md)

### 0003 Mission Runtime And Workflow Law

Mission runtime data, Mission dossier-backed persistence, State store write rules, and repository-owned workflow law applied by a Running Mission instance. Put decisions here when they govern Mission execution state rather than Repository setup or daemon-wide service supervision.

- [Mission Runtime Data Migrations](0003.01-mission-runtime-data-migrations.md)
- [Daemon-Owned State Store With Surface Replication Path](0003.02-daemon-owned-state-store-with-surface-replication-path.md)
- [State Store Transactions As Canonical Write Interface](0003.03-state-store-transactions-as-canonical-write-interface.md)
- [Mission Workflow Definition Seam](0003.04-mission-workflow-definition-seam.md)

### 0004 Daemon Runtime And System Services

Daemon-owned live runtime supervision, system snapshots, and derived services that support Mission or AgentExecution without becoming their domain truth. Put decisions here when the daemon service is the owner and the model is reusable across repository, Mission, or AgentExecution scopes.

- [Daemon-Owned Runtime Supervision Graph](0004.01-daemon-owned-runtime-supervision-graph.md)
- [Daemon-Owned System Status Snapshot](0004.02-daemon-owned-system-status-snapshot.md)
- [SurrealDB Backed Code Intelligence Index](0004.03-surrealdb-backed-repository-code-intelligence-index.md)

### 0005 Open Mission App And Operator Surfaces

Open Mission app boundaries, host responsibilities, surface-local preferences, and operator-facing read or command surfaces. Put decisions here when a surface reflects or submits daemon-owned truth without owning the underlying domain law.

- [Open Mission App Host Boundaries](0005.01-open-mission-app-host-boundaries.md)
- [Surface-Controlled Mission Control Selection](0005.02-surface-controlled-mission-control-selection.md)
- [Local Surface Preferences](0005.03-local-surface-preferences.md)
- [Mission Control Task List From Entity State](0005.04-mission-control-task-list-from-entity-state.md)

### 0006 AgentExecution Model, Interaction, And Adapter Surface

AgentExecution identity, context, structured interaction, transport, persistence, semantic operations, adapter capabilities, and Agent-facing command surfaces. Put decisions here when AgentExecution is the owner or the decision defines how adapters and tools interact with AgentExecution.

- [Agent Execution And Agent Adapter Vocabulary](0006.01-agent-execution-and-agent-adapter-vocabulary.md)
- [Explicit Agent Execution Context](0006.02-explicit-agent-execution-context.md)
- [Descriptor-Defined Agent Execution Messages](0006.03-descriptor-defined-agent-execution-messages.md)
- [Prompt-Scoped Agent Execution Signals](0006.04-prompt-scoped-agent-execution-signals.md)
- [Agent Execution Structured Interaction Vocabulary](0006.05-agent-execution-structured-interaction-vocabulary.md)
- [Mission MCP Server Agent Signal Transport](0006.06-mission-mcp-server-agent-signal-transport.md)
- [Agent Execution Logs As Daemon Audit Material](0006.07-agent-execution-logs-as-daemon-audit-material.md)
- [Agent Execution Interaction Journal](0006.08-agent-execution-interaction-journal.md)
- [Mission MCP Agent Execution Semantic Operations](0006.09-mission-mcp-agent-execution-semantic-operations.md)
- [Structured-First Agent Interaction With Terminal Capability](0006.10-structured-first-agent-interaction-with-terminal-capability.md)
- [Runtime-Owned Agent Model Selection](0006.11-runtime-owned-agent-model-selection.md)
- [Agent Connection Tests As Agent Entity Commands](0006.12-agent-connection-tests-as-agent-entity-commands.md)

### Proposed Decisions

Proposed decisions keep their structural family number, but stay outside the accepted family list until accepted.

- [Typed Agent Execution Journal Ledger](0006.13-typed-agent-execution-journal-ledger.md)
