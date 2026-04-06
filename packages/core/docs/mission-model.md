# Mission Model

This document defines the Mission object model and its repository, control-plane, and workspace representation.

## Architectural Summary

Mission is modeled as a set of first-class domain objects:

- daemon `Mission`: aggregate root and workflow engine
- `Stage`: lifecycle slice that owns stage-level artifacts and default tasks
- `Task`: executable workflow unit that owns a task artifact
- `AgentSession`: runtime-backed execution object owned by a task
- `Artifact`: persisted markdown record owned by a mission, stage, or task

The authoritative workflow model lives under `packages/core/src/daemon/mission` and is surfaced through daemon and client APIs.

Persistence and markdown handling live outside the domain:

- `Factory` composes or rehydrates the aggregate
- `FilesystemAdapter` maps domain objects to files, paths, frontmatter, and Git-bound repository state

All first-party mission markdown templates now live under [packages/core/src/templates/mission/index.ts](/home/ronald/mission/packages/core/src/templates/mission/index.ts).

## Repository Layout

Mission now uses three distinct storage scopes:

1. tracked repository mission dossiers under `.missions/missions/<mission-id>/`
2. repo-scoped control settings under `.missions/`
3. machine-local daemon runtime state outside the repository

The important architectural rule is that the mission dossier is repository history, while daemon runtime state is not.

### Repository Bootstrap State

Before a repository may host missions, Mission prepares a bootstrap proposal branch that adds the tracked `.missions/` control structure. That proposal is expected to be reviewed and merged before any mission dossier is prepared.

```text
.missions/
  settings.json
  missions/
  worktrees/
  pending/
  active/
  completed/
```

### Mission Preparation State

Preparing a mission then creates a tracked mission dossier on a proposal branch anchored to a canonical GitHub issue. That proposal is expected to be reviewed and merged before a developer materializes a local mission workspace.

```text
.missions/
  settings.json
  missions/
    <mission-id>/
      BRIEF.md
      flight-deck/
        mission.json
        01-PRD/
          PRD.md
          tasks/
            01-prd-from-brief.md
```

### Mission Materialization State

After the mission dossier exists on the repository branch, a developer may materialize a local mission workspace. The workspace is linked local execution infrastructure, not the canonical mission record.

```text
.missions/
  settings.json
  missions/
    <mission-id>/
      BRIEF.md
      flight-deck/
        mission.json
        ...
  active/
    <mission-id>/
      workspace/
```

Machine-local daemon runtime state lives outside the repository under the hashed runtime directory for the control repo, for example `$XDG_RUNTIME_DIR/mission/<repo-hash>/daemon.json` and `sessions/<mission-id>.json` on Unix systems, with the OS temp directory as the fallback when `XDG_RUNTIME_DIR` is unavailable.

The other important rule is that stage entry materializes stage-owned files inside the tracked mission dossier. They are not all created up front.

## Domain Entities

### MissionBrief

Defined in [packages/core/src/types.ts](/home/ronald/mission/packages/core/src/types.ts).

Represents the intake trigger for a mission.

Fields:

- `issueId?`
- `title`
- `body`
- `type`
- `url?`
- `labels?`
- `metadata?`

### MissionDescriptor

Defined in [packages/core/src/types.ts](/home/ronald/mission/packages/core/src/types.ts).

Represents the canonical persisted mission identity loaded from the tracked mission dossier.

Fields:

- `missionId`
- `brief`
- `missionDir`
- `branchRef`
- `createdAt`
- `deliveredAt?`

### MissionRecord

Defined in [packages/core/src/types.ts](/home/ronald/mission/packages/core/src/types.ts).

Represents the aggregate snapshot returned by mission operations.

Fields:

- `id`
- `brief`
- `missionDir`
- `branchRef`
- `createdAt`
- `stage`
- `deliveredAt?`
- `agentSessions`

### MissionTaskState

Defined in [packages/core/src/types.ts](/home/ronald/mission/packages/core/src/types.ts).

Represents one task artifact after the filesystem adapter parses it.

Fields:

- `taskId`
- `stage`
- `sequence`
- `subject`
- `instruction`
- `body`
- `dependsOn`
- `blockedBy`
- `status`
- `agent`
- `retries`
- `fileName`
- `filePath`
- `relativePath`

