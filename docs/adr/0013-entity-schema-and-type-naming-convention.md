---
layout: default
title: Entity Schema And Type Naming Convention
parent: Architecture Decisions
nav_order: 13
status: accepted
date: 2026-05-04
decision_area: entity-schema
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Entity schema and type names must be mechanically predictable. Every exported Zod schema is named with a `Schema` suffix. The exported TypeScript type inferred from that schema is named by replacing only the final `Schema` suffix with `Type`. For example, `RepositorySchema` is the Zod schema and `RepositoryType` is `z.infer<typeof RepositorySchema>`. `RepositoryListPayloadSchema` becomes `RepositoryListPayloadType`, and `RepositoryPlatformRepositorySchema` becomes `RepositoryPlatformRepositoryType`.

Entity remote method payload and result schema selection is owned by `<Entity>Contract.ts`. Schema modules own the named Zod shapes themselves. Contracts bind methods to those shapes; they must not invent method-specific result names when a method returns an existing domain shape. For example, a Mission method that returns the complete Mission Entity uses `MissionSchema` as its result rather than introducing `MissionReadResultSchema`, `MissionCreateResultSchema`, or `MissionResultSchema`. Schema modules must not export parallel remote schema maps such as query-input, command-input, query-result, or command-result lookup objects because they duplicate contract metadata and drift from the canonical method contract.

This convention is non-negotiable for Entity schemas on both daemon/core and Airport/client sides. If a shape is validated by Zod, the schema export owns the name. If a TypeScript type represents that validated shape, it must be inferred from the schema with `z.infer`; it must not be hand-written beside the schema, widened by an interface, or renamed into a domain-specific synonym. The schema name carries the domain role. The inferred type name is a mechanical consequence of the schema name.

Schema and type aliasing is forbidden. Code must not define aliases such as `RepositoryOtherType = RepositoryType`, and imports must not rename canonical schemas or types, such as `import { RepositoryType as RepositorySnapshot } from "..."`. If Mission needs a distinct domain shape, it must receive its own explicitly named Zod schema and inferred `Type` pair in the owning schema module. A different name means a different schema-backed concept, not an alias for an existing one. The general clean-sheet rule for aliases, fallbacks, and backward compatibility is recorded in ADR-0000.

`EntityStorageSchema` is the parent schema for canonical persisted Entity storage records. Any schema that represents a physically stored Entity record, such as `MissionStorageSchema`, `TaskStorageSchema`, `StageStorageSchema`, or `ArtifactStorageSchema`, extends `EntityStorageSchema` instead of redeclaring the `id` field locally. Entity identity is therefore inherited from the Entity boundary and not copied into each storage schema as parallel structure.

`EntitySchema` is the parent schema for canonical hydrated Entity objects exposed by the domain boundary. It extends `EntityStorageSchema` and adds shared hydrated Entity material such as `commands`. Any thick Entity schema, such as `MissionSchema`, extends `EntitySchema` and may specialize the shared hydrated fields only when it is composing child Entity schemas. Hydrated Entity fields are not storage fields and must not be accepted by `<Entity>StorageSchema`.

For thick Entities, `<Entity>InputSchema` names the daemon-validated input required to create or register a new Entity. `<Entity>StorageSchema` names the daemon-owned persisted/runtime record physically stored on disk or in the daemon state store. `<Entity>Schema` names the canonical complete hydrated Entity instance exposed by the domain boundary, including persisted fields, derived fields, related Entity data, workflow read material, and `commands`. The inferred `<Entity>Type` belongs to `<Entity>Schema`; narrower enum or classifier schemas must use their own mechanical names, such as `MissionEntityTypeSchema` and `MissionEntityTypeType`, rather than occupying `MissionType`.

Method-specific input schemas are distinct from `<Entity>InputSchema`. They use explicit names such as `TaskStartInputSchema`, `MissionWriteDocumentInputSchema`, or `RepositoryStartMissionFromBriefSchema`, and they are bound to remote methods by `<Entity>Contract.ts`. They must not be treated as the Entity creation input schema.

`SnapshotSchema` and `SnapshotType` names are subject to the same rule. They are valid only when the schema validates a distinct point-in-time read model, such as a terminal snapshot or state-store snapshot. They must not wrap, rename, or re-export an Entity's canonical schema. When an Entity event carries a transitional child Entity data shape, the schema and payload may use `DataChanged`, `data`, and `data.changed`, and the `data` field validates that child Entity data schema. When an Entity event carries the complete hydrated Entity, the schema field uses the Entity name and validates `<Entity>Schema`; for example, `MissionChangedEventSchema` emits `mission.changed` with a `mission` field validated by `MissionSchema`.

Workflow-engine schemas and types use workflow vocabulary. They must not use `Mission*` as a product prefix for workflow-owned concepts; for example, use `WorkflowRuntimeStateSchema`, `WorkflowRequest`, `WorkflowEvent`, and `WorkflowConfigurationSnapshot` rather than `MissionWorkflowRuntimeStateSchema`, `MissionWorkflowRequest`, `MissionWorkflowEvent`, or `MissionWorkflowConfigurationSnapshot`. References to the Mission Entity from the workflow engine remain explicit Mission Entity imports rather than aliases.

Entity files keep strict ownership. `<Entity>Schema.ts` owns all Entity-based Zod schemas and their exported inferred TypeScript types. `<Entity>Contract.ts` owns Entity contract metadata only: remote method payload schemas, result schemas, execution mode, events, and UI presentation metadata. `<Entity>.ts` owns the Entity class implementation, including behavior, invariants, identity handling, data lifecycle, and remote method targets. Concrete Entity classes extend the abstract `Entity` base class.

Repository and its platform-backed repository-ref shapes are the first naming cleanup targets for this decision. Their daemon/core classes and Airport/client usage must converge on the same canonical schema/type names rather than preserving mixed names such as snapshot-style aliases, GitHubRepository holdovers, or domain-specific inferred type names that do not directly mirror a schema export.

This decision deepens the Entity schema interface by making validation, TypeScript inference, remote contracts, persistence mapping, and client imports point at one canonical name pair. It also keeps future refactors local: changing the shape of an Entity payload means changing the owning schema and its inferred type, not chasing aliases or renamed imports across daemon and Airport modules.
