---
layout: default
title: Stage Entity
parent: Entity Reference
nav_order: 4
---

# Stage Entity

`Stage` represents a Mission workflow phase derived from workflow task progress.

## Contract

- Class: `packages/core/src/entities/Stage/Stage.ts`
- Schema: `packages/core/src/entities/Stage/StageSchema.ts`
- Contract: `packages/core/src/entities/Stage/StageContract.ts`

## Owns

- Stage identity within a Mission.
- Stage display/status data derived from workflow state.
- Stage-level command availability when exposed through the Entity contract.

## Does Not Own

- Workflow law; that belongs to the Mission workflow definition applied by Mission.
- Task lifecycle transitions.
- Artifact file identity.

## Relationships

- Belongs to one Mission.
- Groups Tasks.
- Relates Stage-level Artifacts.
