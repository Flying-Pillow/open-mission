---
layout: default
title: Repository And Dossier
parent: Architecture
nav_order: 2
---

Mission uses a repository-owned control namespace rooted at `.mission/`. That namespace holds repository policy, validated workflow law, and tracked mission dossiers. External worktrees are local materializations; they are not the semantic source of truth for tracked mission history. A live Mission runs as a daemon-owned running Mission instance that can continue without any Airport surface connected.

## Storage Topology

| Location | Current implementation role | Authority |
| --- | --- | --- |
| `.mission/settings.json` | Repository daemon and control settings | daemon settings writers |
| `.mission/workflow/workflow.json` | Repository-owned Mission workflow definition | `WorkflowSettingsStore` |
| `.mission/workflow/templates/` | Repository-owned workflow template corpus | repository initialization and workflow preset scaffolding |
| `.mission/missions/<mission-id>/` | Canonical tracked mission dossier | `Mission`, Mission dossier state store, raw dossier I/O adapters |
| `.mission/missions/<mission-id>/mission.json` | Mission runtime data | Mission state store runtime dossier checkpointing |
| `.mission/missions/<mission-id>/mission.events.jsonl` | Mission runtime event log | Mission state store runtime dossier checkpointing |
| `.mission/missions/<mission-id>/<stage>/...` | Stage artifacts and generated task files | Workflow generation/materialization path |
| `~/.config/mission/config.json` or `$XDG_CONFIG_HOME/mission/config.json` | Machine-local Mission roots and managed tool paths | `config.ts` |
| External mission worktree root | Local checkout for doing work | Worktree materialization logic, not dossier identity |
| `$XDG_RUNTIME_DIR/mission` or temp runtime directory | Daemon socket, manifest, and optional runtime state | Daemon runtime only |

## Canonical Repository Layout

```text
<repo>/
    .mission/
        settings.json
        workflow/
            workflow.json
            templates/
        missions/
            <mission-id>/
                BRIEF.md
                mission.json
                01-PRD/
                02-SPEC/
                03-IMPLEMENTATION/
                04-AUDIT/
                05-DELIVERY/
```

## Initialization Surfaces

| Surface | Responsibility | Important behavior |
| --- | --- | --- |
| `initializeMissionRepository(...)` | Low-level repository scaffolding | Creates `.mission/`, control settings, and the repository-owned workflow preset |
| `WorkflowSettingsStore.initialize()` | Initializes repository workflow settings | Writes the initial Mission workflow definition into `.mission/workflow/workflow.json` and scaffolds templates |
| `Factory.create(...)` | Mission creation and first `Mission` hydration | Resolves mission identity, worktree path, and mission descriptor |

## Running Mission Authority

The repository-owned workflow definition and the daemon-owned running Mission instance have different roles.

| Concept | Role | Must not become |
| --- | --- | --- |
| Mission workflow definition | Repository-owned validated workflow law for stage order, task generation, gates, artifact expectations, and execution constraints | a Mission subclass, a daemon projection, or an implicit fallback blob |
| Running Mission instance | Daemon-owned authoritative Mission aggregate for one live Mission | a surface-owned model, a passive data wrapper, or a workflow-specific implementation |

One Mission class must execute every validated Mission workflow definition through the same stable Mission authority surface. A repository may vary workflow law; it must not vary the Mission class model. The running Mission instance owns Mission lifecycle behavior, child coordination, and read projection while the workflow definition supplies configurable workflow law.

## Mission Identity And Paths

The system distinguishes three different paths that often get conflated:

| Path | Meaning |
| --- | --- |
| Repository root | The control root for `.mission/` and repository policy |
| Mission dossier root | The tracked directory under `.mission/missions/<mission-id>/` |
| Mission worktree path | The external checkout created under the configured mission workspace root |

The implementation keeps the dossier root and the mission worktree distinct on purpose. `MissionDescriptor.missionDir` points at the dossier root, while operator-facing views may expose the worktree path as the practical workspace for editing.

## Dossier Contents

| File or folder | Purpose | Produced by |
| --- | --- | --- |
| `BRIEF.md` | Intake anchor for the mission | Mission creation flow |
| `mission.json` | Persistent runtime data | Mission state store runtime dossier checkpointing |
| `mission.events.jsonl` | Append-only runtime event log | Mission state store runtime dossier checkpointing |
| `01-PRD/PRD.md` | Requirements artifact | Artifact materialization |
| `02-SPEC/SPEC.md` | Technical specification artifact | Artifact materialization |
| `03-IMPLEMENTATION/VERIFY.md` | Verification artifact for implementation stage | Artifact materialization |
| `04-AUDIT/AUDIT.md` | Audit artifact | Artifact materialization |
| `05-DELIVERY/DELIVERY.md` | Delivery artifact | Artifact materialization |
| `*/tasks/*.md` | Generated or replayed task records | Workflow task generation path |
| `session-logs/*.log` | Daemon-owned Agent session audit logs, not Mission artifacts by default | Agent session runtime |

## Ownership Rules

1. `.mission/settings.json` and `.mission/workflow/` are repository policy, not mission execution history.
2. `.mission/workflow/workflow.json` is repository workflow law; a running Mission instance applies it but does not redefine it.
3. `mission.json` and `mission.events.jsonl` are mission execution history, not daemon-wide live state.
4. Task markdown files are materialized mission artifacts, not the only runtime authority once `mission.json` exists.
5. Raw Agent session logs are daemon-owned audit material. Curated summaries, extracted test output, patch notes, or implementation notes become Mission artifacts only when explicitly promoted.
6. Machine-local config remembers repositories and local tool defaults; it is never the repository's source of truth.
7. Airport surfaces may control or observe a Mission, but they are not required for the running Mission instance to exist or continue.

## Relationship To Replay Anchors

This page is the architecture home for the replayed mission "Repository Adoption And Mission Dossier Layout" and should be read alongside `specifications/mission/model/repository-layout-and-adoption.md` and the replay dossiers rooted at `.mission/missions/11-*`.
