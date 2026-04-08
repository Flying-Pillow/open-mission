---
layout: default
title: Mission
nav_order: 1
---

# Mission

> WARNING
> This repo is in its very early stages. Do not use it yet.

Mission is the orchestration engine for AI-driven software development.

Mission is a local state machine and governance layer that sits between your issue tracker and your AI coding agents. It brings predictability, architectural strictness, and deterministic verification to AI-assisted development.

If you have ever spent hours untangling AI-generated spaghetti code or fighting context rot in a long chat session, Mission provides the structural guardrails to make AI development safe, scalable, and maintainable.

## The Problem

AI coding agents generate code quickly, but they do not naturally preserve architecture.

Left unmanaged, they tend to:

- bypass design patterns and object ownership boundaries
- modify out-of-scope files
- lose context across long sessions
- require constant human micromanagement

The result is fast delivery with hidden technical debt.

## The Solution

Mission acts as air traffic control for your repository.

It does not replace your AI agents. It governs them.

By shifting the workflow from prompt-driven to spec-driven, Mission constrains the AI to one bounded unit of work at a time and checks its progress against explicit repository rules and real verification gates.

## Core Capabilities

- Architectural governance through repository-specific rules and operating constraints.
- Isolated git worktrees so active missions do not corrupt the control checkout.
- Spec-driven execution instead of freeform chat-driven coding.
- Deterministic CI gating so agents cannot self-certify completion.
- Agent-agnostic orchestration across multiple coding backends.
- A persistent cockpit and daemon model for long-running supervised work.

## Documentation Map

Mission uses its own semantic language as the documentation structure:

- [Flight Manual](flight-manual/index.md): how to read the system and navigate the docs.
- [Airport](airport/index.md): the daemon-wide control plane and top-level application orchestration.
- [Mission](mission/index.md): the semantic model, workflow engine, runtime, and repository settings model.
- [Cockpit](cockpit/index.md): the operator-facing surface and control contract.
- [Reference](reference/index.md): supporting examples and future stable reference material.
- [Missions](missions/index.md): temporary in-flight design and delivery dossiers while the system is still being built.

## Current State

The stable product-facing sections above are the intended long-term home of the documentation.

For now, the detailed authoritative design work lives under the current mission dossier:

- [Airport Spec Mission](missions/airport-spec/index.md)

That separation is intentional. It keeps in-progress design artifacts distinct from the finished-system documentation that will eventually replace them.

## Quick Start

Install Mission globally:

```bash
npm install -g @flying-pillow/mission
```

Initialize a repository:

```bash
mission init
```

Launch the cockpit:

```bash
mission
```
