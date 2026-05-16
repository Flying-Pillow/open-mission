---
layout: default
title: Daemon And System Control Plane
parent: Architecture
nav_order: 4
description: The daemon-owned live coordination layer.
---

The daemon owns live coordination.

It is responsible for:

- loading repositories and Repository Entities
- running Mission instances
- dispatching Entity remote methods
- publishing Entity events and command views
- coordinating Agent executions, daemon-issued session tokens, and runtime delivery
- supervising Impeccable Live runtime leases, including start-or-attach and explicit stop by owner id
- checkpointing accepted Mission runtime data

Open Mission connects to the daemon. It does not recreate daemon state or workflow legality locally.

For Impeccable Live specifically, the daemon runtime supervisor is the lifecycle owner. Open Mission hosts may request or release a live session, but they do not start, kill, or reconcile the underlying live process themselves. See [Impeccable Live Supervision](impeccable-live-supervision.md).
