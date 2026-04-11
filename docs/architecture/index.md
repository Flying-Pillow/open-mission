---
layout: default
title: Architecture
nav_order: 5
has_children: true
---

# Mission Architecture

<section class="mission-section-hero">
<span class="mission-section-kicker">System Design</span>
<div class="mission-section-title">The structural foundation of the Mission operator experience.</div>
<p class="mission-section-lead">This comprehensive reference maps the components, contracts, boundaries, and persistence models that allow Mission to safely orchestrate complex, agentic engineering workflows.</p>
</section>

Mission's architecture is strictly partitioned into domain authorities. The codebase has made a clean break from scattered, legacy task-runners into a formalized, daemon-owned control plane, a reducer-driven workflow engine, and a runtime layer that evolves independently from the mission model.

## Subsystems

<div class="mission-section-grid mission-section-grid--three">
<a class="mission-section-card" href="{{ '/architecture/repository-and-dossier.html' | relative_url }}">
<span class="mission-section-card__eyebrow">Storage & Structure</span>
<span class="mission-section-card__title">Repository & Dossier</span>
<span class="mission-section-card__text">The physical layout of the system: how state is persisted safely on disk within the `.mission/` boundary.</span>
</a>
<a class="mission-section-card" href="{{ '/architecture/semantic-model.html' | relative_url }}">
<span class="mission-section-card__eyebrow">Domain Entities</span>
<span class="mission-section-card__title">Semantic Model</span>
<span class="mission-section-card__text">The core entities—Missions, Stages, Tasks, and Sessions—and their lifecycle properties.</span>
</a>
<a class="mission-section-card" href="{{ '/architecture/workflow-engine.html' | relative_url }}">
<span class="mission-section-card__eyebrow">Execution State</span>
<span class="mission-section-card__title">Workflow Engine</span>
<span class="mission-section-card__text">The reducer-driven orchestrator that ensures deterministic transitions, pauses, and panics.</span>
</a>
<a class="mission-section-card" href="{{ '/architecture/agent-runtime.html' | relative_url }}">
<span class="mission-section-card__eyebrow">Execution Contracts</span>
<span class="mission-section-card__title">Agent Runtime</span>
<span class="mission-section-card__text">The provider-neutral boundary that translates workflow intent into live agent sessions.</span>
</a>
<a class="mission-section-card" href="{{ '/architecture/airport-control-plane.html' | relative_url }}">
<span class="mission-section-card__eyebrow">UI & Layout Authority</span>
<span class="mission-section-card__title">Airport Control Plane</span>
<span class="mission-section-card__text">The daemon-owned system that manages layout, focus, and bounds for the Tower terminal.</span>
</a>
</div>

## System Context Map

```mermaid
graph TD
    classDef External fill:#2a2f3a,stroke:#3b404d,stroke-width:1px,color:#a5aebf;
    classDef Boundary fill:#1c2028,stroke:#007acc,stroke-width:2px,color:#e4e8f0;
    classDef Store fill:#1f242d,stroke:#a5aebf,stroke-width:1px,stroke-dasharray: 5 5,color:#e4e8f0;

    Operator[Operator] --> Tower[Tower Terminal UI]
    Tower -->|Observed State & Intent| Daemon[Mission Daemon]
    Daemon -->|Projections & Layout| Tower

    Daemon --> Airport[Airport Control Plane\n(Layout Engine)]
    Daemon --> Workflow[Workflow Engine\n(Reducer & Controller)]
    Daemon --> Runtime[Agent Runtime\n(Orchestrator)]

    Workflow <-->|Events & State| Storage[(.mission/ Storage)]
    Storage -.->|workflow.json| RepoSettings[Repository Settings]
    Storage -.->|mission.json| Dossier[Mission Dossier]

    Runtime --> Provider[LLM Provider / Model]

    class Operator,Provider External;
    class Tower,Daemon Boundary;
    class Storage,RepoSettings,Dossier Store;
```

## Architectural Boundaries & Contracts

The architecture is defined by several strict boundaries and contracts, ensuring no component bypasses the system's intended topologies:

1.  **UI is a Client of the Daemon**: The Tower terminal makes no decisions about workflow state, task progression, or layout structure. It renders panels (Gates) based on Airport Control projections and emits observed intents back to the Daemon.
2.  **Deterministic State Transitions**: All workflow state changes happen via a pure reducer function. Side effects only happen in response to \`WorkflowRequest\` objects yielded by the reducer.
3.  **Local-First Persistence**: No remote databases store the source of truth for a mission. The source of truth is strictly the \`.mission/missions/<id>/mission.json\` file inside the host Git repository.
4.  **Agnostic Execution**: The workflow engine is entirely insulated from which capabilities or LLM constraints are in play at the Agent Runtime layer. It issues a requirement for a task to be executed and waits for standardized status updates.

## Component Overview

| Subsystem | Primary Responsibility | Persisted State Source of Truth |
| :--- | :--- | :--- |
| **Repository settings** | Grounding the daemon in a workspace | \`.mission/workflow.json\` |
| **Mission Dossier** | Complete history and state of one mission | \`.mission/missions/<id>/mission.json\` |
| **Workflow Engine** | State transition validation | \`mission.json\` (runtime block) |
| **Agent Runtime** | Running LLMs/processes for a task | \`mission.json\` (session event log) |
| **Airport Control** | Deciding what the operator sees | Daemon config (Persisted intent) |
| **Tower Terminal** | Drawing pixels in the terminal | *None (Ephemeral)* |
