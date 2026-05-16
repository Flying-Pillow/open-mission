---
layout: default
title: Entity OGM Storage/View Spec
parent: Architecture
nav_order: 8.98
description: Temporary implementation spec for the normalized OGM-backed Entity storage and hydrated view refactor.
---

## Scope

This spec realizes [Entity OGM Storage/View PRD](entity-ogm-storage-view-prd.md), ADR-0001.01, ADR-0001.02, ADR-0001.04, ADR-0001.05, ADR-0001.07, ADR-0003.03, and proposed ADR-0001.08.

It defines the structural refactor that moves Open Mission Entity persistence from mixed embedded storage toward a normalized OGM-backed model where canonical storage rows are relation-aware and hydrated Entity boundary shapes are assembled from those modeled relations.

This document is temporary. Durable vocabulary belongs in `CONTEXT.md`; durable decisions belong in accepted ADRs. When implementation converges, fold stable details into permanent architecture docs and remove this working spec.

This is a clean-sheet implementation spec. There is no live database or JSON persistence estate to migrate. Current compatibility-era database and JSON shapes may be removed rather than bridged.

## Authoritative Inputs

- `CONTEXT.md`: canonical Open Mission language.
- ADR-0001.01: canonical Entity identity and metadata.
- ADR-0001.02: canonical Entity class/schema/contract roles and zod-surreal storage seam.
- ADR-0001.04: mechanical Entity schema/type naming, shared parent schema inheritance, and schema description discipline.
- ADR-0001.05: Entity commands as the canonical operator surface; command descriptors are hydrated read material, not storage.
- ADR-0001.07: generic Entity infrastructure remains child-independent.
- ADR-0003.03: State store transactions remain the canonical write interface; raw Surreal writes are adapter internals.
- Proposed ADR-0001.08: normalized OGM-backed Entity storage and hydrated view model.
- `@flying-pillow/zod-surreal`: canonical Surreal schema metadata and DDL generation seam.
- `/flying-pillow`: reference implementation for normalized storage plus hydrated OGM reads.

## Target Structural Shape

```text
Entity registry
  -> Entity class
  -> Entity contract
  -> input schema
  -> storage schema
  -> hydrated schema
  -> zod-surreal model definition
  -> storage table / relation table metadata

Surreal provisioning
  -> compile registry-backed model definitions
  -> generate reference and relation DDL from canonical storage schemas

storage topology
  -> one Open Mission database at <repository-root>/.open-mission/database
  -> one canonical table per Entity family within that database
  -> repository settings at .open-mission/settings.json

store write
  -> validate canonical storage row
  -> translate canonical string id to Surreal record id
  -> persist row content without leaking Surreal record id objects upward

hydrated read
  -> read root row by canonical id
  -> fetch modeled references / relation rows through bounded store queries
  -> hydrate related Entity rows into <Entity>Schema
```

## Implementation Contract Freeze

This target is docs-first and implementation-driving. Implementation agents must not invent alternate names, registries, schemas, or transport shapes while upgrading Entities for Surreal storage.

Canonical file ownership is frozen as follows:

- `<Entity>.ts` owns behavior, invariants, lifecycle, and remote method implementations.
- `<Entity>Schema.ts` owns `InputSchema`, `StorageSchema`, hydrated `Schema`, method input/result schemas, event schemas, acknowledgement schemas, shared subschemas, Zod `.meta({ description })`, and zod-surreal storage metadata.
- `<Entity>Contract.ts` owns declarative Entity method/event binding only.
- daemon-owned registry modules bind concrete Entity classes, contracts, schemas, storage tables, zod-surreal model definitions, dispatch metadata, factory registration metadata, and hydration readers.
- generic Entity infrastructure owns reusable base mechanics only and must not import concrete registry entries or concrete Entity families.

Canonical schema names are frozen as follows:

