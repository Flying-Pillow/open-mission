---
layout: default
title: Prompt-Scoped Agent Execution Signals
parent: Architecture Decisions
nav_order: 17
status: accepted
date: 2026-05-06
decision_area: agent-execution-transport
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission uses prompt-scoped terminal output markers as the mandatory baseline for Agent execution signaling.

When the daemon starts a task-scoped Agent execution, AgentExecutor prepends signal instructions to the initial prompt. Those instructions include the exact Agent execution id, supported signal payloads, and the strict one-line marker prefix. Mission and task scope come from the active AgentExecution scope, not from Agent-authored marker JSON. The Agent process reports structured progress, input requests, blockers, ready-for-verification claims, completion claims, failure claims, and notes by printing those markers to stdout.

The runtime treats the Agent as a noisy participant, not as a protocol implementation. Terminal output is observed by deterministic daemon code. The marker parser extracts only exact single-line markers, validates strict JSON, checks the claimed Agent execution id against the active execution, de-duplicates event ids, and routes accepted observations through AgentExecutionSignalPolicy. Natural language output is never parsed as workflow truth.

Agent-declared signals are advisory. Progress, needs-input, and blocked markers may update Agent execution state after policy evaluation. Ready-for-verification, completion, and failure markers remain claims unless a daemon-authoritative lifecycle event confirms them. Malformed, oversized, wrong-channel, wrong-execution, duplicate, or unsupported markers are rejected or recorded as diagnostics.

This keeps the universal transport surface to stdout/stderr and preserves daemon-owned workflow authority without requiring provider-specific structured tooling inside each coding agent.
