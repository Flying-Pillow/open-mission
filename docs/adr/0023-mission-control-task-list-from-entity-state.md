---
layout: default
title: Mission Control Task List From Entity State
parent: Architecture Decisions
nav_order: 23
status: accepted
date: 2026-05-07
decision_area: surface-selection
owners:
  - maintainers
supersedes:
  - 0006
superseded_by: []
---

Mission Control no longer publishes or consumes a daemon-shaped tree or tower projection. Airport web and native are the supported operator surfaces, and they render Mission stages, Mission tasks, artifacts, Agent executions, and Entity command descriptors directly from Entity data and Mission workflow snapshots.

The Mission Control task surface is a stage-filtered task list. It defaults to the active Mission stage, lets the operator move between stages locally, and presents each Mission task as a compact card with task lifecycle, autostart configuration, and available Entity commands. The task list is an Airport surface view; it does not define workflow legality, duplicate Entity state, or persist ordering as Mission state.

The core Mission status contract no longer exposes `MissionTowerProjection`, `stageRail`, `treeNodes`, or a `tower` field. Mission status and Mission control view payloads carry status, workflow, artifact, task, Agent execution, and command data through their canonical Entity schemas and contracts. Surfaces compose those Entity records into operator layouts.

Selection is surface-local focus over canonical Entity data. A selected stage or task may determine companion artifacts or preferred Agent execution panes, but that focus is not durable Mission coordination state and is not broadcast as shared operator state.

Agent execution context remains the owner of ordered context references. Mission Control may display context artifacts or submit Entity commands that mutate context, but it must not introduce a separate ordering, placement, or curation model for those references.
