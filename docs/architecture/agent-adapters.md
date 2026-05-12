---
layout: default
title: Agent Adapter
parent: Architecture
nav_order: 6
description: Provider-neutral agent execution under Mission control.
---

Agent adapters execute bounded work. Mission controls when they run, what context they receive, and how their output is recorded.

The runtime boundary includes:

- Agent execution creation, daemon-issued session tokens, and lifecycle
- structured Agent execution messages
- terminal input when a CLI runtime requires it
- runtime message descriptors advertised to Airport
- durable Agent execution logs
- prompt-scoped stdout signal markers for agent-signal state

A validated terminal-backed Agent execution receives mandatory signal instructions in its initial prompt. The Agent reports advisory state by emitting one-line stdout markers using the Mission protocol marker prefix.

Supported marker payloads cover progress, needs-input, blocked, ready-for-verification, completion claims, failure claims, and short messages. The daemon parses, validates, scopes, de-duplicates, and policy-gates those markers before any AgentExecution state changes.

Runtime delivery is best effort. It is not a state acknowledgement. Mission state changes must still flow through daemon-owned commands, accepted transactions, and policy-approved observations. Natural language terminal output is audit material, not workflow truth.
