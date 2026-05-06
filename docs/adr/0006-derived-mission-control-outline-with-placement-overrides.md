---
layout: default
title: Derived Mission Control Outline With Placement Overrides
parent: Architecture Decisions
nav_order: 6
status: accepted
date: 2026-05-04
decision_area: mission-control-outline
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission control needs a stable outline for operator navigation, but the outline must not become another owner of Mission task, Mission artifact, Agent execution, or Agent execution context data.

The Mission control outline is derived by default from Entity relationships, workflow definition, and runtime state. This keeps ordinary outline structure predictable and avoids storing duplicate tree data that can drift from canonical Entities.

Operator curation is still necessary in two cases: stable manual ordering and cross-placement roles, such as showing the same Mission artifact under the Agent execution that produced it and under a task or stage where it becomes useful. Mission handles those cases with durable Mission-scoped, daemon-owned Mission control placement overrides. A placement override adds, orders, or roles an Entity reference in the outline; it does not copy artifacts, mutate canonical Entity data, or create surface-local tree ownership.

Airport surfaces may request placement changes, but the daemon owns the resulting placement overrides and republishes the Mission control view to all surfaces and future operators. Mission surface preferences are limited to local Airport surface/client affordances such as collapsed nodes, panel sizes, and temporary focus, and the daemon must not store them. This preserves a derived outline as the default while allowing intentional human curation without leaking durable outline state into surface code.

Daemon-only recovery conditions such as Mission recovery attention are not part of the Mission control view or Mission control outline by default. If recovery state needs operator-facing presentation later, it must be modeled as an explicit operator-facing recovery design rather than leaking daemon diagnostics into Mission control navigation.
