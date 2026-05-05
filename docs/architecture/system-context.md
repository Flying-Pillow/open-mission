---
layout: default
title: System Context
parent: Architecture
nav_order: 1
description: The main actors and ownership boundaries in Mission.
---

Mission coordinates five things:

| Area | Owner |
| --- | --- |
| Repository control state | Repository Entity and .mission files |
| Live Mission behavior | Running Mission instance |
| Runtime state and dispatch | Mission daemon |
| Operator interaction | Airport surfaces |
| External systems | Git, GitHub, and Agent runtime adapters |

The daemon is the live coordination layer. It composes repository state, Mission state, Airport connections, and agent runtimes into operator-facing views and command routing.

External systems do not leak inward. Adapters translate them into Mission vocabulary.
