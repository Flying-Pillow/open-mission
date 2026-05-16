---
layout: default
title: Code Intelligence Node Edge Graph Spec
parent: Architecture
nav_order: 8.956
description: Temporary implementation spec for the canonical code_object and code_relation model in Mission code intelligence.
---

## Scope

This spec realizes [Code Intelligence Node Edge Graph PRD](code-intelligence-node-edge-graph-prd.md), ADR-0004.03, and proposed ADR-0004.04.

It defines the minimal persisted graph shape for Mission code intelligence.

## Authoritative Inputs

- `CONTEXT.md`: canonical Mission language.
- ADR-0004.03: Mission owns a SurrealDB-backed, rebuildable code-intelligence index.
- Proposed ADR-0004.04: Mission should use one node table and one edge table for code intelligence graph storage.
- `@flying-pillow/zod-surreal`: schema metadata and DDL generation seam.

## Target Structural Shape

```text
code_index_snapshot
  -> one rebuildable graph snapshot for one Code root

code_object
  -> every graph node in that snapshot
  -> typed by objectKind

code_relation
  -> every graph edge in that snapshot
  -> typed by relationKind
  -> points from in -> out
```

## Canonical Families

### CodeIndexSnapshot

Purpose:

- own one rebuildable graph snapshot
- capture root fingerprint, indexed time, counts, and status

Canonical ownership field name for graph members:

- `snapshotId`

Do not use `indexId` as the canonical persisted ownership name.

### CodeObject

Purpose:

- represent every graph node

Required fields:

- `id`
- `snapshotId`
- `objectKind`

Common optional fields may include:

- `name`
- `path`
- `language`
- `startLine`
- `endLine`
- `contentHash`

Initial object kinds:

- `root`
- `file`
- `symbol`
- `document`

Later node kinds may include:

- `route`
- `tool`
- `process`
- `cluster`

### CodeRelation

Purpose:

- represent every first-class graph edge

Required fields:

- `id`
- `snapshotId`
- `relationKind`
- `in`
- `out`

Common optional fields may include:

- `order`
- `weight`
- `isTypeOnly`
- `isExport`

Initial relation kinds:

- `contains`
- `defines`
- `imports`
- `calls`

Later edge kinds may include:

- `extends`
- `implements`
- `handles_route`
- `handles_tool`
- `member_of`

## Modeling Rules

### 1. Snapshot Ownership

- Every node and edge belongs to exactly one `code_index_snapshot`.
- Ownership is named `snapshotId`.
- `snapshotId` should compile to a typed SurrealDB record reference to `code_index_snapshot`.

### 2. Node Simplicity

- `code_object` is the canonical node family.
- `objectKind` decides the semantic node subtype.
- Optional fields must remain bounded by documented `objectKind` semantics.
- `code_object` must not become an opaque schema-less payload bag.

### 3. Edge Simplicity

- `code_relation` is the canonical edge family.
- `in` and `out` are the edge endpoints.
- `relationKind` decides the semantic relationship subtype.
- Edge metadata is allowed only when the relationship itself needs it.

### 4. DDL Ownership

- Mission-owned Zod schemas define `code_index_snapshot`, `code_object`, and `code_relation`.
- `@flying-pillow/zod-surreal` metadata generates the DDL.
- Hand-maintained SurrealQL is not authoritative.

### 5. Migration Direction

Current normal-table families such as `code_file`, `code_symbol`, and `code_relation` should be replaced by the canonical node-edge model.

Migration direction:

- `code_file` rows become `code_object(objectKind = file)` rows;
- `code_symbol` rows become `code_object(objectKind = symbol)` rows;
- current flat `code_relation` rows become canonical edge rows with explicit `in` and `out` endpoints;
- graph ownership fields move from `indexId` to `snapshotId`.

### 6. Indexer Contract

The indexer contract must change with the storage model.

Required indexer output shape:

- `snapshot` metadata for one graph build;
- `objects`: canonical node records shaped for `code_object`;
- `relations`: canonical edge records shaped for `code_relation`.

The indexer must assign explicit `objectKind` values so downstream query code does not infer node type from old table names.

Baseline expectations:

- supported code files may emit `file` and `symbol` objects plus graph relations;
- markdown and other non-code text files should still emit baseline node records, typically `objectKind = document`;
- unsupported text files may emit document/file nodes without deeper semantics.

Optional provider capability:

- an Agent-assisted document provider may enrich markdown or other non-code text files by extracting headings, sections, references, summaries, or other bounded document structure;
- that provider remains optional and disabled by default;
- the graph must remain valid when that provider is absent or skipped.

## Query Direction

- file-level queries still filter `code_object(objectKind = file)` by path and snapshot;
- document-level queries may filter `code_object(objectKind = document)` by path and snapshot;
- symbol queries still filter `code_object(objectKind = symbol)` by name, file linkage, and snapshot;
- traversal queries move through `code_relation` instead of reconstructing graph semantics from flat link rows;
- snapshot scoping remains explicit on every bounded query.

## Validation

Implementation should prove at least:

- generated DDL exists for `code_index_snapshot`, `code_object`, and `code_relation`;
- `snapshotId` replaces `indexId` as the persisted graph ownership field;
- node and edge records validate through schema-owned `objectKind` and `relationKind` vocabularies;
- indexer output emits canonical node and edge records for code files and optional document nodes for non-code text files;
- graph queries can express file containment, symbol definition, and import traversal through the node-edge model.

## Recommended Execution Order

1. Define `CodeObjectSchema`, `CodeRelationSchema`, and updated `CodeIndexSnapshotSchema` with `snapshotId`, `objectKind`, and `relationKind` vocabulary.
2. Generate DDL from the canonical schemas.
3. Update the indexer output contract to emit nodes and edges.
4. Add baseline document/file node emission for markdown and other non-code text files.
5. Keep optional Agent-assisted document enrichment behind a disabled-by-default provider seam.
6. Update the graph store write path to persist nodes and edges.
7. Migrate bounded read queries to the node-edge model.
8. Remove compatibility-era `indexId` ownership naming and specialized normal-table graph families.
