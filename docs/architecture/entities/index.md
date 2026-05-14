---
layout: default
title: Entity Reference
parent: Architecture
nav_order: 4
has_children: true
description: Canonical Mission Entity ownership map and ERD.
---

# Entity Reference

Mission uses thick Entity classes with one schema boundary and one contract boundary per first-class Entity. This section is the reference map for explaining every Entity schema, function, and module. If a shape or module cannot be placed in this ERD or in the owning Entity document, the name or ownership is suspect.

## Entity Documents

- [Entity](entity.md)
- [Repository](repository.md)
- [Mission](mission.md)
- [Stage](stage.md)
- [Task](task.md)
- [Artifact](artifact.md)
- [Agent](agent.md)
- [AgentExecution](agent-execution.md)
- [Terminal](terminal.md)
- [System](system.md)

## Complete ERD

```mermaid
erDiagram
    ENTITY ||--|| REPOSITORY : specializes
    ENTITY ||--|| MISSION : specializes
    ENTITY ||--|| STAGE : specializes
    ENTITY ||--|| TASK : specializes
    ENTITY ||--|| ARTIFACT : specializes
    ENTITY ||--|| AGENT : specializes
    ENTITY ||--|| AGENT_EXECUTION : specializes
    ENTITY ||--|| TERMINAL : specializes
    ENTITY ||--|| SYSTEM : specializes

    REPOSITORY ||--o{ MISSION : hosts-dossiers
    REPOSITORY ||--o{ ARTIFACT : roots-files
    REPOSITORY ||--o{ AGENT_EXECUTION : scopes-repository-work

    MISSION ||--o{ STAGE : owns-workflow-stages
    MISSION ||--o{ TASK : coordinates-tasks
    MISSION ||--o{ ARTIFACT : relates-mission-artifacts
    MISSION ||--o{ AGENT_EXECUTION : references-scoped-executions

    STAGE ||--o{ TASK : groups
    STAGE ||--o{ ARTIFACT : relates-stage-artifacts

    TASK ||--o{ ARTIFACT : uses-task-artifacts
    TASK ||--o{ AGENT_EXECUTION : references-task-scoped-executions

    ARTIFACT ||--o{ AGENT_EXECUTION : scopes-artifact-work

    AGENT ||--o{ AGENT_EXECUTION : is-executed-by
    AGENT_EXECUTION ||--|| AGENT_EXECUTION_PROCESS : owns-process
    AGENT_EXECUTION ||--o{ ARTIFACT : context-references
    AGENT_EXECUTION ||--o{ ENTITY_REFERENCE : context-references
    AGENT_EXECUTION ||--o{ AGENT_EXECUTION_JOURNAL : writes-semantic-log
    AGENT_EXECUTION ||--o| TERMINAL : attaches-transport
    TERMINAL ||--o{ TERMINAL_RECORDING : records-transport

    SYSTEM ||--o{ REPOSITORY : reports-status-for
    SYSTEM ||--o{ AGENT_EXECUTION : reports-runtime-health
    SYSTEM ||--o{ TERMINAL : reports-terminal-health
```

## Reading Rules

- `<Entity>.ts` owns behavior, invariants, lifecycle, and remote method implementations.
- `<Entity>Schema.ts` owns serializable shapes for that Entity boundary.
- `<Entity>Contract.ts` owns declarative method, event, and schema binding metadata.
- `AgentExecutionSchema` is the complete hydrated AgentExecution Entity data contract.
- `AgentExecutionStorageSchema` is the narrower persisted/recoverable shape.
- AgentExecution owner routing is expressed by `AgentExecutionScope`, `ownerId`, and Entity events. There is no separate owner-specific AgentExecution view or record model.
