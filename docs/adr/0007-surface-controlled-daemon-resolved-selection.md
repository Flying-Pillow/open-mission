---
layout: default
title: Surface-Controlled Daemon-Resolved Selection
parent: Architecture Decisions
nav_order: 7
status: accepted
date: 2026-05-04
decision_area: surface-selection
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission control selection represents an operator's current focus in one surface: a Mission stage, Mission task, Mission artifact, Agent session, or other valid focus target. It is not part of the Mission's durable work record.

Selection is surface-controlled and daemon-resolved. A surface may request selection changes, but the daemon validates and normalizes those requests against canonical Mission state before returning the Mission control view. This prevents surfaces from inventing invalid focus while keeping focus local to the operator/session that requested it.

Mission control selection must not be persisted as durable Mission state or broadcast as the current focus for every surface. One operator clicking a task should not move another operator's current focus. Durable shared navigation changes belong in Mission control placement overrides or canonical Entity relationships, not selection.

This keeps operator focus ergonomic and local while preserving daemon authority over valid Mission references.
