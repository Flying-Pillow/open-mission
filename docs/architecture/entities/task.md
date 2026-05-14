---
layout: default
title: Task Entity
parent: Entity Reference
nav_order: 5
---

# Task Entity

`Task` is an executable unit of Mission work with instructions, dependencies, lifecycle state, and optional AgentExecution participation.

## Contract

- Class: `packages/core/src/entities/Task/Task.ts`
- Schema: `packages/core/src/entities/Task/TaskSchema.ts`
- Contract: `packages/core/src/entities/Task/TaskContract.ts`

## Owns

- Task identity within a Mission.
- Task instruction data and dependency-facing state.
- Task command availability and task-owned transition requests.
- Launch intent for task-scoped AgentExecutions.

## Does Not Own

- AgentExecution lifecycle after launch.
- AgentExecution prompt, command, cancellation, completion, or terminal behavior.
- Mission-wide workflow gate legality.

## Relationships

- Belongs to one Mission and usually one Stage.
- Uses Task-level Artifacts.
- May initiate and reference task-scoped AgentExecutions through canonical AgentExecution data.
