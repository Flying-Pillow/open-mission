# Mission Lifecycle

This document defines the current object-oriented Mission workflow.

The core principle is simple:

- daemon `Mission` owns lifecycle progression.
- `Stage` owns stage materialization.
- `Task` owns task materialization.
- `Artifact` represents the markdown file each domain object owns.
- `Factory` only composes or rehydrates the aggregate.
- `FilesystemAdapter` is the only class that knows how markdown/frontmatter and filesystem persistence work.
- `templates/mission/` is the source tree for BRIEF, stage product, and default task templates.

The authoritative workflow model lives under `daemon/mission` and is surfaced through the daemon/client boundary.

## Source Layout

```text
packages/core/src/
  client/
    DaemonApi.ts
    DaemonControlApi.ts
    DaemonClient.ts
    DaemonMissionApi.ts
  adapters/
    CopilotAgentRuntime.ts
  daemon/
    Daemon.ts
    MissionAgentRuntime.ts
    protocol.ts
    daemonPaths.ts
    main.ts
    mission/
      AgentSession.ts
      Factory.ts
      Mission.ts
      Stage.ts
      Task.ts
      Artifact.ts
  templates/
    mission/
      BRIEF.md.ts
      common.ts
      index.ts
      types.ts
      products/
        PRD.md.ts
        SPEC.md.ts
        PLAN.md.ts
        VERIFICATION.md.ts
        AUDIT.md.ts
      tasks/
        PRD/
          01-prd-from-brief.md.ts
        SPEC/
          01-spec-from-prd.md.ts
        PLAN/
          01-plan-from-spec.md.ts
        AUDIT/
          01-debrief.md.ts
          02-touchdown.md.ts
  lib/
    FilesystemAdapter.ts
    frontmatter.ts
    repoConfig.ts
    repoPaths.ts
```

## Class Responsibilities

### Mission

daemon `Mission` is the aggregate root and workflow engine.

It is responsible for:

- creating the mission environment
- persisting the canonical brief descriptor
- entering the first stage
- validating stage transitions
- deriving mission status from materialized stage and task state
- coordinating task-owned agent sessions and mission-level status policy

It is not responsible for:

- parsing frontmatter
- writing markdown files directly
- deciding filesystem paths

Task-owned agent sessions now exist as a dedicated `AgentSession` domain object, so Mission can stay focused on workflow policy and authorization.

### Stage

`Stage` is a real behavior object, not just a stage enum helper.

A stage knows:

- its stage id
- its task directory name
- which product artifacts it owns
- which default tasks it owns
- whether another stage is adjacent in the lifecycle
- how to enter the stage

Entering a stage means:

1. create the stage-owned product artifacts if they do not exist
2. create the default tasks for that stage if they do not exist
3. optionally activate the first incomplete task

### Task

`Task` is a first-class workflow unit.

A task knows:

- its stage
- its task file name
- its subject and instruction
- its immutable dependency list
- its assigned agent
- how to materialize its own task artifact
- how to activate itself

Agent spawning policy is intentionally outside the current refactor. A task is now the correct object to own that decision later.

### AgentSession

`AgentSession` is the daemon domain object that owns a runtime-backed execution session for a task.

An agent session knows:

- its runtime identity
- its attached provider session
- its owning task id when launched from a task
- its assignment label and created-at metadata
- how to persist its own normalized record
- how to forward console and runtime events back to Mission

Mission still authorizes session launch, but the attached runtime session itself is no longer modeled as loose maps and callbacks inside `Mission.ts`.

### Artifact

`Artifact` represents the persisted markdown file owned by a mission, stage, or task.

It is responsible for:

- knowing its relative path
- checking whether it already exists
- materializing itself through the filesystem adapter

The domain treats an artifact as a first-class object. The markdown file is only the persisted form.

### Factory

`Factory` is composition only.

It is responsible for:

- resolving an existing mission by selector
- creating mission identity and branch binding for a new mission
- hydrating a `Mission`
- calling `Mission.initialize()` for a new mission

It is not responsible for:

- creating every future stage artifact up front
- creating every default task in the workflow
- deciding lifecycle timing

### FilesystemAdapter

`FilesystemAdapter` is the only filesystem/markdown boundary.

It is responsible for:

