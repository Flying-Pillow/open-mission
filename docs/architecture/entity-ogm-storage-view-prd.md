---
layout: default
title: Entity OGM Storage/View PRD
parent: Architecture
nav_order: 8.97
description: Temporary product requirements for the normalized OGM-backed Entity storage and hydrated view refactor.
---

## Purpose

Open Mission should model Entity storage and hydrated reads the same way `/flying-pillow` does: canonical storage rows are normalized and relation-aware, while hydrated Entity reads are assembled from those rows through the OGM/storage adapter rather than by embedding child Entity storage inside parent Entity storage schemas.

The product requirement is:

```text
store Entity truth as normalized rows plus modeled relations
read Entity truth as hydrated Entity views assembled from those relations
```

Here, `hydrated Entity views` means canonical hydrated Entity boundary shapes, not surface view models.

## Problem

Current Entity storage in Open Mission is structurally inconsistent.

- canonical `id` already exists, but several Entity families still duplicate self identity under names such as `missionId` or `taskId`;
- parent storage records embed child Entity arrays that should be first-class related rows;
- daemon and Entity logic compensate with compatibility-era self locators, ad hoc hydration, and filesystem-root fallback;
- SurrealDB references and relation tables cannot become the primary storage and hydration structure while the stored shape remains partially embedded.

This makes Entity persistence wider, less consistent, and harder to reason about than the OGM-backed pattern already used in `/flying-pillow`.

## Goal

Refactor Entity modeling so that:

- every first-class Entity persists as its own canonical storage row;
- every first-class Entity owns exactly one canonical `id` field;
- inter-Entity ownership and graph structure are represented by explicit relation fields or relation tables in storage schemas;
- hydrated Entity reads can materialize related children from the modeled relations;
- contracts and transport address instances by canonical Entity id instead of compatibility-era locator payloads.

## Non-Goals

- preserving embedded child Entity storage as a long-term compatibility shape;
- exposing raw SurrealDB record id objects outside the adapter boundary;
- introducing a second Surreal-only schema family beside canonical storage schemas;
- leaving relation semantics implicit in query code rather than modeled in schemas.

## Users

Primary users:

- maintainers implementing and extending Entity families;
- daemon code that reads and mutates canonical Entity state;
- future SurrealDB-backed Entity persistence and relation-aware reads.

Secondary users:

- Open Mission hosts consuming hydrated Entity views;
- test suites that need deterministic storage and hydration behavior;
- future clean-sheet implementation work that needs one canonical Entity model registry.

## Product Principles

### Normalized Storage

Persist only what the owning Entity row owns. Child Entity rows are separate records unless the data is truly an embedded value object rather than a first-class Entity.

### Hydrated Entity Boundary

Hydrated Entity reads may include related child Entities and derived read material, but that richness belongs at the Entity boundary, not in canonical storage rows. `Hydrated view` means the canonical hydrated `<Entity>Schema`; it does not mean a surface view model, projection, snapshot, or UI state shape.

### Derived Stage Semantics

`Stage` remains a first-class Entity family when it owns durable row data such as ordering, stage-level artifact relationships, or workflow bookkeeping. Its workflow status is still derived from Mission task progress and workflow law, not independently operator-authored state.

### Canonical Identity

Every first-class Entity has one canonical `id`. Entity-specific `missionId`, `taskId`, or `artifactId` names are valid only as references to another Entity or as explicitly renamed domain keys.

### Adapter-Owned Surreal Translation

The app/domain boundary sees string ids in `table:uniqueId` form. Surreal record ids remain adapter internals.

SurrealDB is an adapter behind Entity, factory, and State store seams. It must not become a direct daemon write shortcut or a public mutation interface.

### Clean-Sheet Storage

Open Mission has no live persistence estate to preserve for this refactor.

- no compatibility migration layer may be introduced;
- repository-scoped control state lives under `.open-mission/`;
- each tracked Repository owns one Open Mission database at `<repository-root>/.open-mission/database/`;
- each first-class Entity family persists in its own canonical table within that database;
- Repository initialization provisions that database before Mission work depends on it;
- `.open-mission/settings.json` remains Repository-owned control state but does not carry a database-path override in the first implementation wave.

Mission dossier state and Mission worktree paths remain Repository/Mission workflow concerns. They do not create alternate Entity database roots.

### Table-Owned Storage Placement

Storage topology is one Repository-owned database with tables per Entity family.

