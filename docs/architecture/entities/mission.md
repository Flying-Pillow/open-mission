---
layout: default
title: Mission Entity
parent: Entity Reference
nav_order: 3
---

# Mission Entity

`Mission` is the daemon-owned authoritative aggregate for one live Mission. It coordinates workflow state, child Entity data, AgentExecution participation, gates, and delivery readiness.

## Contract

- Class: `packages/core/src/entities/Mission/Mission.ts`
- Schema: `packages/core/src/entities/Mission/MissionSchema.ts`
- Contract: `packages/core/src/entities/Mission/MissionContract.ts`

## Owns

- Mission identity, descriptor, lifecycle, and Mission dossier state.
- Mission workflow application through the repository-owned Mission workflow definition.
- Coordination of Stage, Task, Artifact, and AgentExecution references.
- Workflow event application and Mission status/control data assembly.

## Does Not Own

- AgentExecution process lifecycle after AgentExecution is active.
- Terminal screen state or terminal input.
- File identity for Artifacts.
- Provider-specific Agent behavior.

## Relationships

- Belongs to one Repository.
- Coordinates many Stages and Tasks.
- Relates many Artifacts as Mission, Stage, or Task artifacts.
- References AgentExecutions by canonical AgentExecution data and scope. Mission does not define a Mission-specific AgentExecution record or owner view.