- `<Entity>InputSchema` validates creation or registration input only.
- `<Entity>StorageSchema` extends `EntityStorageSchema`, validates the canonical persisted row, and is the only Entity row shape eligible for Surreal provisioning.
- `<Entity>Schema` extends `EntitySchema`, validates the complete hydrated Entity boundary shape, and may include related Entities, derived read material, and command descriptors.
- every exported schema has a mechanically inferred `<Name>Type`; schema aliases, type aliases, import aliases, re-export aliases, and hand-written exported serializable interfaces are forbidden.
- a schema name exists only when it validates a distinct shape or boundary role. Existing schemas must be reused when they already validate a method payload, method result, event payload, acknowledgement, descriptor, value object, storage row, or hydrated Entity.
- all new or refactored schemas and fields carry Zod `.meta({ description })`; persisted schemas, persisted fields, relation/reference fields, relation tables, indexes, and zod-surreal model definitions also carry equivalent zod-surreal `description` metadata.

Canonical method schema selection is frozen as follows:

- a full-Entity read result is `<Entity>Schema`, never `<Entity>ReadResponseSchema`, `<Entity>ReadResultSchema`, `<Entity>ResponseSchema`, or another wrapper;
- a method whose only argument is the addressed Entity's identity uses the invocation envelope `id` validated by `EntityIdSchema`, not a method-specific locator/input schema;
- method-specific input schemas are allowed only for method-specific fields beyond the target Entity id;
- method-specific result schemas are allowed only when no existing Entity schema, shared value-object schema, acknowledgement schema, event schema, descriptor schema, or storage-independent read model schema already validates the result;
- contracts must bind directly to those canonical schemas and must not export parallel query-input, command-input, query-result, or command-result schema maps.

Canonical projection vocabulary is frozen as follows:

- `Projection`-named schemas, types, methods, files, transforms, or contract results are forbidden in the refactor surface;
- callers that need complete hydrated Entity data use `<Entity>Schema`;
- presentation-only or point-in-time material must use precise names such as app view, pane view, status view, timeline, snapshot, event, or descriptor, and must not be treated as Entity truth.

Canonical transport names are frozen as follows:

- the Entity invocation envelope carries `entity`, `method`, optional top-level `id`, and `payload`.
- `id` is required for methods whose contract execution mode is `entity`.
- `id` is forbidden for methods whose contract execution mode is `class`.
- method payload schemas validate method-specific input only and must not repeat the target Entity's own identity.
- class-scoped selector payloads may include relation or owner references only when the method intentionally resolves an Entity rather than operating on an already addressed instance.

Canonical first-slice storage fields are frozen as follows:

- `RepositoryStorageSchema`: `id` plus Repository-owned control state fields and database provisioning metadata, with no Mission-owned child arrays.
- `MissionStorageSchema`: `id`, `repositoryId`, and Mission-owned scalar/runtime coordination fields, with no `stages`, `tasks`, `artifacts`, or `agentExecutions` storage arrays.
- `StageStorageSchema`: `id`, `missionId`, ordering/lifecycle fields owned by Stage, and no independently authored workflow status.
- `TaskStorageSchema`: `id`, `missionId`, `stageId` when Stage addresses or owns the task grouping, and Task-owned scalar fields; `taskId` is not a self identity.
- `ArtifactStorageSchema`: `id`, file-root/path identity material, and explicit owner or relationship reference fields; Mission, Stage, Task, and AgentExecution links do not define Artifact existence.
- `AgentExecutionStorageSchema`: `id`, owner reference, durable execution context, recoverable process/log references, selected protocol, and lifecycle fields that survive daemon restart.

## Canonical Modeling Rules

### 1. Identity

- Every first-class Entity owns one canonical `id` field.
- `id` is serialized as `table:uniqueId` everywhere outside the adapter boundary.
- Entity-specific names such as `missionId` or `taskId` are relation references only.
- If an Entity needs a second domain key, it must use a non-identity name such as `missionKey`, `taskKey`, `sequence`, `slug`, or another explicit domain term.

### 2. Storage Schema

`<Entity>StorageSchema` is the canonical persisted row shape. It extends `EntityStorageSchema`, inherits canonical `id`, and carries zod-surreal table and field metadata when the Entity is persisted in SurrealDB.

It may include:

- scalar fields owned by the Entity;
- owned value objects that are not first-class Entities;
- explicit relation reference fields;
- relation metadata declared through zod-surreal.

It must not include:

- hydrated child Entity arrays for first-class child Entities;
- command descriptors;
- transient runtime transport state;
- surface-facing app view, pane view, status view, or projection state;
- duplicated self identity fields.

### 3. Hydrated Schema

`<Entity>Schema` is the canonical hydrated Entity boundary shape.

