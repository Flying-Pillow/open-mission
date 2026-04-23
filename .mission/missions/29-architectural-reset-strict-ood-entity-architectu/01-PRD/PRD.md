---
title: "PRD: #29 - Architectural Reset: Strict OOD Entity Architecture For Airport And Daemon"
artifact: "prd"
createdAt: "2026-04-22T14:54:07.971Z"
updatedAt: "2026-04-22T20:15:35.416+00:00"
stage: "prd"
---

Branch: mission/29-architectural-reset-strict-ood-entity-architectu

## Outcome

- Reset the Airport and Daemon architecture so the Daemon/Core becomes the single authoritative home for backend entities, business logic, and shared contracts.
- Establish a strict object-oriented entity model built around the first-class entities `Repository`, `Mission`, `Stage`, `Task`, `Artifact`, and `AgentSession`, with clear interfaces and system responsibilities.
- Make the frontend adhere to the same OOD structure by representing the selected repository, mission, stage, task, artifact, and agent-facing application objects as first-class class instances rather than raw transport payloads.
- Introduce a singleton `appContext` as the application container for the active frontend entity instances, so components work against object interfaces instead of transport details.
- Make SvelteKit remote functions the required RPC boundary for commands, queries, and forms, with backend communication executed by entity instances through first-class remote function calls rather than by components.

## Problem Statement

- The current system does not yet enforce a strict entity-centered architecture across the Daemon/Core and Airport web surfaces, which allows business rules, state shaping, and helper logic to drift into layers that should not be authoritative.
- When the frontend, route handlers, or ad hoc helpers participate in domain decisions, the product becomes harder to reason about, more brittle to extend, and more likely to expose inconsistent shapes for the same underlying concepts.
- The frontend currently risks drifting into direct backend communication patterns or raw data orchestration, which breaks the intended OOD boundary and makes component behavior dependent on transport details instead of entity interfaces.
- Without an explicit application container and remote-call contract, components can bypass the entity model, talk to backend surfaces directly, or couple themselves to request mechanics instead of to stable object-oriented interfaces.
- The reference architecture in `/repositories/Flying-Pillow/flying-pillow/apps/app` demonstrates that SvelteKit remote functions can provide an RPC-style server boundary for commands, queries, and forms while keeping that transport logic inside entity classes rather than inside UI components.
- `mission.json` is a storage format rather than a client-facing contract, but without an explicit architectural reset there is a risk that storage-oriented representations and legacy patterns continue to leak into runtime interfaces.
- The mission needs a clean break from legacy compatibility concerns so the codebase can converge on one coherent OOD entity architecture instead of carrying aliases, fallbacks, and historical accommodations forward.

## Success Criteria

- The Daemon/Core defines and owns the mandatory first-class entities `Repository`, `Mission`, `Stage`, `Task`, `Artifact`, and `AgentSession`, each with clear interfaces and responsibilities.
- Shared contracts exposed across system boundaries are entity-shaped and align directly with the authoritative Daemon/Core model rather than with storage documents or route-local convenience types.
- Airport web mirrors the same OOD structure in its application-facing model so selected repository, mission, stage, task, artifact, and agent-facing state are represented as class instances rather than loose data blobs.
- A singleton `appContext` serves as the application container and component-facing boundary, holding the active instances for the selected repository, mission, stage, task, artifact, and agent-facing objects.
- UI components interact only with `appContext` and the entity instances it owns; components do not call backend endpoints, remote functions, or transport helpers directly.
- Each frontend entity class owns its own backend-backed behavior, including command, query, and form interactions, instead of delegating generic orchestration responsibility back into components.
- SvelteKit remote functions are used as first-class RPC-style server entrypoints for commands, queries, and forms, and those remote functions are invoked by entity class methods rather than by presentation components.
- The frontend architecture does not collapse into a generic service layer; object instances remain the primary interface through which application behavior reaches the backend.
- The implementation clearly reflects the reference architecture in `/repositories/Flying-Pillow/flying-pillow/apps/app`, especially its use of a singleton application container, first-class client entity instances, and entity-owned SvelteKit remote command/query/form calls.
- Business logic is centralized in Daemon/Core entity methods or services instead of being scattered across routes, helpers, or frontend state management.
- System behavior no longer depends on legacy configuration support, backward-compatibility shims, aliases, or fallback entity patterns.
- API responses and frontend state interactions reflect the new entity architecture consistently enough to support end-to-end mission lifecycle flows from mission creation through artifact generation using only the new model.
- The resulting codebase and supporting documentation clearly describe and embody the strict OOD entity architecture as the new default system design.

## Constraints

- Use `BRIEF.md` for this mission as the canonical intake source and keep this PRD aligned with that architectural direction.
- Treat the Daemon/Core as the sole authoritative backend boundary for domain entities, business rules, and shared contracts.
- Treat the SvelteKit web layer as transport and presentation only; it must not become a second source of truth for domain behavior or entity state.
- The frontend must follow the same OOD entity structure as the backend-facing model rather than collapsing entities into generic stores, plain objects, or route-local view models.
- Client-side entities must map directly to Daemon/Core entities rather than introducing alternate conceptual models.
- Configure `appContext` as a singleton application container that owns the currently selected repository, mission, stage, task, artifact, and agent-facing class instances for the running application session.
- `appContext` is primarily a lifecycle and containment boundary for application state; it should not become a catch-all orchestration service that replaces entity methods.
- Components must use `appContext` as their only interface for backend-backed state access and user-driven actions; direct component-to-backend communication is disallowed.
- Any frontend-to-backend communication must occur through methods on the entity instances held by `appContext`, not through direct calls from components.
- Use SvelteKit remote functions as the standard mechanism for frontend RPC-style communication with the server, separating command, query, and form behaviors explicitly.
- Keep remote function invocation encapsulated inside entity classes or tightly related entity-level abstractions rather than exposing generic transport helpers as the primary UI API.
- Treat `/repositories/Flying-Pillow/flying-pillow/apps/app` as the authoritative reference implementation for the intended frontend OOD/RPC shape, and require implementation work to inspect that module in depth before finalizing architectural decisions.
- The implementation agent must study how the reference app wires its singleton application container, client entity classes, and SvelteKit remote functions so the resulting architecture adheres to the intended design rather than approximating it.
- `mission.json` must not be treated as the client contract; it remains a storage format only.
- Do not preserve legacy architecture through backward-compatibility layers, fallbacks, aliases, or historic configuration accommodations.
- Avoid scattered helpers and route-local business logic; domain behavior must be centralized in the core architecture.

## Non-Goals

- Maintaining backward compatibility with legacy entity shapes, helper patterns, route logic, or historical configuration behaviors.
- Defining client contracts around persistence formats such as `mission.json` instead of the new entity model.
- Delivering a partial architectural cleanup that leaves authority split between the Daemon/Core and the web layer.
- Allowing UI components to communicate with the backend directly or to bypass `appContext` and entity instances for loading, mutation, querying, or form submission.
- Replacing the frontend entity model with a generic RPC service layer in which components orchestrate commands, queries, and forms manually.
- Expanding the mission into unrelated product features beyond the strict OOD reset needed to establish the new entity architecture.
