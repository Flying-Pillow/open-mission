---
layout: default
title: Open Mission App Host Boundaries
parent: Architecture Decisions
nav_order: 20
status: accepted
date: 2026-05-06
decision_area: open-mission-application-boundaries
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission has one authoritative backend runtime: `open-missiond`. Open Mission surfaces are daemon clients; they do not own Mission truth, workflow truth, repository truth, Agent execution truth, or command semantics.

Mission has one Open Mission app model. `packages/app` owns Open Mission-facing application models, view contracts, and state shaping over daemon truth. It is not a Svelte package, a Tauri plugin layer, a browser state store, or a host compatibility package.

Mission exposes these Open Mission native hosts over that one application model:

1. `apps/web` for the SvelteKit web host and web-specific backend facade
2. `apps/native` for the Tauri native host

The web and native hosts are not separate products. They must share the Open Mission app route model, component model, application state model, query semantics, command semantics, and subscription semantics unless a feature is inherently host-specific. Host-specific APIs sit behind adapters.

The SvelteKit backend is a backend-for-frontend for browser delivery. It may own remote functions, request-scoped web orchestration, web subscription endpoints, and optional web session concerns. It is not the canonical system boundary and must not replace daemon or Open Mission contracts.

The native host owns native packaging, windowing, permissions, native capability wiring, and native daemon launch or supervision when needed. It should prefer direct daemon RPC or a thin Tauri bridge for core application data and commands when practical. It must not redefine business actions, Open Mission app pane view rules, or Open Mission semantics.

The shared UI must depend on an abstract Open Mission app client with query, command, and subscription capabilities. It must not depend directly on `fetch`, SvelteKit remote functions, Tauri APIs, or terminal substrate APIs for domain behavior.

Repository package boundaries follow from this decision:

- `packages/core` must not absorb UI framework code.
- `packages/app` must not absorb renderer-specific framework code.
- `apps/web` must not become the daemon authority.
- `apps/native` must not become a second frontend implementation.

New Open Mission work must converge on one shared Open Mission app model with host adapters rather than preserving host-specific application forks.
