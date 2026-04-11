---
layout: default
title: Semantic Model
parent: Architecture
nav_order: 2
---

# Semantic Model

The Semantic Model defines the core set of primitives that represent operator intent. It relies strictly on a deterministic hierarchy of operations. It separates specification intent from runtime consequences.

## The Hierarchy

Mission executes across this exact tree: `Repository` -> `Mission` -> `Stage` -> `Task` -> `Session`.

### 1. Repository
The container boundaries. The operator works in exactly one active repository workspace at a time. The repository guarantees context.

### 2. Mission
The overarching objective (e.g., "Refactor to React 19"). Missions transition across: `draft`, `ready`, `running`, `paused`, `panicked`, `completed`, `delivered`.

### 3. Stage
A projection grouping Tasks around a phase of work. Stages exist structurally (e.g. `prd`, `spec`, `implementation`) but are bounded logically by task dependencies and gates.

### 4. Task
The atomic unit of orchestrated work. Tasks contain defined inputs, capability allowances, and strict outputs. A task transitions through `.mission/` boundaries from `ready` to `completed`.

### 5. Session
An ephemeral agent/LLM-driven process meant to satisfy a task. A task can spawn many sessions over its lifetime, resolving them to the main record if they succeed.

## Invariants & Design Principles

*   **State Separation**: Static documents (ex: `.md` tasks) define intent, while `mission.json` defines *execution context*.
*   **Dependency DAG**: The workflow moves linearly or asynchronously depending purely on the completed edges of tasks in the active Stage.
*   **Projections, Not Objects**: Things like "Gate Progression" natively exist as queries on the `WorkflowState`, derived over event logs, rather than mutable classes storing `.isComplete` flags individually.
