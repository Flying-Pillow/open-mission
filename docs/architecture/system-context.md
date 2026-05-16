---
layout: default
title: System Context
parent: Architecture
nav_order: 1
description: The main actors and ownership boundaries in Open Mission.
---

Open Mission coordinates five things:

| Area | Owner |
| --- | --- |
| Repository control state | Repository Entity and `.open-mission` files |
| Live Mission behavior | Running Mission instance |
| Runtime state and dispatch | Open Mission daemon |
| Operator interaction | Open Mission surfaces |
| External systems | Git, GitHub, and Agent adapter adapters |

The daemon is the live coordination layer. It composes repository state, Mission state, Open Mission connections, and agent adapters into operator-facing views and command routing.

External systems do not leak inward. Adapters translate them into Mission vocabulary.
