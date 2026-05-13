---
layout: default
title: Code Intelligence Spec
parent: Architecture
nav_order: 8.96
description: Temporary implementation spec for Mission-native code intelligence and semantic MCP operations.
---

## Scope

This spec realizes [Code Intelligence PRD](repository-code-intelligence-prd.md), ADR-0004.09, and ADR-0002.09.

It defines the first Mission-native path for GitNexus-like code intelligence using Mission-owned scopes, SurrealDB-backed graph storage, and Agent execution semantic operations over `open-mission-mcp`.

This document is temporary. Durable vocabulary belongs in `CONTEXT.md`; durable decisions belong in ADRs. When implementation converges, fold stable details into permanent architecture docs and delete this working spec.

## Authoritative Inputs

- `CONTEXT.md`: canonical Mission language.
- ADR-0002.03: State store transactions are the canonical write interface for Mission state.
- ADR-0001.03: Entity classes own behavior.
- ADR-0001.05: Entity commands are the canonical operator surface.
- ADR-0004.06: `open-mission-mcp` is daemon-owned local MCP infrastructure.
- ADR-0004.08: AgentExecution interaction journals record semantic runtime truth.
- ADR-0004.09: `open-mission-mcp` exposes Agent execution semantic operations.
- ADR-0002.09: Code intelligence index is SurrealDB-backed derived read material.
- `@flying-pillow/zod-surreal`: Zod-first SurrealDB schema metadata and DDL primitives.

## Target Runtime Shape