It extends `EntitySchema`. It is the complete serializable Entity instance shape exposed by the Entity boundary, not a surface projection or UI view model.

It may include:

- persisted fields from storage;
- related child Entities or linked Entities;
- derived workflow material;
- command descriptors;
- bounded live runtime material when the owning Entity legitimately exposes it.

### 4. Relation Modeling

Use direct references when the relationship is naturally expressed on one row.

This is the default modeling choice for canonical ownership and foreign-reference fields. In SurrealDB terms, these fields must compile to typed top-level `record<...>` fields with `REFERENCE` metadata and explicit `ON DELETE` policy where lifecycle behavior matters. They are the primary seam for direct dereference and `FETCH`-oriented hydration.

Examples:

- `TaskStorageSchema.missionId -> Mission`
- `TaskStorageSchema.stageId -> Stage`
- `StageStorageSchema.missionId -> Mission`
- `ArtifactStorageSchema.ownerId -> Mission | Task | AgentExecution` where ownership is explicit and bounded

Direct reference fields keep canonical string ids at the Entity boundary. The Surreal adapter translates those strings to typed Surreal record ids when compiling writes, reads, and `FETCH` plans.

Use relation tables when the relation has its own identity, cardinality constraints, audit metadata, ordering metadata, or graph traversal semantics.

This is not the default replacement for ordinary owner/reference fields. It is the correct shape only when the relationship itself is a first-class stored thing.

Examples:

- Entity membership relations with order or role metadata
- many-to-many attachment or lineage relations
- cross-Entity graph links that are not naturally owned by one side

SurrealDB `ENFORCED` on relation tables is optional hardening. Use it only when the edge must be rejected unless both endpoint records already exist. The general Entity model does not require `ENFORCED`.

### 5. Adapter Boundary

SurrealDB record id translation remains adapter-owned.

- adapter input: canonical string id
- adapter internal: Surreal record id
- adapter output: canonical string id

No Entity schema, contract, host, surface, or command payload may depend on Surreal record id object shapes.

### 6. Storage Topology

- Each Repository owns repository-scoped control state under `.open-mission/`.
- Each tracked Repository owns one Open Mission database at `<repository-root>/.open-mission/database/`.
- Each first-class Entity family, including `Repository`, is stored in its own canonical table within that database.
- Repository and Mission ownership are modeled through canonical row fields and relations, not by choosing different databases.
- Repository initialization provisions the database before Mission work depends on it.
- `.open-mission/settings.json` is the authoritative Repository settings document but does not carry a database-path override in the first implementation wave.

### 7. Table Assignment

Table assignment is normative.

- Every first-class Entity family persists in its own canonical table.
- Repository and Mission scope remain explicit in canonical row fields and relation metadata.
- Direct modeled references and relation tables operate inside the one-database boundary.
- Mission start, Mission reads, code-intelligence indexing, and EntityFactory-backed persistence all use that same Repository-owned database.

Required table matrix for the first implementation wave:

- `Repository` -> `repository`
- `Mission` -> `mission`
- `Stage` -> `stage`
- `Task` -> `task`
- `Artifact` -> `artifact`
- `AgentExecution` -> `agent_execution`
- repository code-intelligence node and edge families -> their canonical node and edge tables

## Example Refactor Slice

The OGM model is Entity-independent. The current Mission-owned graph is simply the first high-value slice because it already exposes the embedded-storage problem clearly.

### Mission

`MissionStorageSchema` must keep Mission-owned persisted fields only.

It must not persist first-class child arrays such as:

- stages
- tasks
- artifacts
- agentExecutions

Those relationships must be represented through child storage rows and relation references.

`MissionSchema` may still expose hydrated `stages`, `tasks`, `artifacts`, and `agentExecutions` after the read layer assembles them.

### Stage

`StageStorageSchema` must persist:

- `id`
- `missionId`
- Stage-owned scalar fields
- any explicit ordering or lifecycle data owned by Stage

`Stage` remains a first-class Entity family in this refactor wave because it owns durable data and relationships. Its workflow status is still derived from Mission task progress and workflow law rather than being independently authored state.

### Task

`TaskStorageSchema` must persist:

- `id`
- `missionId`
- `stageId` when Stage is the owning or addressing relation
- Task-owned scalar fields
- explicit references to dependencies or relation rows where needed

