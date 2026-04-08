---
layout: default
title: Flight Manual
nav_order: 2
---

# Flight Manual

The flight manual explains the system as a whole.

It is not a guide to the documentation set. It is a guide to how Mission is structured and how to approach the system.

## System Orientation

Mission is organized around a small set of stable system concepts:

- `Airport`: the top-level control plane and application orchestration layer
- `Mission`: the semantic core, workflow model, and runtime state
- `Cockpit`: the operator-facing surface and control contract
- `Reference`: supporting examples and stable lookup material
- `Current Mission`: the active in-flight design dossier while the product is still being built

## Reading Path

1. [Overview](../index.md)
2. [Airport](../airport/index.md)
3. [Mission](../mission/index.md)
4. [Cockpit](../cockpit/index.md)
5. [Current Mission](../missions/index.md)

## Why There Is A Current Mission Section

Mission is still being built.

That means we need a temporary separation between:

- documentation of the intended finished system
- active design and delivery artifacts required to build that system

The current mission section holds the authoritative working specification set until Mission can publish stable delivered documentation through its own intended workflow.
