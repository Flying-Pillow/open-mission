---
layout: default
title: Agent Runtime
parent: Architecture
nav_order: 6
description: Provider-neutral agent execution under Mission control.
---

Agent runtimes execute bounded work. Mission controls when they run, what context they receive, and how their output is recorded.

The runtime boundary includes:

- Agent session creation and lifecycle
- structured Agent session messages
- terminal input when a CLI runtime requires it
- runtime message descriptors advertised to Airport
- durable Agent session logs

Runtime delivery is best effort. It is not a state acknowledgement. Mission state changes must still flow through daemon-owned commands and accepted transactions.
