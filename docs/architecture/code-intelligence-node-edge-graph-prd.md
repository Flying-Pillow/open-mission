---
layout: default
title: Code Intelligence Node Edge Graph PRD
parent: Architecture
nav_order: 8.955
description: Temporary product requirements for simplifying Mission code intelligence to a canonical node and edge graph model.
---

## Purpose

Mission should persist code-intelligence graph data in the simplest graph shape that can scale with additional semantic depth.

The product requirement is:

```text
persist code graph nodes in code_object
persist code graph edges in code_relation
anchor one graph snapshot with explicit snapshot vocabulary
```

## Problem

The current code-intelligence direction already commits to schema-generated SurrealDB DDL, but it still leaves the persisted graph shape more fragmented and ambiguous than necessary.

- graph nodes are split into separate normal tables such as files and symbols;
- graph links are still modeled as ordinary table rows rather than clearly as canonical edges;
- the ownership field name `indexId` is ambiguous and does not clearly say whether it points to an index definition, an indexing process, or one durable graph snapshot;
- future graph concepts such as routes, tools, processes, and clusters would keep widening the table surface unless the graph core is simplified.

## Goal

Define one simple persisted graph core for code intelligence:

- `code_object` for nodes;
- `code_relation` for edges;
- `snapshotId` for ownership by one code-index snapshot.

This model should remain simple enough for the first implementation wave while being extensible for later graph kinds.

## Users

Primary users:

- maintainers implementing the code graph store and indexer
- maintainers defining code graph schemas and generated DDL
- Agents and daemon services consuming bounded code graph queries

Secondary users:

- Open Mission web once it renders read-only graph views
- reviewers inspecting graph snapshots and semantic operation results

## Product Principles

### One Graph Core

Prefer one node table and one edge table over one table per graph concept unless a later decision proves specialization is necessary.

### Typed Simplicity

`code_object` and `code_relation` must remain typed by explicit `objectKind` and `relationKind` vocabularies so simplicity does not collapse into an unstructured bucket design.

### Explicit Snapshot Ownership

Use `snapshotId` as the canonical ownership reference for graph records. Avoid ambiguous `indexId` naming.

### Schema-Owned DDL

The graph shape, node kinds, edge kinds, and DDL all come from Mission-owned schemas and `@flying-pillow/zod-surreal` metadata.

## Requirements

### Graph Shape

- Persist graph nodes in `code_object`.
- Persist graph edges in `code_relation`.
- Model `code_relation` as the canonical graph edge family, not as an ordinary flat table approximation.
- Keep `code_index_snapshot` as the owning snapshot family for rebuildable graph snapshots.

### Node Rules

- Every `code_object` row must have canonical `id`.
- Every `code_object` row must have canonical `objectKind`.
- Initial object kinds should cover at least `root`, `file`, `symbol`, and `document`.
- Node-specific fields must remain schema-bounded and documented.

### Edge Rules

- Every `code_relation` row must have canonical `id`.
- Every `code_relation` row must have canonical `relationKind`.
- Every `code_relation` row must model edge endpoints explicitly through `in` and `out`.
- Initial relation kinds should cover at least `contains`, `defines`, `imports`, and `calls`.

### Indexer Rules

- The indexer output contract must emit canonical `code_object` and `code_relation` records instead of specialized per-table record families.
- Eligible markdown and other non-code text files should produce baseline `code_object` rows, typically as `objectKind = document`.
- Optional Agent-assisted semantic indexing for markdown and other non-code text files may be added as a provider behind the indexer.
- That Agent-assisted document provider must remain optional and disabled by default.
- Baseline indexing must not depend on Agent-assisted document enrichment succeeding.

### Snapshot Ownership

- `snapshotId` is the canonical field name for graph-record ownership by one code-index snapshot.
- Nodes and edges must both reference the owning snapshot.
- The product vocabulary should stop using `indexId` for persisted graph-row ownership.

### Generated DDL

- DDL for `code_object`, `code_relation`, and `code_index_snapshot` must be generated from canonical schemas.
- Graph `objectKind` and `relationKind` vocabularies must be represented in schema-owned validation and metadata.

## Non-Goals

- introducing runtime query enrichment in the Entity factory;
- promoting code graph records into first-class Entity families;
- finalizing every future node kind or edge kind now;
- building a generalized ontology beyond the needs of Mission code intelligence.

## Success Criteria

- The code graph store has one canonical node family and one canonical edge family.
- Persisted graph ownership uses `snapshotId`, not `indexId`.
- Generated SurrealQL comes from canonical node-edge schemas.
- Future graph concepts can be added by extending `objectKind` and `relationKind` vocabularies rather than adding new ad hoc tables by default.
- Optional Agent-assisted enrichment for markdown and other non-code text files does not block baseline indexing.
