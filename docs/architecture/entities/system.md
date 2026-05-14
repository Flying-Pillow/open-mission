---
layout: default
title: System Entity
parent: Entity Reference
nav_order: 10
---

# System Entity

`System` exposes daemon-owned diagnostic status for the Open Mission system.

## Contract

- Class: `packages/core/src/entities/System/SystemStatus.ts`
- Schema: `packages/core/src/entities/System/SystemStatusSchema.ts`
- Contract: `packages/core/src/entities/System/SystemContract.ts`

## Owns

- System status snapshot assembly.
- Dependency readiness and daemon runtime health reporting.
- Runtime supervision summary material for operator diagnostics.

## Does Not Own

- Durable Mission workflow truth.
- AgentExecution lifecycle truth.
- Terminal screen truth.

## Relationships

- Reports status for Repositories, active AgentExecutions, runtime leases, and Terminal health.
- Consumes daemon runtime supervision read models without becoming their owner.
