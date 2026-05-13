---
layout: default
title: Code Intelligence PRD
parent: Architecture
nav_order: 8.95
description: Temporary product requirements for Mission-native code intelligence exposed through open-mission-mcp semantic operations.
---

## Purpose

Mission should give a running Agent execution structured codebase awareness through `open-mission-mcp` so the Agent can do spec-driven work without repeatedly searching the repository by hand.

The product requirement is:

```text
Agent asks Mission for code context
Mission answers from a scoped daemon-owned code graph
Agent work stays tied to Mission scope, runtime facts, and verification
```

This is the Mission-native version of the demand demonstrated by GitNexus: code intelligence belongs next to the Agent workflow, not as a separate manual research loop.

## Problem

Agents currently spend a large part of each Mission reconstructing repository context:

- searching for symbols and routes with broad text search
- reading many files to understand call relationships
- guessing blast radius before edits
- asking the terminal for Git diffs and then manually mapping hunks to code paths
- losing auditability because the daemon sees scattered file reads rather than meaningful semantic context requests

This produces slow Missions, repeated work, inconsistent grounding, and weak verification loops. It also hides a major product opportunity: Mission can combine spec-driven workflow state with code graph context in a way external code-index MCP servers cannot.

## Goal

Build native Code intelligence that lets a running Agent execution ask scoped questions about the Code root resolved from its scope through `open-mission-mcp`. A Code root may be a Repository root or a Mission worktree root, but indexing and graph querying do not branch into separate Repository or Mission models.

The first user-visible outcome is an Agent that can call semantic operations such as:

- `code_search`
- `symbol_context`
- `impact_analysis`
- `changed_code_impact`
- `route_impact`
- `tool_context`

The Agent receives structured answers with file paths, line ranges, confidence, staleness, and follow-up affordances. The daemon records bounded runtime facts for audit and future replay.

## Users

Primary users:

- maintainers running Mission Agents on implementation tasks
- reviewers using Mission to verify blast radius and completion claims
- Agents performing Repository, Mission, Task, and Artifact scoped work

Secondary users:

- Open Mission web operators who later inspect code graph context, impact paths, and indexed root freshness visually
- CLI operators who need diagnostics about index freshness
- future workflow gates that may require code impact evidence before stage completion

## Product Principles

### Spec-Driven Context

The code graph helps an Agent execute a Mission spec. It should be connected to Mission scope, task instructions, artifacts, and verification evidence.

### Scoped By Execution

An Agent receives only the semantic operations allowed by its AgentExecution scope. A task-scoped Agent working in a Mission worktree should not accidentally query unrelated repositories or host-level files.

### Root-Agnostic Indexing

Repository roots and Mission worktree roots are both Code roots after scope resolution. The code graph must not use Repository or Mission prefixes in table names, schema names, service names, indexer behavior, or semantic operation names.

### Rebuildable Read Model

The index is derived from source files and Git state. It can be stale, rebuilt, pruned, or discarded without corrupting Mission truth.

### Agent-First Capability

The first-class consumer is a running Agent execution inside a controlled Mission workflow. Open Mission diagnostics and visual graph exploration may become useful later, but the first milestone is bounded semantic context for the Agent, not a standalone repository intelligence product.

### Read-Only Open Mission Visualization

Open Mission web should eventually provide a visual representation of the active Code graph for operator understanding, review, and debugging. That visualization is a read-only surface over daemon-owned code intelligence results and must not define graph semantics, mutate index records, or become the primary query API.

### Small Derived Record Set

Code graph records are derived read material, not Mission Entities. Phase one should keep the record set narrow and avoid introducing behavioral domain entities for every file, symbol, relation, route, tool, process, cluster, search result, or impact result.

### Useful Before Perfect

Start with a universal text-file scanner so any Code root gets file-level index coverage, then add high-signal parser-backed providers by language. TypeScript/JavaScript support for Mission itself is the first deep extraction provider. Regex-only code extraction is not acceptable for the durable indexer path except as a narrow fallback or test fixture. The operation results must report provider capability, confidence, and staleness rather than pretending the graph is omniscient.

### No Hidden Mutation

The baseline tools are read-only. They may guide edits, but they do not edit files, rename symbols, change workflow state, or mark tasks complete.

## Requirements

### Indexing

- Index one Code root into a daemon-owned code graph.
- Resolve Repository roots and Mission worktree roots into the same Code root model before indexing.
- Start Code root indexing from Repository preparation, repository hydration, or Mission worktree materialization when valid control state exists; daemon startup may create runtime services but must not eagerly index every known Repository.
- Let semantic operation calls invoke `ensureIndex` so an Agent can get fresh context even when background indexing has not completed yet.
- Define code graph tables, relation tables, fields, analyzers, and indexes as Mission-owned Zod schemas annotated with `@flying-pillow/zod-surreal` metadata.
- Generate deterministic SurrealQL schema/provisioning statements from the zod-surreal model snapshot; do not make hand-written SurQL DDL the source of truth.
- Track code index snapshots, files, symbols, and relations in phase one.
- Index eligible text files even when no semantic extraction provider exists for their language; unknown or unsupported languages still produce Code file records with lower capability.
- Keep language support explicit through a Mission-owned provider registry. Adding semantic depth for a language means adding or enabling a provider rather than expanding ad hoc indexer branches.
- Defer routes, tools, processes, clusters, test context, and framework-specific intelligence until the structural index and first semantic operations are proven.
- Record root identity, commit or worktree fingerprint, indexed time, counts, and staleness.
- Honor repository ignore rules for generated, dependency, and build-output files, always exclude Mission runtime state under `.mission/`, and skip binary, oversized, and sensitive files.
- Support fresh rebuild for the current Mission worktree before high-risk impact analysis.

