---
layout: default
title: Contracts And State Surfaces
parent: Architecture
nav_order: 9
description: The validated contracts that connect daemon, Airport, state, and adapters.
---

Mission favors explicit contracts over tolerated shapes.

- Zod v4 schemas validate persisted and externally accepted data.
- TypeScript data types are inferred from those schemas.
- Entity contracts bind method metadata to Entity classes.
- State store transactions are the canonical write interface for accepted state.
- Airport consumes published schemas, snapshots, events, and command views.

Compatibility shims, fallback parsers, and silent normalization are rejected unless an ADR records the exception.
