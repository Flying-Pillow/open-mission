---
layout: default
title: Impeccable Live Supervision
parent: Architecture
nav_order: 13
description: Daemon-supervised Impeccable Live as one Open Mission surface.
---

Impeccable Live is not a separate end-user product surface.

For an operator, Open Mission web, the daemon, and the Impeccable browser runtime should behave as one surface:

- Open Mission web is the host and public route.
- the daemon runtime supervisor owns lifecycle and recovery.
- Impeccable Live is a daemon-supervised runtime resource behind that host.

The operator should not need to think in terms of "start a separate Impeccable server" or "connect to a sidecar". The Open Mission surface requests a live session for a Repository or Mission owner, and the daemon decides whether to adopt, start, keep, or stop the underlying runtime.

## Ownership

Ownership is strict:

- the daemon runtime supervisor owns live-session process lifecycle
- the daemon transport owns start-or-attach and explicit stop commands
- Open Mission web owns delivery through the host route and script-origin rewriting
- the owner selector is exactly one of `repositoryId` or `missionId`
- filesystem path fallback is forbidden on the public seam

This means the public model is owner-based, not path-based and not host-process-based.

## What The Daemon Owns

The daemon-owned Impeccable registry is responsible for:

- resolving `repositoryId` or `missionId` to the correct live surface root
- reading persisted live-session records from that owner surface
- adopting an already-running live server if the persisted record is still valid
- starting a live server if no valid running server exists
- projecting the live process into daemon runtime supervision as a runtime lease
- stopping a live session explicitly on command
- stopping daemon-started live processes during daemon shutdown

The daemon transport exposes two canonical operations for this slice:

- `impeccable-live.resolve`
- `impeccable-live.stop`

These are not end-user UX concepts. They are daemon-owned lifecycle operations that Open Mission hosts call as needed.

## What The Web Host Owns

Open Mission web does not own the live process.

It owns:

- the public route under `/api/impeccable/live/[...livePath]`
- proxying browser requests to the daemon-owned live origin
- rewriting `live.js` so the browser keeps talking through the Open Mission host route
- preserving the owner selector query in the hosted route

The web host must not:

- invent its own live-session lifecycle
- infer filesystem paths on behalf of the operator
- expose a separate "Impeccable app" mental model
- become a second authority for runtime ownership

## Operator Use

From the operator point of view, usage is simple.

### Repository-owned live work

Use Repository-owned live work when the surface being improved belongs to the Repository root.

The host requests a live session with `repositoryId`.
The daemon resolves the Repository root, ensures the live runtime exists, and the hosted route serves the browser script and companion endpoints through Open Mission web.

### Mission-owned live work

Use Mission-owned live work when the surface being improved belongs to a Mission worktree.

The host requests a live session with `missionId`.
The daemon resolves the Mission-owned worktree, ensures the live runtime exists for that owner, and the hosted route serves the same live endpoints through Open Mission web.

### Stopping a live session

When the host no longer needs a live session, it asks the daemon to stop it by the same owner selector.

The host does not shell out.
The host does not kill processes directly.
The daemon supervisor releases the runtime lease and stops the underlying live process if one is active.

## Runtime Sequence

The canonical sequence is:

1. The host receives a live request scoped by `repositoryId` or `missionId`.
2. The host asks the daemon to resolve the live session.
3. The daemon registry resolves the owner to a live surface root.
4. The daemon adopts an existing valid live process or starts a new one.
5. The daemon records that process as a supervised runtime lease.
6. The host proxies browser traffic to that daemon-owned origin and rewrites `live.js` back to the host route.
7. When the host is done, it asks the daemon to stop the live session for that same owner.

## Recovery Expectations

Impeccable Live follows the same runtime-supervision posture as other daemon-owned runtime resources.

- stale persisted records are not trusted unless the recorded process is still running
- invalid persisted records are rejected instead of normalized through fallback parsing
- daemon shutdown releases daemon-owned live processes
- runtime supervision is the diagnostic surface for live-session ownership

This keeps the operator-facing experience simple while preserving strict daemon ownership and recovery discipline.

## Design Rule

If a change makes the operator think about separate daemon, web-server, and Impeccable products, the design has regressed.

The correct model is one Open Mission surface with daemon-supervised live capability.