### MissionStageStatus

Defined in [packages/core/src/types.ts](/home/ronald/mission/packages/core/src/types.ts).

Represents the derived state of one stage directory.

Fields:

- `stage`
- `directoryName`
- `status`
- `taskCount`
- `completedTaskCount`
- `activeTaskIds`
- `readyTaskIds`
- `tasks`

### MissionStatus

Defined in [packages/core/src/types.ts](/home/ronald/mission/packages/core/src/types.ts).

Represents the mission status returned to clients.

Fields include:

- mission identity
- active stage
- discovered product artifact paths
- active and ready task arrays
- stage summaries
- agent sessions
- recommended next operator command

## Ownership Model

### Mission-Owned Artifact

| Artifact | Owner | Created when |
| --- | --- | --- |
| `BRIEF.md` | `Mission` | during `Mission.initialize()` |

### Stage-Owned Artifacts

| Stage | Artifacts | Created when |
| --- | --- | --- |
| `prd` | `PRD.md` | when PRD stage is entered |
| `spec` | `SPEC.md` | when SPEC stage is entered |
| `plan` | `PLAN.md` | when PLAN stage is entered |
| `implementation` | none by default | n/a |
| `verification` | `VERIFICATION.md` | when VERIFICATION stage is entered |
| `audit` | `AUDIT.md` | when AUDIT stage is entered |

### Task-Owned Artifacts

| Stage | Default task artifacts | Created when |
| --- | --- | --- |
| `prd` | `tasks/PRD/01-prd-from-brief.md` | when PRD stage is entered |
| `spec` | `tasks/SPEC/01-spec-from-prd.md` | when SPEC stage is entered |
| `plan` | `tasks/PLAN/01-plan-from-spec.md` | when PLAN stage is entered |
| `implementation` | none by default | n/a |
| `verification` | none by default | n/a |
| `audit` | `tasks/AUDIT/01-debrief.md`, `tasks/AUDIT/02-touchdown.md` | when AUDIT stage is entered |

Tasks added later by planning or implementation work are also task-owned artifacts.

### Task-Owned Agent Sessions

Agent sessions are persisted under the machine-local daemon runtime directory keyed by repo root, but they are owned by tasks, not by the mission as a whole.

Each `MissionAgentSessionRecord` may carry:

- `taskId` when the session was launched for a specific task
- `assignmentLabel` for UI-facing session display
- provider lifecycle, scope, and telemetry state

## Frontmatter Model

Mission uses a deliberately small frontmatter format implemented in [packages/core/src/lib/frontmatter.ts](/home/ronald/mission/packages/core/src/lib/frontmatter.ts).

Rules:

1. A document has frontmatter only if it starts with `---` on the first line.
2. Frontmatter ends at the first closing `---` block boundary.
3. Each attribute is a single `key: value` line.
4. Blank lines and `#` comment lines inside the frontmatter block are ignored.
5. Supported value types are string, number, boolean, and JSON-style arrays of those scalar values.
6. Rich YAML features are intentionally unsupported.

### BRIEF Frontmatter

`BRIEF.md` is the canonical mission descriptor artifact.

Generated keys:

```yaml
---
issueId: 123                # optional
title: "Mission title"
type: "feature"           # feature | fix | docs | refactor | task
branchRef: "mission/123-some-title"
createdAt: "2026-04-01T12:34:56.000Z"
url: "https://..."         # optional
---
```

`FilesystemAdapter.readMissionDescriptor(...)` validates and rehydrates this file back into structured descriptor state.

### flight-deck/mission.json Runtime State

Mutable workflow state now lives in `mission.json` inside each mission folder.

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-04-01T12:34:56.000Z",
  "deliveredAt": "2026-04-02T09:41:00.000Z",
  "tasks": {
    "spec/01-spec-from-prd": {
      "status": "active",
      "agent": "copilot",
      "retries": 0,
      "updatedAt": "2026-04-01T12:35:12.000Z"
    }
  }
}
```

`FilesystemAdapter.listTaskStates(...)` and `FilesystemAdapter.readTaskState(...)` join task markdown content with authoritative control state from `mission.json`.

Behavior:

- new task files default to `status: todo`, `agent: copilot`, and `retries: 0`
- legacy task frontmatter is only used once to seed `mission.json` when the control file does not yet exist
- after `mission.json` exists, later frontmatter edits are ignored for workflow truth
- invalid legacy `status`, `agent`, or `retries` values still raise adapter type errors during migration

### Task Definition Metadata

Task files may optionally carry immutable task-definition frontmatter.

Today the supported key is `dependsOn`.

Example:

```yaml
---
dependsOn: ["02-api", "04-polish"]
---

