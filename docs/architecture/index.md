---
layout: default
title: Architecture
nav_order: 5
has_children: true
description: The current Mission architecture in daemon, Entity, Airport, workflow, and adapter terms.
---

Mission is built around strict ownership:

- **Entity classes** own domain behavior and invariants.
- **Entity schemas** own validated payload, storage, and data shapes.
- **Entity contracts** expose daemon-readable method metadata.
- **The daemon** owns runtime state, command dispatch, and agent coordination.
- **Airport** is a surface over daemon-owned state.
- **Adapters** translate external systems into Mission concepts.

Read [System Context](system-context.md), [Semantic Model](semantic-model.md), and [Entity Command Surface](entity-command-surface.md) first. ADR-0012 is the key architectural decision behind the current OOD model.
