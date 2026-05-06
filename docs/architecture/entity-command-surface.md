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

This keeps Airport thin. The surface renders commands; Entity classes decide what commands mean.

Agent executions do not receive a separate agent-only command vocabulary. Surfaces present daemon-published Entity command views, and Agent terminal output may only make advisory state claims through strict Mission protocol markers.