It must not use `taskId` as duplicated self identity.

### Artifact

`ArtifactStorageSchema` must keep canonical Artifact identity and explicit ownership/reference fields.

Artifact body/file-root concerns remain Artifact-owned, but relation attachment to Mission, Task, Stage, or AgentExecution must be explicit rather than inferred from embedded parent storage.

### AgentExecution

`AgentExecutionStorageSchema` must remain its own first-class row family with explicit owner references. Mission or Task storage must keep only explicit relations, not embedded AgentExecution records.

## Registry Direction

Introduce one canonical registry entry per Entity family.

Required semantic shape:

```ts
type EntityModelRegistryEntry = {
  entity: string;
  table: string;
  entityClass: EntityClassType;
  inputSchema?: z.ZodType;
  storageSchema: z.ZodType;
  hydratedSchema: z.ZodType;
  contract: EntityContractType;
  surrealModel: ZodSurrealModelDefinition;
  factoryRegistration: EntityFactoryRegistrationMetadata;
};
```

Equivalent implementation names are acceptable only when the semantics remain identical and are defined in the daemon-owned registry module. `EntityClassType` and `EntityFactoryRegistrationMetadata` name the required semantics here; implementation may choose local names, but it must not leave those concepts implicit. One registry must drive:

- daemon contract resolution
- Entity factory registration
- DDL generation
- relation-aware hydration planning
- canonical table selection

Registry ownership rules:

- the registry is daemon-owned infrastructure consumed by daemon dispatch and EntityFactory;
- generic Entity base modules must remain unaware of concrete registry entries;
- relation-aware hydration must be implemented behind factory-owned readers or hydrators selected from this registry;
- a second manual catalogue for factory registration, contract lookup, Surreal provisioning, hydration selection, or table selection is forbidden once the registry is introduced.

Registry entries reference canonical artifacts only. They must not define inline Zod schemas, invent method result schemas, alias schemas or inferred types, or contain behavior switches that compete with `<Entity>Contract.ts` and `<Entity>.ts`.

The same rules apply to any future Entity family: normalize storage first, model references in storage schemas, and hydrate related data at the read boundary.

The same structural rule also applies to derived graph domains such as code intelligence: their persisted shape must be owned by canonical schemas and generated DDL, not by handwritten normal-table approximations of graph data.

## Query And Hydration Direction

The current `SurrealEntityStore` row store is too thin for the target model.

Implementation direction:

- keep a minimal row store for simple writes and low-level reads;
- add a bounded relation-aware Entity read layer or query store behind EntityFactory;
- let the factory-owned query layer own `FETCH`, relation traversal, or composed query plans;
- keep raw SurrealQL inside the store/query seam, never in Entity classes or hosts.
- bounded hydration may join or fetch across canonical tables inside the one-database boundary, but it must remain deterministic and factory-owned.

Write ownership rule:

- surfaces submit Entity commands, not storage patches;
- daemon mutation paths validate Entity command input through contracts and apply accepted storage changes through State store transactions or the registered EntityFactory seam;
- the Surreal row store accepts only canonical storage rows selected through registry metadata;
- Entity classes, hosts, and ordinary daemon modules must not share a raw Surreal client as a private write path.

Database-opening rule:

- adapter and daemon code open the canonical Repository-owned database at `<repository-root>/.open-mission/database/`;
- Mission identity, Task identity, Artifact ownership, and AgentExecution ownership do not change the database path;
- no Mission-specific or Entity-specific database roots are created in this refactor wave.

Hydration must prove the value of the normalized model:

- reading a Mission can materialize its related Stages and Tasks from modeled relations;
- reading a Task can materialize its Stage or owning Mission as needed;
- equivalent relation-aware reads can be defined for any other Entity family once its storage schema is normalized;
- reading derived graph domains such as code intelligence must use explicit node/edge structure rather than reconstructing graph meaning from generic flat tables;
- relation-aware reads remain bounded and deterministic.

## Code Intelligence Graph Direction

The repository code-intelligence store is part of this refactor surface.

Current direction is insufficient when graph-shaped data is persisted as ordinary normal tables such as `code_relation` with string foreign keys only. The target direction is:

- canonical schemas for code-intelligence graph nodes and edges;
- generated DDL for those schemas through `zod-surreal` model definitions;
- explicit graph structure where node families such as files or symbols persist as nodes and relationship families persist as edges;
- relation semantics expressed structurally in schema metadata instead of being inferred only in query code.

