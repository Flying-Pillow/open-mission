---
layout: default
title: State Schema
parent: Reference
nav_order: 2
description: The main persisted and published state boundaries.
---

Mission state has several owners. Do not collapse them into one generic model.

| State | Owner |
| --- | --- |
| Repository settings document | Repository control state under .mission |
| Mission runtime data | daemon-owned Mission runtime persistence |
| Entity storage records | Mission state store |
| Entity data | hydrated daemon read shape |
| Entity command view | query result advertising available commands |
| Airport preferences | local surface preferences |

Validated state uses Zod v4 schemas and inferred TypeScript types. Invalid persisted runtime data is rejected instead of repaired by fallback parsing.
