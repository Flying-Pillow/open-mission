---
layout: default
title: Entity
parent: Entity Reference
nav_order: 1
---

# Entity

`Entity` is the abstract base for first-class Mission domain objects. It owns shared mechanics only: canonical `id`, clone-protected data access, command descriptor support, remote method dispatch conventions, and common storage/data schema parents.

## Contract

- Class: `packages/core/src/entities/Entity/Entity.ts`
- Schema: `packages/core/src/entities/Entity/EntitySchema.ts`
- Remote registry: `packages/core/src/entities/Entity/EntityRemote.ts`

## Ownership

`Entity` does not own Mission, Repository, Task, Artifact, AgentExecution, Terminal, or System behavior. Concrete Entity classes own their own invariants and state transitions.

## Schema Roles

- `EntityStorageSchema`: canonical persisted base with `id`.
- `EntitySchema`: hydrated base that extends storage with shared surface material such as `commands`.
- `EntityContractType`: declarative method/event/schema binding shape.

## ERD Placement

Every concrete Entity specializes `Entity`. If a domain object needs identity, behavior, storage, and a remote contract, it should appear as a concrete Entity in the ERD.
