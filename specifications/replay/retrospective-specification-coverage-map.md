---
layout: default
title: Retrospective Specification Coverage Map
parent: Plans
nav_order: 6
---

# Retrospective Specification Coverage Map

This document records how the existing specification corpus maps onto the five curated retrospective replay missions.

Its purpose is to make specification preservation explicit, architecture-aligned, and auditable.

It is not a replay mission itself.

It is the coverage ledger for the replay set.

## Coverage Model

Each substantive source specification receives:

- an architecture owner
- one primary replay mission
- zero or more secondary replay missions
- a preservation note explaining how the content should appear in replay

Rules:

1. Each substantive source document has exactly one primary replay mission.
2. A source document may contribute to additional replay missions when the current architecture genuinely spans those boundaries.
3. Secondary coverage must be explicit and justified by architecture ownership, not by convenience.
4. Navigational index pages are not treated as substantive source specifications unless they add normative content beyond navigation.

## Replay Missions

1. Repository Adoption And Mission Dossier Layout
2. Mission Semantic Model
3. Workflow Engine And Repository Workflow Settings
4. Agent Runtime Unification
5. Airport Control Plane

## Source Specification Coverage

| Source Document | Kind | Architecture Owner | Primary Replay Mission | Secondary Replay Missions | Preservation Notes |
| --- | --- | --- | --- | --- | --- |
| `specifications/mission/model/repository-layout-and-adoption.md` | normative spec | repository adoption and tracked dossier architecture | 1 | 2 | Preserve the canonical `.mission` layout, Repository setup, repository modes, repo routing, and mission dossier shape in mission 1. Mission 2 may reference it where semantic model records depend on the repository layout boundary. |
| `specifications/mission/model/mission-model.md` | normative spec | semantic mission repository model and mission-local records | 2 | 1, 3 | Preserve mission contexts, mission runtime, stage and task semantic records, and storage-scope distinctions in mission 2. Mission 1 may preserve the repository-layout portions needed for adoption context. Mission 3 may preserve the workflow-runtime portions needed where runtime semantics become authoritative. |
| `specifications/mission/model/core-object-model.md` | normative spec | canonical core semantic object model and ownership boundaries | 2 | 3, 4, 5 | Preserve the object-model naming system and ownership boundaries primarily in mission 2. Later missions should preserve only the architecture-specific slices relevant to workflow runtime, agent runtime, and airport control plane integration. |
| `specifications/mission/workflow/workflow-engine.md` | normative spec | mission-local workflow runtime truth and reducer semantics | 3 | 2, 4, 5 | Preserve workflow snapshot semantics, runtime state, event model, reducer rules, task generation, launch, pause, and restart behavior in mission 3. Other missions may reference it where their contracts depend on workflow truth. |
| `specifications/mission/configuration/repository-workflow-settings.md` | normative spec | repository-level workflow policy initialization and mutation | 3 | 1 | Preserve daemon-owned workflow settings initialization, update, persistence, and validation behavior in mission 3. Mission 1 may reference Repository setup implications for settings materialization. |
| `specifications/mission/execution/agent-runtime.md` | normative spec | provider-neutral session execution boundary | 4 | 3, 5 | Preserve runner, session, prompt, command, reconciliation, and daemon-owned control boundaries in mission 4. Mission 3 may reference workflow request execution dependencies. Mission 5 may reference airport projection and control-plane integration boundaries. |
| `specifications/airport/airport-control-plane.md` | normative spec | daemon-wide application controller and airport layout authority | 5 | 4 | Preserve shared state root, airport layout truth, gate bindings, projections, and terminal substrate reconciliation in mission 5. Mission 4 may preserve the runtime-facing integration boundary only. |
| `specifications/checklists/workflow-engine-checklist.md` | normative checklist | workflow-engine implementation contract and sequencing | 3 | none | Preserve the deterministic implementation contract for the workflow engine in mission 3 as supporting checklist material, not as a separate architectural mission. |
| `specifications/mission/model/index.md` | navigation index | navigation only | none | none | Non-substantive index page. No separate preservation target beyond the normative documents it links to. |
| `specifications/mission/execution/index.md` | navigation index | navigation only | none | none | Non-substantive index page. No separate preservation target beyond the normative document it links to. |

## Coverage Assertions

This coverage map currently asserts the following:

1. The existing source corpus is centered on the same five architecture areas as the replay mission decomposition.
2. The mission-model documents are the main cross-cutting sources and therefore require the most careful primary versus secondary preservation discipline.
3. Workflow, agent-runtime, and airport-control-plane specifications must remain distinct even when they reference one another, because the current architecture assigns them different authorities.
4. The checklist is preserved as implementation-contract support for mission 3 rather than promoted into its own replay mission.

## Verification Use

During replay, use this document to verify:

1. every substantive source document has a recorded home in the replay set
2. each replay mission `SPEC.md` preserves the correct source material
3. cross-mission references are explicit where one source legitimately feeds more than one mission
4. no source document is silently dropped, flattened into the wrong mission, or duplicated without architectural justification

If replay reveals that this mapping is wrong or incomplete, update this document and record the lesson in the retrospective experience log.