### Semantic Operations

- Expose read-only code intelligence operations through `open-mission-mcp` for registered Agent executions.
- Validate every operation input with Zod schemas.
- Resolve accessible root from AgentExecution scope.
- Return structured results rather than prose-only text.
- Include staleness and confidence in results where relevant.
- Record bounded runtime facts in the AgentExecution interaction journal.

### Search And Context

- `code_search` returns ranked files, symbols, routes, tools, processes, or clusters related to a query.
- `symbol_context` returns incoming/outgoing relations, owner file, line range, related process participation, and disambiguation choices.
- Results should guide the Agent toward targeted reads rather than returning entire source trees.

### Impact Analysis

- `impact_analysis` supports upstream and downstream traversal.
- Traversal depth, relation type filters, confidence threshold, and test inclusion are bounded inputs.
- Results group by depth and identify affected processes, routes, tools, and files when known.
- Stale indexes must be explicit in the result.

### Change Analysis

- `changed_code_impact` maps current Git diff hunks to indexed files/symbols.
- It reports changed symbols, affected processes, and risk summary.
- It supports unstaged, staged, all, and compare scopes after the Git adapter contract is wired.

### Route And Tool Maps

- `route_impact` reports route handler, consumers, response keys, error keys, middleware, and related processes when detected.
- `tool_context` reports MCP/RPC tool definitions, handler files, descriptions, and callers when detected.

### Open Mission Web Visualization

- Provide a later Open Mission web view for code graph exploration once the Agent-facing semantic operations and structural graph are stable.
- Render active Code root snapshots, files, symbols, relations, impact paths, and freshness/staleness status from daemon-owned read APIs.
- Keep visual graph interactions read-only in the baseline: select, filter, inspect, trace, and open related files or semantic operation results.
- Do not let Open Mission web create graph records, change index lifecycle, run raw SurrealQL, or redefine code intelligence relationship semantics.

## Non-Goals

- Do not vendor GitNexus or adopt its `.gitnexus/` registry model.
- Do not expose raw SurrealQL as an Agent-facing baseline tool.
- Do not build a public remote code search service.
- Do not make code graph records canonical Entity storage records.
- Do not block all Mission work on a perfect or complete code index.
- Do not implement graph-assisted file mutation or rename in the baseline.
- Do not make Open Mission the first owner of code intelligence behavior.
- Do not make the first milestone an interactive graph visualization, repository chat UI, general code browser, or standalone GitNexus-like product inside Mission.

## Acceptance Criteria

- A task-scoped Agent execution can call `code_search` through `open-mission-mcp` and receive scoped results from the Code root resolved from its AgentExecution scope.
- A task-scoped Agent execution can call `symbol_context` for a known symbol and receive callers/callees with file locations.
- A task-scoped Agent execution can call `impact_analysis` and receive depth-grouped affected symbols and processes.
- Every accepted semantic operation records an AgentExecution runtime fact.
- Operation calls reject unauthorized tokens, unknown executions, invalid inputs, unsupported scopes, path traversal, and roots outside scope.
- Index snapshots report freshness against the scoped root.
- Agents only read active index snapshots; rebuilds write candidate snapshots that become active only after successful validation.
- Generated SurrealQL DDL matches the Mission-owned zod-surreal code graph schema snapshot.
- The MCP stdio bridge supports semantic operations that are not Agent signals.
- Deterministic tests cover graph schema compilation, fixture indexing, semantic operation dispatch, scope enforcement, stale index reporting, and runtime fact recording.

## Phase-One Product Cut

1. Fix `open-mission mcp connect` so it can proxy semantic operations without wrapping them as Agent signals.
2. Promote `read_artifact` into the same descriptor model that future semantic operations use.
3. Build the structural code graph for eligible text files in any Code root, with TypeScript/JavaScript as the first parser-backed symbol and relation provider: `CodeIndexSnapshot`, `CodeFile`, `CodeSymbol`, and `CodeRelation`.
4. Add daemon-owned `ensureIndex` lifecycle with Code root snapshots.
5. Add zod-surreal model definitions and generated SurQL provisioning for the code graph store.
6. Implement `code_search` and `symbol_context` first.
7. Add `impact_analysis` after one real graph traversal can be tested end-to-end.
8. Add `changed_code_impact` after worktree-aware diff mapping is reliable.
9. Add `route_impact`, `tool_context`, process context, and test context as framework-specific intelligence after the structural graph is stable.
10. Add a read-only Open Mission web visual graph after Agent-facing operations and graph query semantics are stable.
11. Keep Open Mission UI out of the first slice except for diagnostics if needed.

## Open Product Questions

- Should repository-level Agents get Code root indexes by default, or should an operator explicitly enable code intelligence per registered repository root?
- Should high-risk workflow gates require a fresh `changed_code_impact` result before verification can pass?
- How much source content should operation responses include by default before requiring targeted `read_artifact` calls?
- Should embeddings be local-only in phase one, or deferred until deterministic graph queries are stable?
