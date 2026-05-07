---
layout: default
title: Semantic Model
parent: Architecture
nav_order: 3
description: The domain concepts that should stay stable in code and docs.
---

Mission uses a small domain vocabulary on purpose.

| Concept | Meaning |
| --- | --- |
| Mission | Long-lived unit of engineering work |
| Running Mission instance | Live daemon-owned Mission Entity |
| Mission workflow definition | Repository-owned workflow law |
| Mission task | Executable unit of Mission work |
| Mission artifact | Tracked operator-facing file |
| Agent execution | Daemon-managed runtime execution |
| Entity | Daemon-addressable domain object with behavior |

When code or docs need a new term, add it to CONTEXT.md or reuse an existing one. Stale synonyms make the architecture harder to operate.
