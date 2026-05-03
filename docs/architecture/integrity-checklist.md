---
layout: default
title: Integrity Checklist
parent: Architecture
nav_order: 12
---

# Integrity Checklist

Use this page to verify that architecture claims still match code, specs, and replayed mission dossiers.

## Coverage Checklist

| Concern | Architecture page | Main implementation anchors | Replay/spec anchors |
| --- | --- | --- | --- |
| Repository adoption and `.mission` layout | `repository-and-dossier.md` | `initializeMissionRepository.ts`, `repoConfig.ts`, `daemonConfig.ts` | `.mission/missions/11-*`, `specifications/mission/model/repository-layout-and-adoption.md` |
| Semantic entity model | `semantic-model.md` | `packages/core/src/types.ts`, `workflow/manifest.ts`, `daemon/system/MissionControl.ts` | `.mission/missions/15-*`, `specifications/mission/model/*` |
| Workflow runtime and settings | `workflow-engine.md`, `contracts.md` | `workflow/engine/*`, `settings/WorkflowSettingsStore.ts` | `.mission/missions/16-*`, `specifications/mission/workflow/workflow-engine.md` |
| Agent runtime unification | `agent-runtime.md` | `runtime/*`, `adapters/*` | `.mission/missions/17-*`, `specifications/mission/execution/agent-runtime.md` |
| Airport control plane | `airport-control-plane.md`, `airport-terminal-surface.md` | `packages/airport/*`, `MissionSystemController.ts`, tower bootstrap files | `.mission/missions/18-*`, `specifications/airport/airport-control-plane.md` |

## Referential-Integrity Questions

Ask these questions when changing the system:

1. Does the change move a source of truth from one boundary to another?
2. If `mission.json` semantics changed, did the workflow docs and `docs/reference/state-schema.md` change too?
3. If a new daemon method was introduced, is it documented in the contracts page and surfaced through `DaemonApi` if appropriate?
4. If a new airport target kind or pane rule exists, is it reflected in the airport page and projection logic?
5. If a surface starts owning control logic that used to belong to the daemon, is that actually intended or a boundary regression?

## Failure Indicators

These are architecture regressions, not cosmetic issues:

- Tower must not mutate mission execution state without going through daemon methods.
- Airport must not persist state into `mission.json`.
- Workflow code must not start treating zellij pane ids as mission runtime truth.
- Provider adapters must not become the authority for mission lifecycle transitions.
- Mission config must not become the canonical source of repository workflow policy.
