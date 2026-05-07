---
layout: default
title: Airport Application Host Boundaries
parent: Architecture Decisions
nav_order: 20
status: accepted
date: 2026-05-06
decision_area: airport-application-boundaries
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission has one authoritative backend runtime: `missiond`. Airport surfaces are daemon clients; they do not own Mission truth, workflow truth, repository truth, Agent execution truth, or command semantics.

Mission has one Airport application model. `packages/airport` owns Airport-facing application models, view contracts, and state shaping over daemon truth. It is not a Svelte package, a Tauri plugin layer, a browser state store, or a host compatibility package.

Mission exposes these Airport hosts over that one application model:

1. `apps/airport/web` for the SvelteKit web host and web-specific backend facade
2. `apps/airport/native` for the Tauri native host

The web and native hosts are not separate products. They must share the Airport route model, component model, application state model, query semantics, command semantics, and subscription semantics unless a feature is inherently host-specific. Host-specific APIs sit behind adapters.

The SvelteKit backend is a backend-for-frontend for browser delivery. It may own remote functions, request-scoped web orchestration, web subscription endpoints, and optional web session concerns. It is not the canonical system boundary and must not replace daemon or Airport contracts.

The native host owns native packaging, windowing, permissions, native capability wiring, and native daemon launch or supervision when needed. It should prefer direct daemon RPC or a thin Tauri bridge for core application data and commands when practical. It must not redefine business actions, Airport pane view rules, or Airport semantics.

The shared UI must depend on an abstract Airport application client with query, command, and subscription capabilities. It must not depend directly on `fetch`, SvelteKit remote functions, Tauri APIs, or terminal substrate APIs for domain behavior.

Repository package boundaries follow from this decision:

- `packages/core` must not absorb UI framework code.
- `packages/airport` must not absorb renderer-specific framework code.
- `apps/airport/web` must not become the daemon authority.
- `apps/airport/native` must not become a second frontend implementation.

New Airport work must converge on one shared Airport application model with host adapters rather than preserving host-specific application forks.