- Repository, Mission, Task, Stage, Artifact, AgentExecution, and code-intelligence families persist as canonical rows in their own tables.
- Repository and Mission ownership remain explicit in canonical row fields and modeled relations, not in separate database selection rules.
- Direct modeled references and relation tables operate within the same database boundary.
- Mission start, Mission reads, code-intelligence indexing, and EntityFactory-backed persistence all use that same Repository-owned database.

For the first implementation wave, the required table matrix is:

- `Repository` -> `repository`
- `Mission` -> `mission`
- `Stage` -> `stage`
- `Task` -> `task`
- `Artifact` -> `artifact`
- `AgentExecution` -> `agent_execution`
- code-intelligence node and edge families -> their canonical node and edge tables

### Schema-Owned Relations

Ownership and graph relations belong in canonical storage schemas through zod-surreal metadata and model definitions.

The default persistence seam is SurrealDB record references on canonical storage fields. Those references provide typed `record<...>` pointers, `ON DELETE` lifecycle behavior, and direct `FETCH`-oriented hydration for ordinary ownership and lookup paths.

Relation tables are reserved for relationships that are first-class graph edges: relationships with their own metadata, ordering, many-to-many semantics, or traversal value beyond a simple owner/reference field.

### Registry-Owned Consistency

One canonical Entity registry should drive contract lookup, storage registration, Surreal provisioning, and relation-aware hydration.

The registry binds canonical Entity-owned artifacts. It must not define schemas inline, infer behavior independently of `<Entity>Contract.ts`, or make generic Entity base modules import concrete Entity families.

## Doctrine Alignment Requirements

This refactor is ready to drive implementation only when the following accepted Entity rules remain true:

- `<Entity>.ts` owns behavior, invariants, lifecycle, and remote method implementations.
- `<Entity>Schema.ts` owns input, storage, hydrated, method, result, event, and acknowledgement schemas.
- `<Entity>Contract.ts` owns declarative method and event binding only.
- `<Entity>StorageSchema` extends `EntityStorageSchema`, uses canonical `id`, and is the only persisted Entity row shape.
- `<Entity>Schema` extends `EntitySchema` and is the complete hydrated Entity boundary shape.
- `commands` and `classCommands` are derived command descriptors and never persisted storage fields.
- schema aliases, schema type aliases, import aliases, result wrappers, and remote schema maps are forbidden; a schema name exists only when it validates a distinct concept.
- method payload and result schemas must reuse canonical schemas when those schemas already describe the shape. A full-Entity read returns `<Entity>Schema`; a method whose only argument is target identity uses transport `id` validated by `EntityIdSchema` rather than a method-specific locator payload.
- `Projection`-named schemas, types, transforms, and contract results are forbidden for this refactor. Callers use `<Entity>Schema` for complete hydrated Entity data.
- all exported schemas and fields follow the ADR-0001.04 `Schema`/`Type` naming and `.meta({ description })` discipline.
- zod-surreal table, field, reference, relation, index, and description metadata lives on canonical storage schemas, not on a parallel Surreal-only schema family.
- daemon writes continue through Entity contracts and State store transactions; raw SurrealDB access remains an adapter concern.
- generic Entity infrastructure remains child-independent; concrete registry, dispatch, hydration, and provisioning catalogues are daemon-owned.

## Requirements

### Identity

- Every first-class Entity storage record must expose canonical `id`.
- Self identity must not be duplicated under entity-specific names.
- Foreign-reference fields may keep explicit names such as `missionId`, `repositoryId`, `stageId`, `taskId`, and `ownerId`.
- Human-facing domain keys must be named distinctly from canonical Entity id.

### Storage Modeling

- `<Entity>StorageSchema` must describe only the canonical persisted row.
- every first-class Entity family, including `Repository`, must persist through its canonical `<Entity>StorageSchema` as a database row.
- Parent storage rows must not persist first-class child Entity arrays as canonical storage.
- Child Entities must persist their owner/reference fields explicitly.
- Many-to-many or metadata-carrying links must use relation tables.
- zod-surreal metadata must live on canonical storage schemas and relation schemas.
- every schema, field, nested field, enum, union member, method payload/result schema, event schema, acknowledgement schema, descriptor schema, table, relation, reference, and index must carry a meaningful description; zod-surreal descriptions must remain equivalent to the Zod `.meta({ description })` documentation for the same storage concept unless a storage-facing distinction is explicitly needed.
- Ordinary owner/reference fields should prefer SurrealDB `REFERENCE` modeling over relation tables.
- Relation-table `ENFORCED` semantics are optional hardening and are not required for the base Entity model.

### Hydrated Reads

