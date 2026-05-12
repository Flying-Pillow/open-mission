---
layout: default
title: Repository Code Intelligence PRD
parent: Architecture
nav_order: 8.95
description: Temporary product requirements for Mission-native repository code intelligence exposed through mission-mcp semantic operations.
---

## Purpose

Mission should give a running Agent execution structured codebase awareness through `mission-mcp` so the Agent can do spec-driven work without repeatedly searching the repository by hand.

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

Build native Repository code intelligence that lets a running Agent execution ask scoped questions about the Repository root or Mission worktree root through `mission-mcp`.

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

- Airport surfaces that may later display code intelligence panels
- CLI operators who need diagnostics about index freshness
- future workflow gates that may require code impact evidence before stage completion

## Product Principles

### Spec-Driven Context

The code graph helps an Agent execute a Mission spec. It should be connected to Mission scope, task instructions, artifacts, and verification evidence.

### Scoped By Execution

An Agent receives only the semantic operations allowed by its AgentExecution scope. A task-scoped Agent working in a Mission worktree should not accidentally query unrelated repositories or host-level files.

### Rebuildable Read Model

The index is derived from source files and Git state. It can be stale, rebuilt, pruned, or discarded without corrupting Mission truth.

### Useful Before Perfect

Start with high-signal TypeScript/JavaScript support for Mission itself, then expand language coverage. The operation results must report confidence and staleness rather than pretending the graph is omniscient.

### No Hidden Mutation

The baseline tools are read-only. They may guide edits, but they do not edit files, rename symbols, change workflow state, or mark tasks complete.

## Requirements

### Indexing

- Index a Repository root or Mission worktree root into a daemon-owned code graph.
- Track code files, symbols, relations, routes, tools, processes, clusters, and index snapshot metadata.
- Record root identity, commit or worktree fingerprint, indexed time, counts, and staleness.
- Exclude obvious generated, binary, dependency, build-output, oversized, and sensitive files.
- Support fresh rebuild for the current Mission worktree before high-risk impact analysis.

### Semantic Operations

- Expose read-only code intelligence operations through `mission-mcp` for registered Agent executions.
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

## Non-Goals

- Do not vendor GitNexus or adopt its `.gitnexus/` registry model.
- Do not expose raw SurrealQL as an Agent-facing baseline tool.
- Do not build a public remote code search service.
- Do not make code graph records canonical Entity storage records.
- Do not block all Mission work on a perfect or complete code index.
- Do not implement graph-assisted file mutation or rename in the baseline.
- Do not make Airport the first owner of code intelligence behavior.

## Acceptance Criteria

- A task-scoped Agent execution can call `code_search` through `mission-mcp` and receive scoped results from the Mission worktree root.
- A task-scoped Agent execution can call `symbol_context` for a known symbol and receive callers/callees with file locations.
- A task-scoped Agent execution can call `impact_analysis` and receive depth-grouped affected symbols and processes.
- Every accepted semantic operation records an AgentExecution runtime fact.
- Operation calls reject unauthorized tokens, unknown executions, invalid inputs, unsupported scopes, path traversal, and roots outside scope.
- Index snapshots report freshness against the scoped root.
- The MCP stdio bridge supports semantic operations that are not Agent signals.
- Deterministic tests cover graph schema compilation, fixture indexing, semantic operation dispatch, scope enforcement, stale index reporting, and runtime fact recording.

## Phase-One Product Cut

1. Fix `mission mcp connect` so it can proxy semantic operations without wrapping them as Agent signals.
2. Promote `read_artifact` into the same descriptor model that future semantic operations use.
3. Build a minimal TypeScript/JavaScript code graph for Mission's own codebase.
4. Implement `code_search`, `symbol_context`, and `impact_analysis` first.
5. Add `changed_code_impact`, `route_impact`, and `tool_context` after the graph and scope rules are stable.
6. Keep Airport UI out of the first slice except for diagnostics if needed.

## Open Product Questions

- Should repository-level Agents get Repository root indexes by default, or should an operator explicitly enable code intelligence per Repository?
- Should high-risk workflow gates require a fresh `changed_code_impact` result before verification can pass?
- How much source content should operation responses include by default before requiring targeted `read_artifact` calls?
- Should embeddings be local-only in phase one, or deferred until deterministic graph queries are stable?