- mission discovery and resolution from `.mission/worktrees/*`
- branch lookup and branch switching
- safe filesystem reads and writes
- parsing and rendering markdown frontmatter
- reading, writing, and reconciling `mission.json`
- validating brief frontmatter, legacy task frontmatter during migration, and mission control state JSON
- rehydrating `MissionDescriptor` and `MissionTaskState` from disk plus control state

The domain model does not parse frontmatter directly.

## Creation Flow

Mission authorization now has three phases.

### Phase 0: Repository Bootstrap

1. If the repository is not yet Mission-ready, the daemon prepares a repository bootstrap branch.
2. That branch adds the tracked `.missions/` control scaffolding and workflow settings.
3. The daemon opens a repository bootstrap pull request.
4. The repository is Mission-ready only after that pull request is merged and the default branch is pulled locally.

This phase authorizes repository-level Mission control state before any mission may be prepared.

### Phase 1: Issue And Mission Preparation

1. A `MissionBrief` enters the daemon through `mission.from-brief` or an existing GitHub issue is selected through `mission.from-issue`.
2. For `mission.from-brief`, the daemon first creates the GitHub issue so mission identity is anchored to a canonical issue number.
3. The daemon resolves mission identity and the target mission branch from that issue.
4. The daemon prepares a tracked mission dossier under `.missions/missions/<mission-id>/` on a proposal branch.
5. The daemon opens the mission-start pull request.
6. The mission is authorized only after that pull request is merged.

An issue is not enough to start work. The mission-start pull request is the authorization boundary.

### Phase 2: Local Materialization

1. A developer syncs the repository after the mission-start change exists on the canonical branch.
2. The daemon materializes a local mission workspace for that mission branch.
3. The local workspace is a linked worktree used for execution, editing, and agent runtime.
4. The tracked `flight-deck/` content is already present because it comes from the repository branch.

This means repository control state is authorized first, mission history is authorized second, and only then may a local execution worktree exist.

## Stage Ownership

| Stage | Stage-owned product artifacts | Default task artifacts created on entry |
| --- | --- | --- |
| `prd` | `PRD.md` | `tasks/PRD/01-prd-from-brief.md` |
| `spec` | `SPEC.md` | `tasks/SPEC/01-spec-from-prd.md` |
| `plan` | `PLAN.md` | `tasks/PLAN/01-plan-from-spec.md` |
| `implementation` | none by default | none by default |
| `verification` | `VERIFICATION.md` | none by default |
| `audit` | `AUDIT.md` | `tasks/AUDIT/01-debrief.md`, `tasks/AUDIT/02-touchdown.md` |

`BRIEF.md` is mission-owned, not stage-owned.

## Transition Flow

Only `Mission` may advance the workflow.

When workflow events complete the current stage and unlock the next eligible stage:

1. `Mission` validates delivery state, adjacency, and prior-stage completion.
2. `Mission` asks the target `Stage` to enter.
3. The stage materializes any missing stage artifacts and default task artifacts.
4. The first dependency-ready task in that stage may be activated.
5. Status is recomputed from the materialized filesystem state.

Stage entry is idempotent. Re-entering a stage must not overwrite an existing artifact or task file.

All markdown scaffolding now lives under [packages/core/src/templates/mission/index.ts](/home/ronald/mission/packages/core/src/templates/mission/index.ts), with the actual template bodies split across a mirrored tree of mission-level product files and default task files.

## Status Model

Mission status is derived from the filesystem at runtime, but mutable workflow truth comes from `mission.json` rather than task frontmatter.

- stages that have not been entered yet have zero tasks and usually no product artifacts
- the current stage is the first populated stage with incomplete tasks, or the last populated stage if all tasks are complete
- product artifacts only appear in `MissionStatus.productFiles` after their owning mission or stage has materialized them in the tracked mission dossier
- task definition metadata such as `dependsOn` stays in the task markdown file
- runtime status exposes `activeTasks` and `readyTasks`, so independent tasks can proceed in parallel inside one stage

The daemon may also expose preparation state before a local mission workspace exists. That preparation state is control-plane information about the mission-start proposal, not proof that a local workspace has been materialized.

## Current Non-Goal

Automatic agent spawning is intentionally out of scope for this pass.

The important architectural correction is already in place: if agent spawning later becomes automatic, it should be initiated from `Task`, not from `Factory` or the filesystem layer.
