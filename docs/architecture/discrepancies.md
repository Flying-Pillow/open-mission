---
layout: default
title: Architectural Discrepancies
parent: Architecture
nav_order: 99
---

# Architectural Discrepancies

This document catalogs known gaps between current implementation, architectural specifications, and historical artifacts during the rewrite towards an architecture-first repository.

### Gap: Task Generation & Ingestion
*   **Specifications:** Assumes tasks are manually planned/written by an agent in `03-IMPLEMENTATION/tasks` and transparently picked up by the workflow engine as newly verified dependencies (per the "Retrospective Experience" spec).
*   **Implementation:** Currently, the code strongly expects a structured `tasks.request-generation` message mapping from exact templates to runtime objects. Engine lacks a verified ingestion path that takes spontaneous `TaskRuntimeState` objects from agent-authored markdown paths dynamically. (Product Gap / Issue #12).

### Gap: Stage vs Gate Naming
*   **Documentation:** Various `specifications/` entries use "Gate" to imply a "Stage Transition Boundary" (e.g., the transition from PRD to SPEC).
*   **Implementation:** `packages/airport` has established "Gate" as a UI layout slot (a panel) inside the Tower `AirportControl` plane. The semantic boundary should be strictly referred to as `WorkflowGateProjection`, distinct from `AirportGate`.

### Gap: Task / Session Hierarchy
*   **Historical Docs:** Describe "Session" as fully encapsulated *inside* a Task.
*   **Current Runtime:** The `AgentRunner` logic (in `packages/core/src/runtime/AgentRunner.ts`) treats sessions as runtime context objects invoked *for* a task, persisting `session_id`s onto tasks. While logically the child of a task, they physically map across the separate `AgentRuntime` subsystem orchestration layers rather than simple class instantiation chains.
