---
layout: default
title: Repository Code Intelligence Spec
parent: Architecture
nav_order: 8.96
description: Temporary implementation spec for Mission-native repository code intelligence and semantic MCP operations.
---

## Scope

This spec realizes [Repository Code Intelligence PRD](repository-code-intelligence-prd.md), ADR-0030, and ADR-0031.

It defines the first Mission-native path for GitNexus-like code intelligence using Mission-owned scopes, SurrealDB-backed graph storage, and Agent execution semantic operations over `mission-mcp`.

This document is temporary. Durable vocabulary belongs in `CONTEXT.md`; durable decisions belong in ADRs. When implementation converges, fold stable details into permanent architecture docs and delete this working spec.

## Authoritative Inputs

- `CONTEXT.md`: canonical Mission language.
- ADR-0010: State store transactions are the canonical write interface for Mission state.
- ADR-0012: Entity classes own behavior.
- ADR-0015: Entity commands are the canonical operator surface.
- ADR-0024: `mission-mcp` is daemon-owned local MCP infrastructure.
- ADR-0025: AgentExecution interaction journals record semantic runtime truth.
- ADR-0030: `mission-mcp` exposes Agent execution semantic operations.
- ADR-0031: Repository code intelligence index is SurrealDB-backed derived read material.
- `@flying-pillow/zod-surreal`: Zod-first SurrealDB schema metadata and DDL primitives.

## Target Runtime Shape

```text
daemon startup
  -> MissionMcpServer
  -> AgentExecutionRegistry
  -> RepositoryCodeIntelligenceRegistry
  -> RepositoryCodeGraphStore provider

AgentExecutor.startExecution
  -> create AgentExecution protocol descriptor
  -> register mission-mcp access
  -> semantic operation catalog filters tools by AgentExecution scope
  -> adapter receives MCP config

Agent calls code_search
  -> mission-mcp authorizes AgentExecution token
  -> validates code_search input
  -> AgentExecutionRegistry resolves active execution
  -> AgentExecutor invokes AgentExecutionSemanticOperations
  -> semantic operation resolves Repository root or Mission worktree root from scope
  -> RepositoryCodeIntelligenceService ensures usable index snapshot
  -> RepositoryCodeGraphStore runs bounded query
  -> AgentExecution journal records code-search runtime fact
  -> structured result returns through MCP
```

## Ownership Map

### AgentExecutionSemanticOperations

Owns the Agent-facing semantic operation catalog.

Responsibilities:

- define operation descriptors
- define Zod input and result schemas
- validate operation availability by AgentExecution scope
- invoke operation handlers
- record AgentExecution runtime facts
- publish journal records for active executions

It must not parse source code, run raw SurrealQL inline, or decide repository/worktree index lifecycle directly.

### MissionMcpServer

Owns MCP transport ingress only.

Required change: semantic operation tool registration and stdio bridge support must carry descriptor-provided input schemas. The current bridge shape that assumes every tool maps to `AgentSignalPayloadSchema` must be split into:

```ts
type MissionMcpToolDescriptor =
  | MissionMcpSignalToolDescriptor
  | MissionMcpSemanticOperationToolDescriptor;
```

Signal tools keep the existing signal wrapping path. Semantic operation tools pass operation input directly with transport fields (`agentExecutionId`, token, optional `eventId`) added by the bridge.

### RepositoryCodeIntelligenceService

Owns use cases over code intelligence indexes.

Suggested methods:

```ts
type RepositoryCodeIntelligenceService = {
  ensureIndex(input: EnsureCodeIndexInput): Promise<CodeIndexSnapshot>;
  search(input: CodeSearchInput): Promise<CodeSearchResult>;
  readSymbolContext(input: SymbolContextInput): Promise<SymbolContextResult>;
  analyzeImpact(input: ImpactAnalysisInput): Promise<ImpactAnalysisResult>;
  analyzeChangedCode(input: ChangedCodeImpactInput): Promise<ChangedCodeImpactResult>;
  readRouteImpact(input: RouteImpactInput): Promise<RouteImpactResult>;
  readToolContext(input: ToolContextInput): Promise<ToolContextResult>;
};
```

It coordinates index freshness, root resolution, graph store reads, Git adapter reads, and result shaping. It does not own MCP transport or AgentExecution journaling.

### RepositoryCodeGraphStore

Owns physical graph persistence and safe graph queries.

Suggested methods:

```ts
type RepositoryCodeGraphStore = {
  provision(): Promise<void>;
  replaceIndex(input: ReplaceCodeIndexInput): Promise<CodeIndexSnapshot>;
  readSnapshot(input: ReadCodeIndexSnapshotInput): Promise<CodeIndexSnapshot | undefined>;
  search(input: StoreCodeSearchInput): Promise<StoreCodeSearchRow[]>;
  readSymbolContext(input: StoreSymbolContextInput): Promise<StoreSymbolContext>;
  traverseImpact(input: StoreImpactTraversalInput): Promise<StoreImpactTraversal>;
  readRouteImpact(input: StoreRouteImpactInput): Promise<StoreRouteImpact>;
  readToolContext(input: StoreToolContextInput): Promise<StoreToolContext>;
};
```

The store owns parameter binding, table naming, relation table traversal, query limits, and SurrealDB-specific behavior. No caller receives a raw SurrealDB client.

### RepositoryCodeIndexer

Owns source scanning and graph build output.

Responsibilities:

- discover indexable files
- apply ignore, generated, binary, oversized, and sensitivity filters
- parse language-specific syntax
- emit code files, symbols, relations, routes, tools, processes, and clusters
- produce deterministic output for fixture tests

Phase one should favor TypeScript/JavaScript support for Mission itself. Additional language providers can be added behind the same indexer contract.

### Repository And Mission Worktree Boundary

Repository root indexes and Mission worktree root indexes must be separate snapshots. A Mission task should query the Mission worktree root when one exists because the active work may differ from the main Repository root.

Root resolution rules belong to a small scope resolver used by semantic operations:

```ts
type CodeIntelligenceScopeRoot = {
  rootKind: 'repository-root' | 'mission-worktree-root';
  rootPath: string;
  repositoryRootPath?: string;
  missionId?: string;
  taskId?: string;
};
```

## Schema Model

Use Zod v4 schemas with zod-surreal metadata where the fields map to SurrealDB storage.

Recommended model names:

- `CodeIndexSnapshot`
- `CodeFile`
- `CodeSymbol`
- `CodeRelation`
- `CodeRoute`
- `CodeTool`
- `CodeProcess`
- `CodeCluster`

Do not prefix these with `Repository` unless the record truly cannot apply to a Mission worktree root. The index root provides repository/worktree scope.

### CodeIndexSnapshot

Fields:

- `id`
- `rootKind`
- `rootPath`
- `repositoryRootPath`
- `missionId`
- `taskId`
- `commitSha`
- `worktreeFingerprint`
- `indexedAt`
- `status`
- `fileCount`
- `symbolCount`
- `relationCount`
- `routeCount`
- `toolCount`
- `processCount`
- `clusterCount`
- `staleness`

### CodeFile

Fields:

- `id`
- `indexId`
- `path`
- `name`
- `extension`
- `language`
- `hash`
- `lineCount`
- `indexed`
- `skipReason`

### CodeSymbol

Fields:

- `id`
- `indexId`
- `kind`
- `name`
- `qualifiedName`
- `filePath`
- `startLine`
- `endLine`
- `exported`
- `signature`
- `description`

### CodeRelation

Use a SurrealDB relation table when zod-surreal relation support is ready for this model.

Fields:

- `id`
- `indexId`
- `type`
- `in`
- `out`
- `confidence`
- `reason`
- `step`
- `evidence`

### CodeRoute

Fields:

- `id`
- `indexId`
- `route`
- `method`
- `handlerSymbolId`
- `handlerFilePath`
- `responseKeys`
- `errorKeys`
- `middleware`

### CodeTool

Fields:

- `id`
- `indexId`
- `name`
- `handlerSymbolId`
- `handlerFilePath`
- `description`
- `inputSchemaSummary`

### CodeProcess And CodeCluster

These are heuristic. Store confidence and derivation metadata, and never treat them as Mission workflow truth.

## Semantic Operation Schemas

All operation schemas live with `AgentExecutionSemanticOperations` or operation-specific modules imported by it. Export TypeScript types with `z.infer` only.

### code_search

Input:

```ts
{
  query: string;
  limit?: number;
  includeKinds?: CodeSearchKind[];
  freshness?: 'allow-stale' | 'prefer-fresh' | 'require-fresh';
  eventId?: string;
}
```

Result includes snapshot metadata, staleness, ranked hits, and suggested follow-up operations.

### symbol_context

Input:

```ts
{
  symbol?: string;
  symbolId?: string;
  filePath?: string;
  includeProcesses?: boolean;
  eventId?: string;
}
```

Result includes disambiguation when needed. Do not silently pick among multiple same-name symbols without returning alternatives unless `symbolId` is provided.

### impact_analysis

Input:

```ts
{
  target?: string;
  targetId?: string;
  filePath?: string;
  direction: 'upstream' | 'downstream';
  maxDepth?: number;
  relationTypes?: CodeRelationType[];
  minConfidence?: number;
  includeTests?: boolean;
  freshness?: 'prefer-fresh' | 'require-fresh';
  eventId?: string;
}
```