- `<Entity>Schema` remains the complete hydrated Entity boundary shape.
- Hydrated reads may include related child Entities, derived workflow state, and command descriptors.
- The storage adapter or bounded store/query layer must be able to materialize related Entity data from modeled references and relation traversals.
- Reference-modeled reads should prefer direct dereference and `FETCH`-style hydration before introducing graph-edge traversal.

### Contracts And Transport

- Instance invocation must be addressable by canonical Entity id.
- Class-versus-instance execution remains declared by the Entity contract.
- Payload schemas must stop carrying compatibility-era self locators when canonical `id` is sufficient; instance transport must carry the target id separately from method input.
- Relation references remain explicit in payloads where behavior needs them.
- The invocation envelope must expose `id` as a top-level transport field for instance execution.
- `id` is required when the contract method execution mode is `entity` and forbidden when the execution mode is `class`.
- Method payload schemas validate method-specific input only. They must not repeat the target Entity's own identity.
- Method result schemas validate the canonical result only. If the result is the full Entity, the result schema is `<Entity>Schema`; if the result is an acknowledgement, the result schema is the canonical acknowledgement schema; if the result is an existing value object such as `ArtifactBodySchema`, that existing schema is reused.
- New method-specific input or result schemas are allowed only when no existing Entity, shared, acknowledgement, event, descriptor, or value-object schema already validates the exact shape.
- Compatibility-era locator schemas may remain only for class-scoped selector queries or commands that intentionally resolve another Entity by relation or owner context.
- Entity acknowledgements and event subjects may include explicit relation fields such as `missionId` or `taskId` when those fields describe ownership or routing, but an Entity's own identity remains `id`.

### Registry

- Introduce one Entity model/contract registry entry per Entity family.
- Registry entries must cover class, contract, input/storage/hydrated schemas, storage table, and Surreal model metadata.
- Factory registration and daemon dispatch should consume the same daemon-owned registry rather than separate manual catalogues.
- Derived graph domains such as code intelligence must also register their canonical storage models so DDL generation and graph structure are owned by schemas instead of handwritten table definitions.
- Each registry entry must expose enough information to answer these questions without consulting a second catalogue: which Entity class and contract own the family, which schema validates input/storage/hydrated reads, which table persists it, and which zod-surreal model definition provisions it.
- Registry entries must reference schemas owned by Entity schema modules; they must not create alternate schema maps, type aliases, or method result catalogues.

### Query And Hydration Ownership

- Relation-aware hydration should be implemented behind EntityFactory and factory-owned query collaborators, not in generic Entity base modules or surfaces.
- The minimal row store remains a low-level adapter seam for simple writes and raw reads.
- Hydration planning remains bounded even though all canonical tables live in one database.
- Surreal write helpers remain below the State store transaction and EntityFactory seams; application code must not persist Entity-owned rows through an unregistered raw store.

### Validation

- Storage rows round-trip through Surreal with canonical string ids.
- Generated SurrealQL comes from canonical schema metadata.
- Hydrated reads prove relation-aware loading.
- Schema audit proves no schema aliases, type aliases, import aliases, unnecessary read response/result schemas, or `Projection`-named Entity shapes remain in the targeted refactor surface.
- Description audit proves every schema and every field has Zod `.meta({ description })`, and every Surreal table, relation, reference, field, and index has equivalent zod-surreal description metadata.
- Code-intelligence DDL is generated from canonical schemas and models files, symbols, and graph links as explicit nodes and edges rather than ordinary flat tables.
- every targeted Entity family follows the same identity and storage rules.
- Instance transport proves `id` is required for entity execution and absent from method-specific payload schemas.
- Storage topology proves each targeted Entity family resolves to its canonical table in the single Open Mission database.
- Provisioning proves the canonical database location is `<repository-root>/.open-mission/database/` and that Mission or Entity-specific database roots are not created.
- `Stage` behavior proves stage status remains derived even when `Stage` persists as its own row family.

## Success Criteria

- targeted storage schemas no longer embed first-class child Entity arrays.
- Entity self identity is canonicalized to `id` across the targeted Entity families.
- Relation fields and relation tables are modeled in zod-surreal metadata.
- Hydrated Entity reads can fetch related data structurally rather than reconstructing it ad hoc.
- One registry can describe and register the canonical Entity model surface.
- Code-intelligence storage is represented by canonical node and edge schemas with generated SurrealQL, not by normal-table approximations of graph links.
- Entity transport no longer depends on compatibility-era self locator payloads for instance execution.
