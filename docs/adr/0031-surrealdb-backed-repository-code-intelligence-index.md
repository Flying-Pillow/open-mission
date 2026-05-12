---
layout: default
title: SurrealDB Backed Repository Code Intelligence Index
parent: Architecture Decisions
nav_order: 31
status: accepted
date: 2026-05-12
decision_area: repository-code-intelligence
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission will build a native Repository code intelligence index backed by the daemon's SurrealDB direction instead of depending on GitNexus' `.gitnexus/` storage model as the Mission integration path.

The index is a daemon-owned, rebuildable read model over a Repository root or Mission worktree root. It records source files, symbols, imports, calls, routes, tools, execution flows, clusters, and typed code relationships so Agent execution semantic operations can answer codebase questions through `mission-mcp`.

## Context

Mission wants the Agent to call the Mission MCP server and receive the context needed for a Mission run rather than searching through the repository manually. GitNexus demonstrates a valuable capability set: graph-backed search, symbol context, impact analysis, route maps, tool maps, shape checks, and diff impact through MCP.

However, GitNexus' architecture is external to Mission. It stores indexes under `.gitnexus/`, registers repositories globally under `~/.gitnexus/`, uses LadybugDB, and exposes a separate MCP server. Mission already has different architectural commitments: Repository control state under `.mission/`, Mission worktrees, daemon-owned AgentExecution scope, AgentExecution journals, Entity contracts, and a planned embedded SurrealDB datastore.

Mission should reuse the product lesson and high-level graph ideas from GitNexus, but not import its storage authority, registry model, server boundary, or source code as Mission truth.

## Decision

Mission will introduce a Repository code intelligence index as a derived daemon read model.

The source of truth remains the Repository root, Mission worktree root, Git state, Mission dossier, Entity storage records, and workflow artifacts. The code intelligence index is rebuildable. It is not canonical Mission state, not an Entity storage record set, not a Mission dossier replacement, and not a second workflow authority.

The first storage implementation should use SurrealDB through a Mission-owned code graph store. The schema should be declared from Mission-owned Zod v4 schemas with `@flying-pillow/zod-surreal` metadata where practical. Physical SurrealDB tables and relation tables are adapter details behind the code graph store contract.

The index may initially live in the daemon in-memory datastore as a working read model. Durable recovery can rebuild it from repository files and Git state. Persisted index snapshots, SurrealKV, RocksDB, or exported graph files are optional optimizations and must not replace repository files or Mission dossiers as durable truth.

Mission will not vendor GitNexus code for the baseline implementation. GitNexus is a reference system for capabilities and design comparison. Direct code reuse, derived implementation, or bundled distribution would need a separate license review and decision because GitNexus uses PolyForm Noncommercial licensing.

## Model

The code intelligence index should model stable Mission-native concepts rather than copying database table names as domain language.

Baseline read model concepts:

- Code file: a source or documentation file included in the index.
- Code symbol: a function, method, class, interface, type, variable, route handler, MCP/RPC tool handler, section, or other named code element.
- Code relation: a typed relationship between files, symbols, routes, tools, processes, or clusters.
- Code route: an HTTP/API route or framework endpoint with handler and response-shape metadata when detected.
- Code tool: an MCP/RPC/tool definition and its handler when detected.
- Code process: a heuristic execution flow through symbols, routes, or tools.
- Code cluster: a heuristic functional grouping of related code.
- Code index snapshot: metadata about one index build, including root, commit or worktree fingerprint, indexed time, file counts, symbol counts, relation counts, and staleness signals.

Relationship types should begin with a small GitNexus-inspired set:

- `CONTAINS`
- `DEFINES`
- `IMPORTS`
- `CALLS`
- `EXTENDS`
- `IMPLEMENTS`
- `HAS_METHOD`
- `HAS_PROPERTY`
- `ACCESSES`
- `HANDLES_ROUTE`
- `FETCHES`
- `HANDLES_TOOL`
- `ENTRY_POINT_OF`
- `STEP_IN_PROCESS`
- `MEMBER_OF`

