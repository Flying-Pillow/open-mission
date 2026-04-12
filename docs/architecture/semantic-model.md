---
layout: default
title: Semantic Model
parent: Architecture
nav_order: 3
---

# Semantic Model

Mission uses two related but different semantic layers:

1. Domain identities and persisted mission records.
2. Daemon projection contexts used for selection, routing, and UI composition.

The architecture stays coherent only if those layers are not collapsed.

## First-Class Entities

| Entity | Primary representation | Purpose | Runtime authority |
| --- | --- | --- | --- |
| Repository | `RepositoryContext`, repository root path, `.mission/settings.json` | Repository-scoped control plane root | `WorkspaceManager`, `MissionWorkspace` |
| Mission | `MissionDescriptor`, `MissionRuntimeRecord`, `MissionContext` | Long-lived unit of work and its persisted execution state | `Mission` aggregate + workflow controller |
| Stage | `MissionStageId`, `MissionStageRuntimeProjection` | Structural phase boundary derived from task state | Workflow runtime |
| Task | `MissionTaskRuntimeState`, `MissionTaskState`, `TaskContext` | Atomic unit of executable work | Workflow runtime |
| Artifact | `MissionArtifactKey`, `ArtifactContext` | Mission output and operator-readable state | Workflow artifact materialization |
| Agent session | `MissionAgentSessionRuntimeState`, `MissionAgentSessionRecord`, `AgentSessionContext` | Live or historical execution of a task through a runner | Agent runtime + mission aggregate |

## Mission Records Versus Projection Records

| Record | Scope | Why it exists |
| --- | --- | --- |
| `MissionDescriptor` | Mission identity | Stable mission metadata such as `missionId`, brief, branch, and creation time |
| `MissionRuntimeRecord` | Mission persistence | Snapshot of workflow configuration, runtime state, and event log |
| `MissionRecord` | Operator-facing aggregate summary | Mission identity plus current stage and session records |
| `ContextGraph` | Daemon projection state | Repository, mission, task, artifact, and session selection graph |
| `OperatorStatus` | Surface-facing response | Aggregated mission status returned by daemon APIs |

## Stage And Artifact Taxonomy

The current workflow manifest defines a fixed mission taxonomy.

| Stage id | Folder | Primary artifacts | Notes |
| --- | --- | --- | --- |
| `prd` | `01-PRD` | `PRD.md` | First requirements stage |
| `spec` | `02-SPEC` | `SPEC.md` | Technical design stage |
| `implementation` | `03-IMPLEMENTATION` | `VERIFY.md` | Supports execution and paired verification tasks |
| `audit` | `04-AUDIT` | `AUDIT.md` | Post-implementation audit stage |
| `delivery` | `05-DELIVERY` | `DELIVERY.md` | Final delivery stage |

## Task Model Boundaries

Mission exposes two different task shapes for different reasons.

| Shape | Current fields emphasize | Used by |
| --- | --- | --- |
| `MissionTaskRuntimeState` | Runtime lifecycle, launch policy, retries, dependency blocking | Workflow engine |
| `MissionTaskState` | Task file identity, subject, instruction body, simplified status for operator surfaces | Mission aggregate and control surfaces |
| `TaskContext` | Selection graph fields and session links | Daemon context graph |

This is intentional. The workflow engine needs detailed lifecycle semantics such as `queued` and `running`. The operator surface model uses a simpler task status vocabulary for mission control and selection.

## Session Model Boundaries

Sessions also exist in more than one form.

| Shape | Scope | Owned by |
| --- | --- | --- |
| `AgentSession` | Live runtime object | Runner implementation |
| `AgentSessionSnapshot` | Provider-neutral runtime snapshot | Agent runtime orchestrator |
| `MissionAgentSessionRuntimeState` | Workflow-tracked session state | Workflow runtime |
| `MissionAgentSessionRecord` | Mission aggregate record for surfaces | `Mission` aggregate |
| `AgentSessionContext` | Daemon selection/projection context | `MissionControl` |

## Context Graph

`ContextGraph` is the daemon's semantic routing graph. It is not stored in `mission.json`.

It exists to answer questions such as:

- which repository is currently selected
- which mission Tower should center on
- which artifact Briefing Room should show
- which task or session the operator is targeting

## Invariants

1. Stage state is derived from task state, not independently edited by the UI.
2. Artifact contexts are routing records, not the artifacts themselves.
3. The daemon may project a mission through `ContextGraph` without changing mission execution state.
4. Sessions are tied to tasks semantically, but they remain runtime objects with their own lifecycle and transport boundary.

## Relationship To Replay Anchors

This page is the architecture home for the replayed mission "Mission Semantic Model" and aligns with `specifications/mission/model/core-object-model.md` and `specifications/mission/model/mission-model.md`.
