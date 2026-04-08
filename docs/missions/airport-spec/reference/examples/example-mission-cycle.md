---
layout: default
title: Example Mission Cycle
parent: Airport Spec Mission
grand_parent: Missions
nav_order: 8
---

# Example Mission Cycle

This document describes a target end-to-end Mission cycle as an executable object model example.

It is intentionally written as a behavioral reference, not as a literal description of every current implementation detail.

The key architectural assumption in this example is:

- `Mission` owns workflow policy and stage progression.
- `Stage` owns stage scaffolding and default task creation.
- `Task` owns task execution.
- `AgentSession` is owned by `Task`, not by `Mission`.

That last point is the important correction: Mission should decide whether a task may run, but the running session itself belongs to the task that spawned it.

## Example Mission

Example mission:

- Title: `Task-owned agent sessions`
- Goal: refactor Mission so agent sessions are task-owned instead of mission-owned

Canonical product flow in this example:

1. `BRIEF.md` provides the intake context.
2. `PRD.md` is generated from the brief.
3. `SPEC.md` is generated from the PRD.
4. `PLAN.md` is generated from the spec and defines implementation and verification slices.
5. implementation task markdown files are then executed sequentially.
6. `VERIFICATION.md` and verification tasks close the technical validation loop.
7. `AUDIT.md` and audit tasks close the delivery loop.

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Operator
    participant Client as Client Mission/Stage/Task
    participant DaemonClient
    participant Daemon
    participant Mission
    participant Stage
    participant Task
    participant AgentSession
    participant Runtime
    participant FS as FilesystemAdapter

    Operator->>Client: start mission from brief
    Client->>DaemonClient: mission.start
    DaemonClient->>Daemon: request
    Daemon->>Mission: create/load via Factory
    Mission->>FS: initialize mission folder
    Mission->>Stage: enter PRD
    Stage->>FS: scaffold BRIEF.md and PRD.md if missing
    Stage->>FS: create tasks/PRD/01-prd-from-brief.md
    Mission->>Task: start first PRD task
    Task->>FS: set task status running in mission.json
    Task->>AgentSession: spawn for 01-prd-from-brief.md
    AgentSession->>Runtime: create session and submit turn
    Runtime-->>AgentSession: fills PRD.md from task instruction
    Runtime-->>AgentSession: session completes
    AgentSession->>Task: completed with output/state
    Task->>FS: set task done in mission.json
    Task-->>Mission: task complete
    Mission->>Mission: if PRD tasks complete, mark PRD done

    Mission->>Stage: enter SPEC
    Stage->>FS: scaffold SPEC.md
    Stage->>FS: create tasks/SPEC/01-spec-from-prd.md
    Mission->>Task: start first SPEC task
    Task->>FS: set task status running
    Task->>AgentSession: spawn for 01-spec-from-prd.md
    AgentSession->>Runtime: submit SPEC generation turn
    Runtime-->>AgentSession: fills SPEC.md from PRD.md
    Runtime-->>AgentSession: session completes
    AgentSession->>Task: completed
    Task->>FS: set task done
    Task-->>Mission: task complete
    Mission->>Mission: if SPEC tasks complete, mark SPEC done

    Mission->>Stage: enter PLAN
    Stage->>FS: scaffold PLAN.md
    Stage->>FS: create tasks/PLAN/01-plan-from-spec.md
    Mission->>Task: start first PLAN task
    Task->>FS: set task status running
    Task->>AgentSession: spawn for 01-plan-from-spec.md
    AgentSession->>Runtime: submit planning turn
    Runtime-->>AgentSession: fills PLAN.md and creates implementation and verification tasks
    Runtime-->>AgentSession: session completes
    AgentSession->>Task: completed
    Task->>FS: set task done
    Task-->>Mission: task complete
    Mission->>Mission: if PLAN tasks complete, mark PLAN done

    Mission->>Stage: enter IMPLEMENTATION

    loop sequential implementation tasks
        Mission->>Task: start next implementation task
        Task->>FS: set task status running
        Task->>AgentSession: spawn for current implementation task markdown
        AgentSession->>Runtime: submit implementation turn
        Runtime-->>AgentSession: changes code/artifacts per task instruction
        Runtime-->>AgentSession: session completes
        AgentSession->>Task: completed
        Task->>FS: set task done
        Task-->>Mission: task complete
        Mission->>Mission: if more tasks remain, continue
    end

    Mission->>Mission: when implementation tasks complete, mark IMPLEMENTATION done

    Mission->>Stage: enter VERIFICATION
    Stage->>FS: scaffold VERIFICATION.md
    Stage->>FS: create verification task files
    Mission->>Task: execute verification tasks sequentially
    Task->>AgentSession: spawn verification sessions
    AgentSession->>Runtime: run verification work
    Runtime-->>AgentSession: records evidence in VERIFICATION.md
    AgentSession->>Task: completed
    Task->>FS: set verification task done
    Mission->>Mission: when verification tasks complete, mark VERIFICATION done

    Mission->>Stage: enter AUDIT
    Stage->>FS: scaffold AUDIT.md
    Stage->>FS: create audit task files
    Mission->>Task: execute audit tasks sequentially
    Task->>AgentSession: spawn audit sessions
    AgentSession->>Runtime: run audit work
    Runtime-->>AgentSession: records findings in AUDIT.md
    AgentSession->>Task: completed
    Task->>FS: set audit task done
    Mission->>Mission: when audit tasks complete, mark AUDIT done

    Mission->>FS: set deliveredAt in mission.json
    Mission-->>Daemon: mission delivered
    Daemon-->>DaemonClient: status response
    DaemonClient-->>Client: final mission status
    Client-->>Operator: delivered