Result groups affected nodes by depth and includes affected processes/routes/tools/clusters.

### changed_code_impact

Input:

```ts
{
  scope?: 'unstaged' | 'staged' | 'all' | 'compare';
  baseRef?: string;
  maxDepth?: number;
  eventId?: string;
}
```

Result maps diff hunks to symbols and then to impact results.

### route_impact

Input:

```ts
{
  route?: string;
  filePath?: string;
  eventId?: string;
}
```

Result includes handler, consumers, response keys, middleware, process links, and mismatch warnings when response shape support exists.

### tool_context

Input:

```ts
{
  tool?: string;
  eventId?: string;
}
```

Result includes detected tool definitions and handlers.

## Runtime Facts

Each accepted operation records a bounded runtime fact:

```ts
type CodeIntelligenceRuntimeFact = {
  factType:
    | 'code-search'
    | 'symbol-context-read'
    | 'impact-analysis-read'
    | 'changed-code-impact-read'
    | 'route-impact-read'
    | 'tool-context-read';
  operationName: string;
  indexId: string;
  rootKind: 'repository-root' | 'mission-worktree-root';
  rootPathHash: string;
  querySummary: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  stale: boolean;
};
```

Do not store full result payloads in runtime facts by default. Store enough to audit that the Agent used code intelligence and what target/query it used.

## Index Lifecycle

### Ensure Index

`ensureIndex` decides whether an index exists and whether its freshness is acceptable for the requested operation.

Freshness policy:

- `allow-stale`: use existing snapshot and report staleness.
- `prefer-fresh`: rebuild if cheap and no active rebuild is running; otherwise return stale with warning.
- `require-fresh`: rebuild or return an explicit stale/unavailable result.

### Rebuild

The rebuild flow:

```text
resolve scoped root
  -> compute root fingerprint
  -> scan eligible files
  -> parse source files
  -> emit graph records
  -> replace graph records for index id atomically in store
  -> write CodeIndexSnapshot
  -> return snapshot
```

If graph replacement cannot be atomic in the first SurrealDB implementation, write a new snapshot id and mark it active only after all records load. Readers use the active snapshot id.

### Background Work

Index rebuilds may be long-running. Phase one can run rebuilds synchronously for tests and explicit operation calls. A later daemon background worker may prebuild indexes after Repository initialization or Mission worktree creation.

## Query Safety

- Use parameterized SurrealDB queries.
- Keep label/table/relation names from fixed schema registries.
- Enforce max result limits and max traversal depth.
- Reject path traversal and absolute paths from operation input.
- Redact sensitive path names or content according to the indexer's sensitive-file policy.
- Return structured errors, not stack traces.

## Implementation Sequence

1. Update `mission mcp connect` bridge to support semantic operation descriptors.
2. Refactor `read_artifact` to prove signal and semantic operation tools both work through the bridge.
3. Add code intelligence schemas and graph store interface with an in-memory fake for tests.
4. Add SurrealDB-backed graph store provisioning behind the interface.
5. Add TypeScript/JavaScript indexer fixture support.
6. Implement `code_search` and `symbol_context` over fake store, then SurrealDB store.
7. Implement `impact_analysis` traversal.
8. Add `changed_code_impact`, `route_impact`, and `tool_context`.
9. Add staleness diagnostics and optional explicit rebuild command.
10. Consider Airport diagnostics after the Agent path is stable.

## Testing

Required tests:

- semantic operation descriptor materialization includes signal and semantic operation tools.
- stdio bridge proxies semantic operation inputs without signal wrapping.
- unauthorized semantic operation calls reject before service invocation.
- scope resolver chooses Mission worktree root for task-scoped executions.
- path traversal and out-of-scope roots reject.
- code graph schema compiles through zod-surreal.
- fixture index output is deterministic.
- `code_search` returns bounded ranked results.
- `symbol_context` returns disambiguation for duplicate names.
- `impact_analysis` respects depth, direction, relation filters, and confidence.
- stale indexes are reported in operation results.
- runtime facts are appended for accepted operations and bounded in size.

## Open Implementation Questions

- Should the first graph store share the daemon in-memory datastore instance or use a separate SurrealDB database namespace behind the same daemon process?
- Which TypeScript parser path should phase one use: TypeScript compiler API, tree-sitter, or a smaller local extractor tuned for Mission's codebase?
- Should code graph records include snippets, or should snippets always be fetched through `read_artifact` after graph narrowing?
- How should index rebuild progress be surfaced to Airport without making Airport the owner of index lifecycle?
