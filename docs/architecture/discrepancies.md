---
layout: default
title: Discrepancies And Ambiguities
parent: Architecture
nav_order: 99
---

# Discrepancies And Ambiguities

This page records current mismatches between specifications, replay material, older documentation, and the implementation currently in the repository.

## 1. Spec Documents Often Describe A Clean-Break Future Architecture More Radical Than The Current Code

Several specification files under `specifications/mission/` and `specifications/airport/` are written as from-scratch replacement documents. The current implementation realizes much of that architecture, but not always with the exact naming or decomposition those specs prescribe.

Practical rule: use the current code as the authority for what exists, and use the specs as intent documents.

## 2. There Are Two Distinct Gate Vocabularies

- Workflow gates in `mission.json` use gate ids such as `implement`, `verify`, `audit`, and `deliver`.
- Airport panes in `packages/airport/src/types.ts` use `tower`, `briefingRoom`, and `runway`.

They are both first-class, but they mean different things. One is workflow progression projection. The other is UI layout topology.

## 3. There Are Two Task State Models On Purpose

- `MissionTaskRuntimeState` uses workflow lifecycle values such as `pending`, `ready`, `queued`, `running`, `blocked`, and `completed`.
- `MissionTaskState` uses simplified operator-facing values such as `todo`, `active`, `blocked`, and `done`.

This is not merely duplication. It is an intentional split between execution truth and operator summary, but it is easy to misread as inconsistency.

## 4. Session Persistence Is A Hook, Not Yet A Universal Hard Requirement

The runtime architecture exposes `PersistedAgentSessionStore`, and `AgentSessionOrchestrator` can save and reload snapshots through it. But the core mission path constructs `MissionWorkflowRequestExecutor` without always supplying a concrete store. The workflow architecture should therefore be described as supporting runtime session persistence hooks rather than requiring a single always-on persisted session store.

## 5. Repository Control State, Daemon Snapshot State, And Mission Execution State Are Sometimes Blurred In Older Docs

The current implementation separates them clearly:

- `.mission/settings.json` is repository control state
- `MissionSystemSnapshot` is live daemon-wide state
- `mission.json` is mission execution state

Any document that compresses those into one "Mission state" concept is underspecified.

## 6. Replay Material Preserves Historical Intent, Not Always Exact Current Runtime Wiring

The replayed dossiers under `.mission/missions/11-*` through `.mission/missions/18-*` preserve the five architecture anchors well, but some replay language still describes architectural outcomes at a coarser level than the current code's module boundaries. This is expected. The replay set is an architectural preservation artifact, not a module-by-module code map.
