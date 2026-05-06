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
- MCP tool exposure for agent-execution surfaces

A validated agent-execution surface uses the same Mission MCP tool vocabulary:

- signal tools: `progress`, `request_input`, `blocked`, `ready`, `complete`, `fail`, `note`, `usage`
- Entity command tool: `entity`

The `entity` tool is a thin transport wrapper over authorized Entity command views. The daemon registers which Entity commands a session may invoke, and the surface must not invent a separate agent-only command vocabulary.

Runtime delivery is best effort. It is not a state acknowledgement. Mission state changes must still flow through daemon-owned commands and accepted transactions. Structured command and signal payloads stay payload-only; routing identity lives with the daemon-issued session token.
