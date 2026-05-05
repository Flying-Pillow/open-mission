<!-- /apps/airport/web/src/lib/server/daemon/README.md: Ownership note for the Airport web daemon gateway modules. -->

# Airport Web Daemon Gateway

This folder is the web-only gateway layer over the Mission daemon client exported by `@flying-pillow/mission-core`.

It exists to keep the boundary explicit:

- core owns raw daemon connectivity and protocol compatibility
- daemon process lifecycle belongs to the daemon CLI/dev process, outside the Airport web request path
- Airport web owns SvelteKit request context, daemon availability UX, shared request pooling, EntityRemote proxying, and long-lived web relay behavior

## Module Responsibilities

### `context.server.ts`

Owns request-scoped web context only:

- resolve GitHub auth token from `App.Locals`
- resolve the active surface path for the current web process

This file must not open daemon connections or add recovery policy.

### `transport.server.ts`

Owns raw web-side access to the core daemon connector:

- open one daemon connection using the core client
- return the connected client plus a dispose function

This file must not cache daemon state, pool clients, or interpret request context beyond the explicit input it receives.

### `shared-client.server.ts`

Owns short-lived connection reuse for request-response web flows:

- lease a shared daemon client keyed by surface path and auth token
- keep the shared client alive briefly across adjacent requests
- dispose idle shared clients after the timeout window

This file is for request-path reuse only. It must not own daemon health or user-facing runtime messages.

### `health.server.ts`

Owns web-facing daemon availability state:

- daemon runtime state for hooks and UI bootstrapping
- cached daemon health probes
- cached system status reads for lightweight app context hydration

This file is allowed to shape web-facing availability messages. It must not start, stop, recover, or replace daemon processes.

### `connections.server.ts`

Owns the public daemon entrypoints used by Airport web server code:

- `connectSharedAuthenticatedDaemonClient(...)` for normal gateway request handlers
- `connectDedicatedAuthenticatedDaemonClient(...)` for long-lived or subscription-based flows

This is the module that other Airport web server code should import first.

## Import Rules

- `hooks.server.ts` should import from `health.server.ts` and `context.server.ts`
- request-response gateway code should import from `connections.server.ts` and prefer the shared connection helper
- WebSocket or event-subscription flows should import from `connections.server.ts` and use the dedicated connection helper
- no consumer outside this folder should import from `transport.server.ts` or `shared-client.server.ts` unless it is extending gateway infrastructure deliberately

## Non-Goals

This folder must not:

- redefine daemon business semantics
- create a second daemon API family
- start, stop, supervise, recover, or replace daemon processes
- move repository or mission policy out of core
- make SvelteKit the source of truth for daemon state

The daemon remains the runtime authority. This folder is infrastructure glue for the web surface: EntityRemote calls are relayed over IPC, and daemon events are relayed to the browser over SSE/WebSocket where needed.