```

## Step Analysis

### 1. Intake

Actors:

- Operator
- Client `Mission`
- `Daemon`
- `Factory`
- daemon `Mission`

Products:

- `BRIEF.md`
- mission directory
- `mission.json`

Notes:

- The mission begins from brief context only.
- At this point there is no agent session yet.

### 2. PRD Stage Start

Actors:

- daemon `Mission`
- `Stage(prd)`
- `Task(prd/01-prd-from-brief.md)`
- `FilesystemAdapter`

Products:

- `PRD.md`
- `tasks/PRD/01-prd-from-brief.md`
- task control state in `mission.json`

Notes:

- Stage owns scaffolding.
- Task file is the execution contract for the next actor.

### 3. PRD Task Execution

Actors:

- daemon `Task`
- `AgentSession`
- runtime provider

Products:

- updated `PRD.md`
- session record under the machine-local daemon runtime directory keyed by repo root
- task state update in `mission.json`

Notes:

- This is the step that justifies task-owned sessions.
- The session exists because a task is running, not because the mission generally exists.

### 4. Stage Completion Check

Actors:

- daemon `Mission`

Products:

- updated stage status in derived `MissionStatus`

Notes:

- `Mission` should not do task work.
- `Mission` only evaluates whether all tasks in the current stage are done.

### 5. SPEC Stage Start and Execution

Actors:

- daemon `Mission`
- `Stage(spec)`
- `Task(spec/01-spec-from-prd.md)`
- `AgentSession`

Products:

- `SPEC.md`
- `tasks/SPEC/01-spec-from-prd.md`
- updated `mission.json`

Notes:

- The SPEC task consumes PRD as input and produces SPEC as output.

### 6. PLAN Stage Start and Execution

Actors:

- daemon `Mission`
- `Stage(plan)`
- `Task(plan/01-plan-from-spec.md)`
- `AgentSession`

Products:

- `PLAN.md`
- `tasks/PLAN/01-plan-from-spec.md`
- later implementation task files generated from the plan
- later verification task files generated from the plan

Notes:

- `PLAN` is its own lifecycle stage, not a prelude hidden inside implementation.
- That gives implementation a formal decomposition checkpoint before code-writing tasks begin.
- The plan task is the point where the mission expands into concrete implementation and verification work.

### 7. Sequential Implementation Tasks

Actors:

- daemon `Mission`
- daemon `Task`
- `AgentSession`
- runtime provider

Products:

- source-code changes
- artifact updates as needed
- task markdown files for each implementation slice
- task state updates in `mission.json`

Notes:

- Mission starts only the next eligible task.
- Each task owns exactly one active execution session at a time.
- This gives a clean invariant: active session follows active task.

### 8. Verification Cycle

Actors:

- daemon `Mission`
- `Stage(verification)`
- verification `Task`
- `AgentSession`

Products:

- `VERIFICATION.md`
- verification task files
- verification evidence

Notes:

- Verification is not just a status flag.
- It is its own stage with its own products and task execution loop.

### 9. Audit Cycle

Actors:

- daemon `Mission`
- `Stage(audit)`
- audit `Task`
- `AgentSession`

Products:

- `AUDIT.md`
- audit task files
- delivery readiness findings

Notes:

- Audit is the governance stage before delivery.

### 10. Delivery

Actors:

- daemon `Mission`
- `FilesystemAdapter`

Products:

- `mission.json` with `deliveredAt`

Notes:

- Delivery is a mission-level policy transition.
- No session is required for the delivery state transition itself.

## Architectural Conclusion

This example implies the following object model:

- `Mission` owns stage orchestration and workflow policy.
- `Stage` owns scaffolding and default task definition.
- `Task` owns execution and completion.
- `AgentSession` is a child of `Task` and represents a concrete execution attempt.

That means session persistence should conceptually hang off the task lifecycle, even if the runtime state file remains machine-local outside the repository.

## Testability Value

This example can later become a behavioral test fixture.

The most useful assertions would be:

1. starting a mission enters PRD and creates exactly the PRD stage products
2. starting a task creates a task-owned session
3. finishing the session marks the task done
4. finishing all tasks marks the stage done
5. finishing a stage starts the next stage only when its prerequisites are satisfied
6. delivery writes only mission-level completion state