Mission may adjust names during implementation, but relationship vocabulary must be centralized in one schema registry and must not be re-declared in MCP tools, Airport UI, tests, and storage adapters independently.

## Ownership

Repository or a Repository-owned daemon service owns index lifecycle for Repository roots. Mission or a Mission-worktree-aware daemon collaborator owns index lifecycle for Mission worktree roots. The owner must be explicit in implementation; generic indexing helpers must not decide repository or worktree authority.

The Repository code intelligence service owns:

- root eligibility and scope checks
- index staleness evaluation
- index build orchestration
- query use cases such as search, symbol context, impact, and route/tool maps
- mapping query results into Agent execution semantic operation results

The Repository code graph store owns:

- SurrealDB provisioning
- physical schema mapping
- graph writes during indexing
- read-only graph queries
- parameter binding and query safety
- index snapshot reads

The parser/indexer owns source scanning, language extraction, symbol registration, relation emission, and deterministic index output. Parser output is input to the graph store, not domain truth by itself.

AgentExecutionSemanticOperations owns the Agent-facing operation descriptors and runtime fact recording. It delegates code intelligence reads to the Repository code intelligence service.

Airport may display code intelligence results later, but it does not own the index, query semantics, or operation schemas.

## Scope And Staleness

Indexes are scoped to a concrete root:

- Repository root for control-mode or repository-scoped Agent executions.
- Mission worktree root for Mission, Task, and worktree-backed Artifact Agent executions.

Mission must distinguish these roots because a Mission worktree can diverge from the main Repository root during active work.

Every index snapshot records enough root and Git/file fingerprint data for the daemon to report staleness. A stale index may still be usable for low-risk context queries if the operation result clearly reports staleness, but high-risk operations such as impact analysis before code changes should prefer fresh indexes or return an explicit stale result.

Index rebuilds are daemon-owned background or command-triggered work. They must not silently block unrelated Entity commands for long-running parse jobs unless an explicit workflow gate requires a fresh code index.

## Query Surface

The first Agent-facing query surface is through Agent execution semantic operations over `mission-mcp`, not through a generic Airport route or public MCP server.

Baseline operations:

- `code_search`: find files, symbols, routes, tools, processes, or clusters related to a concept.
- `symbol_context`: show callers, callees, imports, owners, processes, and related files for one symbol.
- `impact_analysis`: traverse upstream or downstream relationships for a symbol, file, route, or tool.
- `changed_code_impact`: map Git diff hunks to indexed symbols and affected processes.
- `route_impact`: show route handler, consumers, response keys, middleware, and related processes.
- `tool_context`: show MCP/RPC tool definitions, handlers, and callers when detected.

Raw SurrealQL is not part of the baseline. If a future operator/debug mode needs raw graph queries, it should be a daemon diagnostics capability with explicit authorization and schema documentation.

## Consequences

- Mission gains native GitNexus-like code intelligence while keeping Mission daemon authority and spec-driven workflow integration.
- Agents can ask Mission for relevant code context in the same execution-scoped MCP channel they use for structured signals.
- SurrealDB becomes useful for graph traversal, full-text search, relation queries, and possible vector search without becoming a shared raw database client.
- The index can be rebuilt, pruned, or optimized without Mission runtime migrations because it is derived read material.
- Implementation must include deterministic fixture tests for parser output, graph loading, query behavior, staleness, scope enforcement, and MCP semantic operation results.

## Implementation Rules

- Do not make `.gitnexus/` or `~/.gitnexus/registry.json` part of Mission's canonical architecture.
- Do not copy GitNexus source code into Mission without a separate license decision.
- Do not let arbitrary daemon modules write code graph records directly; graph writes go through the Repository code graph store during index builds.
- Do not expose a raw SurrealDB client as the code intelligence API.
- Do not persist code graph records as Entity storage records unless a future ADR promotes them into Entities.
- Do not treat code clusters or code processes as workflow truth; they are heuristic read-model material.
- Do keep relationship and node vocabularies centralized in schema-backed registries.
- Do record index staleness in every operation result where stale data could change the answer.
- Do use Mission worktree roots, not only Repository roots, for active Mission work.