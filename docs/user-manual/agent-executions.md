---
layout: default
title: Agents, Runtimes, and Models
parent: User Manual
nav_order: 3
description: How Open Mission runs Agent executions under governed owners.
---

An Agent execution is one daemon-owned run of one Agent under an explicit owner reference. The owner can be System, Repository, Mission, Task, or Artifact, and the interaction model stays the same for every owner.

For terminal-backed executions, Open Mission can attach a Terminal as an optional transport lane. The AgentExecution still owns the execution lifecycle, structured messages, accepted observations, journal, and operator-facing state.

The selected Agent adapter receives bounded launch and message material from AgentExecution, such as task instructions, relevant artifacts, and structured Agent execution messages. Runtime delivery is best effort; accepted state comes from AgentExecution observations, decisions, owner effects, and journal records.

Supported signal markers include:

- `progress` — structured progress report
- `status` — machine-readable status phase such as `initializing` or `idle`
- `needs_input` — ask the operator for a decision
- `blocked` — report a blocker
- `ready_for_verification` — report ready-for-verification
- `completed_claim` — report a completion claim
- `failed_claim` — report a failure claim
- `message` — append a short note

Open Mission accepts exact structured messages and markers through the AgentExecution path. Plain prose remains useful operator context, while workflow truth comes from accepted observations and owner behavior.

Open Mission keeps runtime choice separate from workflow law. Copilot CLI, Pi, and future adapters can sit behind the same AgentExecution model when their adapters implement the required contract.
