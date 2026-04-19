---
layout: default
title: Target Platform Inventory
parent: Airport Workstream
nav_order: 3
---

# Target Platform Inventory

This document defines the final target platform inventory for Mission after the Airport migration away from the terminal-first surface.

It is normative.

It assumes a clean break.

It defines the intended end-state platform stack, not a compatibility bridge.

## Status

This is a design specification.

It records the target stack that future implementation must converge on.

If a current tool, package, runtime, script, or surface conflicts with this document, that current implementation is transitional and must be replaced or removed.

## Decision Rule

Mission optimizes for:

- one authoritative daemon runtime
- one shared Airport application across web and native
- one clean workspace and toolchain strategy
- minimal tool layering
- no fallback architecture kept alive as a long-term crutch
- smart testing and workspace execution without preserving legacy tooling just because it already exists

Mission does not optimize for ideological purity around one JavaScript runtime.

The hard rule is architectural clarity, minimal tooling, and operational coherence.

## Final Target Layers

The final target stack is:

| Layer | Target choice | Role |
| --- | --- | --- |
| Workspace package management | pnpm workspaces | Root workspace discovery, dependency installation, lockfile management |
| Workspace runtime scripts | Node.js + pnpm | Running repository scripts and TypeScript entrypoints |
| Frontend toolchain | Vite+ | Unified frontend dev, check, test, build, pack, and task execution |
| Web application framework | SvelteKit | Web host and server/client application shell |
| UI framework | Svelte 5 | Shared Airport UI implementation |
| Native host | Tauri v2 | Desktop host, capabilities, packaging, and secure native bridge |
| Native systems language | Rust stable | Tauri commands, native integrations, filesystem/process/window capabilities |
| Frontend testing | Vite+ test runner | Unit, component, and frontend integration tests through `vp test` |
| Fast JS/TS linting | Oxlint through Vite+ | High-speed general JavaScript and TypeScript linting |
| Fast formatting | Oxfmt through Vite+ | Repository formatting for supported file types |
| Svelte-specific linting | ESLint + eslint-plugin-svelte | `.svelte` markup and framework-specific lint coverage |
| Backend authority | missiond | Canonical runtime and state authority |
| Projection layer | packages/airport | UI-facing projection over daemon and repository state |

## Runtime Policy

Mission's runtime policy is:

- Node.js is the JavaScript and TypeScript runtime for repository scripts and application code.
- pnpm is the workspace package manager and script launcher.
- The frontend toolchain may layer on top of Node.js where Vite+ expects that model.

Mission is committed to the smallest coherent toolchain that supports the final architecture.

## Workspace Strategy

The workspace strategy is:

- pnpm-managed monorepo
- root `package.json` is the workspace definition source
- `pnpm-workspace.yaml` defines the workspace package graph
- `pnpm-lock.yaml` is the authoritative package lock
- workspace-local packages continue to use `workspace:*` dependency links

pnpm remains the workspace package-management authority.

Vite+ remains the frontend and frontend-task authority.

Those roles are intentionally separate.

The target workspace files are therefore:

- root `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`

## Frontend Toolchain Strategy

Vite+ is the target frontend toolchain authority.

Vite+ owns:

- frontend development server
- frontend build pipeline
- frontend test execution
- fast linting and formatting
- frontend package-local and workspace-aware task execution where Vite+ is the right boundary

In the implemented repository, that means frontend-facing scripts should invoke `vp` directly instead of treating `vite`, `vitest`, `oxlint`, or `oxfmt` as operator-facing primary entrypoints.

Vite+ is chosen because it unifies:

- Vite
- Rolldown
- Vitest as an internal Vite+ subsystem
- Oxlint
- Oxfmt
- tsdown
- Vite Task

That reduces tool sprawl and keeps the frontend surface fast.

## Svelte Linting Exception

Vite+ plus Oxlint does not fully replace Svelte-specific linting.

Current policy:

- use Oxlint for JavaScript, TypeScript, and script-block linting at high speed
- use ESLint plus `eslint-plugin-svelte` only for `.svelte` framework and markup-specific lint coverage

This is an intentional exception.

It is allowed because it closes a real capability gap rather than preserving legacy tooling out of habit.

## Application Host Strategy

Mission's operator product is one shared Airport application with two final hosts:

1. `apps/airport/web`
2. `apps/airport/native`

### Web host

The web host uses:

- SvelteKit
- Svelte 5
- Vite+-managed frontend toolchain

The web host may use SvelteKit server facilities such as remote functions where they fit the web application boundary.

### Native host

The native host uses:

- Tauri v2
- Rust stable
- the shared Svelte application as its frontend

The native host owns:

- windowing
- packaging
- native capability exposure
- secure bridging to OS-specific features
- native filesystem/process/notification integrations where needed

## Backend Strategy

The backend remains:

- one daemon
- one authority
- one projection layer

That means:

- `missiond` stays authoritative for mission, workflow, session, and airport control state
- `packages/airport` stays the shared projection layer
- web and native remain clients or bounded host facades over that authority

## Testing Strategy

Smart testing remains a hard requirement.

The removal of Turbo does not remove the requirement for:

- workspace-aware execution
- dependency-aware task ordering
- changed-package or affected-package test selection
- cacheable build and test execution

The final stack therefore requires a replacement testing strategy that provides:

- package-scoped test commands
- dependency-aware workspace task execution
- affected-run capability in CI
- deterministic caching behavior

Vite+ is the default candidate for this responsibility on the frontend side.

If additional repository graph logic is required for backend and shared packages, that logic must be built explicitly rather than reintroducing Turbo by default.

## Retired Layers And Surfaces

The following are not part of the final target platform:

- the Airport terminal surface as a product direction
- terminal-first layout constraints as a primary design driver
- `mission.sh`
- `mission.cmd`
- Turbo as the long-term workspace task authority

## Transitional Rule

Some of these layers may still exist during migration.

That does not make them part of the target platform.

The rule is:

- transitional code may exist temporarily
- transitional code must not be treated as a supported end-state layer
- no migration should preserve the terminal surface or Turbo as long-term fallbacks merely because removing them is inconvenient

## Final Inventory Summary

The final target platform is therefore:

- pnpm-managed monorepo workspaces
- root `package.json` plus `pnpm-workspace.yaml`
- pnpm lockfile
- Vite+ as the frontend toolchain
- SvelteKit as the web application framework
- Svelte 5 as the shared UI layer
- Tauri v2 plus Rust stable as the native host
- missiond as the backend authority
- packages/airport as the shared projection layer
- Oxlint and Oxfmt for high-speed general lint and format
- ESLint plus `eslint-plugin-svelte` for `.svelte`-specific lint coverage
- smart workspace-aware test execution retained as a mandatory property of the new stack

Anything that keeps the terminal surface, Turbo, or shell-wrapper launchers as permanent parts of the product is not the target platform.
