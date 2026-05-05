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
- coordinating Agent sessions and runtime delivery
- checkpointing accepted Mission runtime data

Airport connects to the daemon. It does not recreate daemon state or workflow legality locally.
