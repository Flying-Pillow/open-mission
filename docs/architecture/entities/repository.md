---
layout: default
title: Repository Entity
parent: Entity Reference
nav_order: 2
---

# Repository Entity

`Repository` represents a local checked-out Git repository used by the Open Mission system as the source of repository control state and Mission worktrees.

## Contract

- Class: `packages/core/src/entities/Repository/Repository.ts`
- Schema: `packages/core/src/entities/Repository/RepositorySchema.ts`
- Contract: `packages/core/src/entities/Repository/RepositoryContract.ts`

## Owns

- Repository identity derived from the repository root.
- Repository settings document handling under `.mission/`.
- Repository initialization and setup behavior.
- Mission preparation entry points.
- Repository-scoped AgentExecution launch and management entry points when repository work is not tied to a Mission.

## Does Not Own

- Mission workflow law.
- AgentExecution lifecycle after launch.
- GitHub provider protocol details; those belong behind adapters.

## Relationships

- Hosts Mission dossiers.
- Roots file-backed Artifacts.
- Can scope Repository-level AgentExecutions.
