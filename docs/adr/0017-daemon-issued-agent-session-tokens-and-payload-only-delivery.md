---
layout: default
title: Daemon-Issued Agent Session Tokens and Payload-Only Delivery
parent: Architecture Decisions
nav_order: 17
status: accepted
date: 2026-05-05
decision_area: agent-session-transport
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission daemon owns Agent session transport identity.

When the daemon creates or registers an Agent session, it issues an opaque session token and binds that token to the daemon-owned Agent session. The Agent session process uses that token to communicate with the daemon over the structured transport; it does not need `taskId`, `agentSessionId`, or similar routing identity passed through environment variables.

Command and signal delivery are payload-first. The caller sends only the payload that belongs to the command or signal being delivered. `eventId` is daemon-owned audit metadata, not caller-owned transport data, and it should not be required in the external delivery payload.

The validated agent-session surface exposes shared Mission MCP signal tools (`progress`, `request_input`, `blocked`, `ready`, `complete`, `fail`, `note`, `usage`) plus the `entity` tool for authorized Entity commands. Those tools are thin wrappers over daemon-published descriptors and command views.

This keeps session identity, registration, and audit sequencing inside the daemon while leaving runtime message payloads small and specific.
