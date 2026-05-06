---
layout: default
title: Agents, Runtimes, and Models
parent: User Manual
nav_order: 3
description: How Mission attaches agent execution to governed work.
---

An Agent execution is daemon-managed execution attached to a Mission, usually focused on one Mission task. The daemon issues and registers a session token for the Agent execution, and the agent process uses that token to talk back to the daemon.

The selected Agent adapter receives bounded context: task instructions, relevant artifacts, and structured Agent execution messages. Runtime delivery is best effort; it is not proof that the model understood or completed the work.

Validated agent-execution surfaces can use these Mission MCP tools:

- `progress` — structured progress report
- `request_input` — ask the operator for a decision
- `blocked` — report a blocker
- `ready` — report ready-for-verification
- `complete` — report a completion claim
- `fail` — report a failure claim
- `note` — append a short note
- `usage` — attach structured usage metadata
- `entity` — invoke an authorized Entity command from the daemon-published command view

Mission keeps runtime choice separate from workflow law. Copilot CLI, pi, and future adapters can sit behind the same Mission control model when their adapters implement the required contract.