This does not require runtime query enrichment in the Entity factory. It does require that the persisted code-intelligence graph stop modeling graph links as ordinary normal tables once this refactor wave reaches that domain.

## Contract And Invocation Direction

This refactor pairs with transport normalization.

- instance methods must be addressed by canonical Entity `id`;
- class-versus-instance execution remains declared in the contract;
- compatibility-era self locators must be retired for instance addressing;
- transport must carry the target Entity `id` separately from method payload schemas;
- relation references remain explicit in payloads only when the method truly needs them.

Normative invocation rules:

- the transport envelope must expose `id?: string` beside `entity`, `method`, and `payload`;
- `id` is required when the selected contract method executes on an Entity instance;
- `id` is forbidden for class-executed methods;
- payload schemas validate method-specific input only and must not repeat the target Entity's own identity;
- legacy locator payloads may remain only for class-scoped selectors or methods whose behavior genuinely needs relation or owner references beyond the target Entity itself.

Validation must happen before method invocation. A dispatcher that cannot resolve the Entity contract and method execution mode must reject the request rather than guessing whether `id` belongs in payload or envelope.

## Validation

Implementation must prove at least:

- schema-level canonical id usage for targeted Entity families;
- schema and contract audits prove no schema aliases, type aliases, import aliases, remote schema maps, unnecessary method-specific input/result schemas, or `Projection`-named Entity shapes remain in the targeted refactor surface;
- description audits prove every schema, field, nested field, enum, union member, method payload/result schema, event schema, acknowledgement schema, descriptor schema, table, relation, reference, and index carries meaningful documentation metadata;
- zod-surreal metadata models references and relation tables on storage schemas;
- generated SurrealQL compiles from registry-backed model definitions;
- Surreal adapter round-trips canonical string ids;
- targeted hydrated reads can assemble child Entity data from modeled relations;
- code-intelligence schemas generate DDL for graph nodes and edges rather than persisting graph links as generic normal tables;
- no parent storage schema persists first-class child Entity arrays as canonical storage;
- transport rejects instance invocations that omit `id` and rejects class invocations that provide one;
- table assignment resolves each targeted Entity family to its required canonical table in the one-database topology;
- opening the store for Repository, Mission, Task, Artifact, AgentExecution, and code-intelligence operations resolves the same canonical database path `<repository-root>/.open-mission/database/`;
- `Stage` persistence does not turn stage status into independently authored state.

## Architecture Assessment Findings

This spec is implementation-ready only if the implementation work treats the following as blockers rather than cleanup notes:

- embedded first-class child arrays in any `<Entity>StorageSchema` block Surreal readiness;
- duplicated self identity fields such as `missionId`, `taskId`, `artifactId`, or `agentExecutionId` block Surreal readiness unless they are explicitly relation references or renamed domain keys;
- method payloads that locate the target instance instead of using envelope `id` block transport normalization;
- method-specific input/result schemas that wrap an existing canonical schema block contract readiness;
- schema aliases, schema-inferred type aliases, import aliases, and remote schema maps block schema readiness;
- `Projection`-named schemas, types, methods, files, transforms, or contract results block Entity readiness;
- missing Zod `.meta({ description })` metadata or missing zod-surreal descriptions for tables, relations, references, fields, or indexes block schema readiness;
- raw Surreal writes outside EntityFactory or State store transaction seams block ADR-0003.03 compliance;
- generic Entity infrastructure importing concrete Entity registries or contracts blocks ADR-0001.07 compliance;
- handwritten DDL or parallel Surreal-only schemas block ADR-0001.02 and ADR-0001.04 compliance.

## Recommended Execution Order

1. Introduce the registry shape and move manual catalogues behind it.
2. Normalize canonical identity in the first targeted Entity family schemas.
3. Refactor storage schemas to remove embedded first-class child Entity arrays.
4. Add zod-surreal references and relation metadata.
5. Implement factory-owned bounded relation-aware hydrated reads.
6. Move code-intelligence storage from normal-table graph approximations to canonical node/edge schemas with generated DDL.
7. Normalize Entity transport and instance addressing by canonical id.
8. Remove compatibility-era locator and embedding paths.
