---
layout: default
title: Agents, Runtimes, and Models
parent: User Manual
nav_order: 3
description: How Mission attaches agent execution to governed work.
---

An Agent execution is daemon-managed execution attached to a Mission, usually focused on one Mission task. For terminal-backed task executions, Mission inserts mandatory signal instructions into the initial prompt so the Agent can report advisory state through strict stdout markers.

The selected Agent adapter receives bounded context: task instructions, relevant artifacts, and structured Agent execution messages. Runtime delivery is best effort; it is not proof that the model understood or completed the work.

Supported signal markers include:

- `progress` — structured progress report
- `status` — machine-readable status phase such as `initializing` or `idle`
- `needs_input` — ask the operator for a decision
- `blocked` — report a blocker
- `ready_for_verification` — report ready-for-verification
- `completed_claim` — report a completion claim
- `failed_claim` — report a failure claim
- `message` — append a short note

Mission parses only exact one-line markers. Plain prose remains useful context, but it is not treated as workflow truth.

Mission keeps runtime choice separate from workflow law. Copilot CLI, pi, and future adapters can sit behind the same Mission control model when their adapters implement the required contract.