```text
daemon startup
  -> MissionMcpServer
  -> AgentExecutionRegistry
  -> CodeIntelligenceService available for Repository preparation and semantic operations
  -> no eager repository indexing

Repository preparation
  -> Repository.initialize or completed Repository.setup
  -> CodeIntelligenceService.ensureIndex for the prepared Repository root
  -> CodeIndexer scans and extracts provider-backed material
  -> CodeGraphStore writes an active snapshot under the Repository `.mission/runtime`

AgentExecutor.startExecution
  -> create AgentExecution protocol descriptor
  -> register open-mission-mcp access
  -> semantic operation catalog filters tools by AgentExecution scope
  -> adapter receives MCP config

Agent calls code_search
  -> open-mission-mcp authorizes AgentExecution token
  -> validates code_search input
  -> AgentExecutionRegistry resolves active execution
  -> AgentExecutor invokes AgentExecutionSemanticOperations
  -> semantic operation resolves one Code root from AgentExecution scope
  -> CodeIntelligenceService ensures usable index snapshot
  -> CodeGraphStore runs bounded query
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

### CodeIntelligenceService

Owns use cases over code intelligence indexes.

Suggested methods:

```ts
type CodeIntelligenceService = {
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

### CodeGraphStore

Owns physical graph persistence and safe graph queries.

It provisions SurrealDB from Mission-owned zod-surreal model definitions. Provisioning must compile the code graph Zod schemas into a zod-surreal model snapshot and render SurrealQL statements from that snapshot. Store code must not depend on hand-maintained SurrealQL table definitions as the source of truth.

Suggested methods:

```ts
type CodeGraphStore = {
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

SurrealDB provisioning should use generated statements from the code graph schema module. A package script such as `pnpm --filter @flying-pillow/open-mission-core generate:code-graph-schema` should refresh any checked-in `.surql` fixture or generated schema file. Tests should fail when generated SurQL drifts from the committed fixture.

### CodeIndexer

Owns source scanning and graph build output.

Responsibilities:

- discover indexable files
- apply ignore, generated, binary, oversized, and sensitivity filters
- parse language-specific syntax
- emit code files, symbols, relations, routes, tools, processes, and clusters
- produce deterministic output for fixture tests

Phase one should favor TypeScript/JavaScript support for Mission itself. Extraction must be parser-backed rather than regex-driven. The first TS/JS slice may use the TypeScript compiler API because it is already in the runtime toolchain; broader language coverage should follow a GitNexus-like provider model with Tree-sitter grammars, per-language query/capture configuration, and explicit import-resolution hooks behind the same indexer contract.

The CodeIndexer orchestration must be language-provider shaped from the start:

- scan eligible text files independently from semantic parser support
- honor `.gitignore` rules while always excluding Mission runtime state such as `.mission/`
- detect language from a centralized registry of extensions and known filenames
- write Code file records for supported, unsupported, and unknown text files
- delegate symbols, imports, calls, routes, tools, type facts, and scope-resolution facts only to providers that advertise those capabilities
- keep provider failures isolated so one unavailable parser does not prevent file-level indexing for the Code root

The TypeScript/JavaScript compiler provider is only the first provider. Future Tree-sitter providers should plug into the same extraction contract rather than adding language branches to the scanner.

### Code Root Boundary

Repository roots and Mission worktree roots both resolve to Code roots before indexing. A Mission task should resolve to the Mission worktree root when one exists because the active work may differ from the main Repository root, but the indexer, graph store, schemas, and semantic operations treat the resolved path as the same Code root concept.

Root resolution rules belong to a small scope resolver used by semantic operations:

```ts
type CodeIntelligenceScopeRoot = {
  rootPath: string;
  repositoryRootPath?: string;
  missionId?: string;
  taskId?: string;
};
```

`repositoryRootPath`, `missionId`, and `taskId` are resolver context only. They must not become graph table prefixes, alternate schema families, or separate indexer modes.

## Schema Model

Use Zod v4 schemas with zod-surreal metadata for every table, relation table, indexed field, analyzer, and generated SurrealDB definition owned by the code intelligence index.

Mission owns these schemas. `@flying-pillow/zod-surreal` remains a standalone generic package that supplies metadata registries, model compilation, deterministic SurrealQL DDL generation, typed query helpers, and provisioning primitives. It must not import Mission code or Mission vocabulary.

The code graph schema module should export:

- Zod schemas for each code graph record shape.
- `z.infer` TypeScript types for validated records.
- zod-surreal model definitions for every SurrealDB table and relation table.
- a compiled schema snapshot helper for tests and provisioning.
- a generated SurQL helper that calls `compileDefineStatements(compileSchema({ models }))`.

Recommended implementation shape:

```ts
import { z } from 'zod/v4';
import { compileDefineStatements, compileSchema, defineModel, field, table } from '@flying-pillow/zod-surreal';

export const CodeFileSchema = z.object({
  id: z.string().register(field, { type: 'record<code_file>' }),
  indexId: z.string().register(field, { type: 'record<code_index_snapshot>', reference: 'code_index_snapshot' }),
  path: z.string().register(field, { type: 'string', index: 'normal' }),
  language: z.string().optional().register(field, { type: 'option<string>' })
}).strict().register(table, {
  table: 'code_file',
  schemafull: true,
  indexes: [{ name: 'code_file_index_path_idx', fields: ['indexId', 'path'] }]
});

export const CodeGraphModels = [
  defineModel({ name: 'CodeFile', schema: CodeFileSchema })
];

export function compileCodeGraphSurql(): string {
  return `${compileDefineStatements(compileSchema({ models: CodeGraphModels })).join('\n')}\n`;
}
```

The exact field metadata may change during implementation, but the direction is fixed: Zod schemas plus zod-surreal metadata generate the SurrealQL DDL.

Recommended model names:

- `CodeIndexSnapshot`
- `CodeFile`
- `CodeSymbol`
- `CodeRelation`
- `CodeRoute`
- `CodeTool`
- `CodeProcess`
- `CodeCluster`

Do not prefix these with `Repository` or `Mission`. The resolved Code root provides scope.

### CodeIndexSnapshot

Fields:

- `id`
- `codeRootId`
- `rootPath`
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

Use a SurrealDB relation table generated from zod-surreal metadata. The relation table schema must declare `kind: 'relation'` plus fixed `from` and `to` table sets where zod-surreal supports them. If one generic relation table cannot express all node pairs cleanly, use a small set of generated relation tables behind the `CodeRelation` domain vocabulary rather than hand-writing SurQL.

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
  codeRootId: string;
  rootPathHash: string;
  querySummary: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  stale: boolean;
};
```

Do not store full result payloads in runtime facts by default. Store enough to audit that the Agent used code intelligence and what target/query it used.

## Index Lifecycle

Indexing is owned by the Code intelligence service, not by AgentExecution. AgentExecution can cause indexing to be needed by calling a semantic operation, but it does not parse files, write graph records, watch the filesystem, or decide index freshness policy.

### Triggers

The service should support three trigger paths:

- Repository preparation trigger: after Repository setup or initialization produces valid Mission repository control state, the daemon may resolve the Repository root as a Code root and enqueue an index build with `prefer-fresh` priority.
- Mission worktree trigger: after a Mission worktree is materialized and initialized, the daemon may resolve the Mission worktree root as a Code root and enqueue an index build because active Mission code may diverge from the Repository root.
- Semantic operation trigger: when an Agent execution calls `code_search`, `symbol_context`, `impact_analysis`, or a related operation, the semantic operation delegates to `ensureIndex`; `ensureIndex` decides whether to use, rebuild, enqueue, or reject based on freshness policy.

Repository-scoped Agent executions may therefore start after repository preparation without waiting for a complete index. Their first code intelligence call can use a warm index if one exists or request a fresh one through `ensureIndex`. Task-scoped Agent executions should resolve to the Mission worktree Code root when one exists.

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

### Updates

Index updates are snapshot replacements, not in-place domain mutations. The first implementation should rebuild the active snapshot when the root fingerprint changes. Later incremental updates may re-parse changed files only, but they must still publish a coherent snapshot and keep stale readers away from half-written graph state.

Freshness inputs should include Git commit, dirty worktree status, indexed file hashes, and indexer version. For Mission worktrees, dirty file changes matter even when the branch commit has not changed.

File watching is optional and should be treated as an optimization. The authoritative freshness check remains `ensureIndex`, because daemon restart, missed watcher events, Git operations, or external editors can all bypass a watcher.

### Background Work

Index rebuilds may be long-running. Phase one can run rebuilds synchronously for tests and explicit operation calls. A later daemon background worker may prebuild indexes after Repository initialization or Mission worktree creation.

## Query Safety

- Use parameterized SurrealDB queries.
- Keep label/table/relation names from fixed schema registries.
- Enforce max result limits and max traversal depth.
- Reject path traversal and absolute paths from operation input.
- Redact sensitive path names or content according to the indexer's sensitive-file policy.
- Return structured errors, not stack traces.

## Open Mission Web Visualization

Open Mission web will eventually render a visual representation of the Code graph. This is a surface feature over daemon-owned code intelligence, not a separate graph product or an alternate graph authority.

The visualization should read from bounded daemon APIs that expose active snapshot metadata, visible nodes, visible relations, impact paths, and freshness status. It must not receive a raw SurrealDB client, run raw SurrealQL, mutate index records, create relationship semantics, or choose Code roots independently of daemon scope resolution.

Baseline interactions:

- select a Code root snapshot
- filter by file, symbol, relation type, impact depth, stale/fresh status, or search query
- inspect a node or relation summary
- trace an impact path returned by semantic operations
- open a related file or Artifact through existing daemon/Open Mission navigation affordances

This view should follow the Agent-facing semantic operation model. The Agent path proves the graph, scope, staleness, and runtime fact contracts first; Open Mission web visualization becomes a read-only operator lens after those contracts are stable.

## Implementation Sequence

1. Update `open-mission mcp connect` bridge to support semantic operation descriptors.
2. Refactor `read_artifact` to prove signal and semantic operation tools both work through the bridge.
3. Add code intelligence schemas and graph store interface with an in-memory fake for tests.
4. Add zod-surreal model definitions for code index snapshots, files, symbols, relation tables, routes, tools, processes, and clusters.
5. Add a generator that compiles those models and emits deterministic SurQL provisioning statements.
6. Add SurrealDB-backed graph store provisioning behind the interface using generated statements.
7. Add parser-backed TypeScript/JavaScript indexer fixture support.
8. Implement `code_search` and `symbol_context` over fake store, then SurrealDB store.
9. Implement `impact_analysis` traversal.
10. Add `changed_code_impact`, `route_impact`, and `tool_context`.
11. Add staleness diagnostics and optional explicit rebuild command.
12. Add read-only Open Mission web visual graph APIs and UI after the Agent path is stable.

## Testing

Required tests:

- semantic operation descriptor materialization includes signal and semantic operation tools.
- stdio bridge proxies semantic operation inputs without signal wrapping.
- unauthorized semantic operation calls reject before service invocation.
- scope resolver chooses the scoped Code root for task-scoped executions.
- path traversal and out-of-scope roots reject.
- code graph schema compiles through zod-surreal.
- generated SurQL provisioning output is deterministic and covered by a committed snapshot or fixture comparison.
- fixture index output is deterministic.
- `code_search` returns bounded ranked results.
- `symbol_context` returns disambiguation for duplicate names.
- `impact_analysis` respects depth, direction, relation filters, and confidence.
- stale indexes are reported in operation results.
- runtime facts are appended for accepted operations and bounded in size.
- Open Mission web visual graph APIs expose only daemon-owned read models and reject mutation or raw query behavior.

## Open Implementation Questions

- Should the first graph store share the daemon in-memory datastore instance or use a separate SurrealDB database namespace behind the same daemon process?
- Which TypeScript parser path should phase one use: TypeScript compiler API, tree-sitter, or a smaller local extractor tuned for Mission's codebase?
- Should code graph records include snippets, or should snippets always be fetched through `read_artifact` after graph narrowing?
- How should index rebuild progress and visual graph loading state be surfaced to Open Mission without making Open Mission the owner of index lifecycle?
