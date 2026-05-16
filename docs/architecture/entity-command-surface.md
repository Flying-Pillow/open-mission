---
layout: default
title: Entity Command Surface
parent: Architecture
nav_order: 10
description: How Entity classes expose operator commands through contracts and command views.
---

Entity commands are the canonical operator surface.

A concrete Entity class owns behavior. Its schema module owns validated shapes. Its contract module describes remote methods, payload schemas, result schemas, execution mode, events, and UI presentation metadata.

Command views are read results. They advertise what is currently available for a target Entity or Entity class. They are not stored inside Entity data.

## Ownership Rule

| File | Owns |
| --- | --- |
| Entity.ts | behavior, invariants, identity, remote method targets |
| EntitySchema.ts | Zod schemas and inferred TypeScript types |
| EntityContract.ts | method metadata and routing contract |

This keeps Open Mission thin. The surface renders commands; Entity classes decide what commands mean.

## Dependency Direction

Entity inheritance has a strict dependency direction. Generic Entity infrastructure is a parent abstraction and must not import concrete Entity children, concrete Entity contracts, daemon registries, runtime services, adapters, terminal runtime modules, code intelligence services, or provider implementations.

The allowed direction is:

```text
daemon / host / adapter layer
 -> Entity contracts
 -> concrete Entity classes
 -> Entity schemas
 -> generic Entity infrastructure
```

Concrete contract catalogues, daemon capability injection, registry lookup, and post-command runtime behavior belong in daemon-owned dispatch modules. They do not belong in `entities/Entity` generic infrastructure.

`EntityExecutionContext` is an invocation envelope. It is not a daemon service locator. The base Entity module may define generic invocation fields only; daemon-owned capabilities must be attached and validated at daemon or concrete Entity seams without making the base class import daemon types.

Agent executions do not receive a separate agent-only command vocabulary. Surfaces present daemon-published Entity command views, and Agent terminal output may only make advisory state claims through strict Mission protocol markers.
