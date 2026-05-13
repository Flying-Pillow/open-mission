---
layout: default
title: Runtime-Owned Agent Model Selection
parent: Architecture Decisions
nav_order: 34
status: accepted
date: 2026-05-13
decision_area: agent-execution-interaction
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission will not maintain adapter-declared model or reasoning catalogues as Agent Entity data.

## Context

Agent adapters previously carried static option catalogues for provider models and reasoning levels. Airport setup rendered these catalogues in Agent cards and persisted selected defaults through owner settings.

That model made adapter source code a false authority for provider inventory. Provider CLIs expose their own live model state, update model availability independently, and may combine model and reasoning selection behind native session commands. A static catalogue quickly becomes stale and creates uneven UI behavior, such as one Agent card showing selectors while another has none.

## Decision

Model and reasoning selection belongs to a running Agent session, not to adapter metadata or setup-time Agent cards.

Mission surfaces provider model selection through the active AgentExecution protocol as native runtime interaction. The `/model` command is advertised as a terminal-only runtime message descriptor for active Agent executions. It is routed through the terminal lane and remains provider-native terminal input unless Mission later promotes a stable cross-Agent selection contract.

Agent Entity data must describe identity, capabilities, availability, and runtime commandability. It must not expose static provider model or reasoning catalogues.

Agent adapters may still translate explicit launch metadata such as `model` or `reasoningEffort` into provider flags when such metadata exists. They must not provide static option lists as canonical truth, and launch must tolerate an omitted model so the provider can use its current session/default behavior.

## Consequences

- Airport setup cards configure agent enablement, default agent, and launch mode only.
- Provider model choices are discovered and changed in an active Agent session through `/model`.
- Static adapter catalogues cannot drift out of date because they no longer exist in the Agent Entity contract.
- Connection tests can probe adapter readiness without requiring a catalogue-selected model.
- Future structured model selection must be introduced as a runtime-owned AgentExecution contract, not as adapter-owned static data.

## Implementation Rules

- Do not add `optionCatalog`, `modelOptions`, or adapter-owned reasoning lists back to Agent data.
- Do not render setup-time model or reasoning selectors from adapter metadata.
- Do allow explicit launch metadata to pass through when already present in owner or workflow settings.
- Do route `/model` through the terminal lane until a daemon-owned structured model-selection contract exists.
- Do keep provider-specific model inventory out of Airport components.