# Final Integration

Merge the completed slices and close the integration loop.
```

Rules:

- if `dependsOn` is omitted, the default dependency is the previous task in the same stage
- if `dependsOn` is an empty array, the task is independent inside the current stage
- dependency references may use the same-stage file stem, file name, or full task id
- `dependsOn` is definition metadata, not mutable workflow state, so it stays in the task file rather than `mission.json`

The source templates for these files are mirrored in the codebase under:

- [packages/core/src/templates/mission/BRIEF.md.ts](/home/ronald/mission/packages/core/src/templates/mission/BRIEF.md.ts)
- [packages/core/src/templates/mission/products/PRD.md.ts](/home/ronald/mission/packages/core/src/templates/mission/products/PRD.md.ts)
- [packages/core/src/templates/mission/products/SPEC.md.ts](/home/ronald/mission/packages/core/src/templates/mission/products/SPEC.md.ts)
- [packages/core/src/templates/mission/products/PLAN.md.ts](/home/ronald/mission/packages/core/src/templates/mission/products/PLAN.md.ts)
- [packages/core/src/templates/mission/products/VERIFICATION.md.ts](/home/ronald/mission/packages/core/src/templates/mission/products/VERIFICATION.md.ts)
- [packages/core/src/templates/mission/products/AUDIT.md.ts](/home/ronald/mission/packages/core/src/templates/mission/products/AUDIT.md.ts)
- [packages/core/src/templates/mission/tasks/PRD/01-prd-from-brief.md.ts](/home/ronald/mission/packages/core/src/templates/mission/tasks/PRD/01-prd-from-brief.md.ts)
- [packages/core/src/templates/mission/tasks/SPEC/01-spec-from-prd.md.ts](/home/ronald/mission/packages/core/src/templates/mission/tasks/SPEC/01-spec-from-prd.md.ts)
- [packages/core/src/templates/mission/tasks/PLAN/01-plan-from-spec.md.ts](/home/ronald/mission/packages/core/src/templates/mission/tasks/PLAN/01-plan-from-spec.md.ts)
- [packages/core/src/templates/mission/tasks/AUDIT/01-debrief.md.ts](/home/ronald/mission/packages/core/src/templates/mission/tasks/AUDIT/01-debrief.md.ts)
- [packages/core/src/templates/mission/tasks/AUDIT/02-touchdown.md.ts](/home/ronald/mission/packages/core/src/templates/mission/tasks/AUDIT/02-touchdown.md.ts)

### Product Artifacts Without Required Frontmatter

These stage-owned product artifacts are plain markdown by default:

- `PRD.md`
- `SPEC.md`
- `PLAN.md`
- `VERIFICATION.md`
- `AUDIT.md`

## Derived State Rules

Mission status is derived from the materialized filesystem state.

Key rules:

- `FilesystemAdapter.listMissions()` discovers missions from `.mission/worktrees/*`
- `FilesystemAdapter.readMissionDescriptor()` derives the descriptor from `BRIEF.md`
- `mission.json` is the workflow runtime document and is updated only through workflow event ingestion
- `FilesystemAdapter.listTaskStates()` derives task content and `dependsOn` metadata from task files, then joins mutable workflow state from `mission.json`
- `Mission` computes the current stage by looking for the first populated stage with incomplete work
- within the current stage, `Mission` exposes `activeTasks` and `readyTasks` rather than a single next task
- stages that have not been entered yet remain pending with zero tasks
- product artifacts only appear in `MissionStatus.productFiles` after their owning mission or stage has materialized them

## Practical Consequence

The important readability improvement is temporal:

- the factory does not pre-create the whole workflow
- the mission creates the mission environment
- a stage creates its own stage artifacts and default tasks when the mission enters that stage
- a task creates its own task artifact

That is the current model the code is moving toward and now enforces for mission creation and stage entry.
