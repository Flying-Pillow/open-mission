---
layout: default
title: Artifact Entity
parent: Entity Reference
nav_order: 6
---

# Artifact Entity

`Artifact` is a file-backed operator-facing file rooted at one filesystem root and relative path.

## Contract

- Class: `packages/core/src/entities/Artifact/Artifact.ts`
- Schema: `packages/core/src/entities/Artifact/ArtifactSchema.ts`
- Contract: `packages/core/src/entities/Artifact/ArtifactContract.ts`

## Owns

- Artifact identity from file root and path.
- Artifact body reads and writes through the Artifact Entity contract.
- Artifact metadata needed for presentation and file access.

## Does Not Own

- Mission-only document identity.
- AgentExecution context ordering.
- Workflow stage or task lifecycle.

## Relationships

- Can be related to Repository, Mission, Stage, Task, or AgentExecution context.
- Can scope focused artifact-level AgentExecution work.
