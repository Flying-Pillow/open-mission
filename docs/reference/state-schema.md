---
layout: default
title: State Schema
parent: Reference
nav_order: 2
---

# State Schema

Mission uses multiple state scopes on purpose. The daemon-wide snapshot, the airport registry, and the mission-local runtime record solve different problems and should not be collapsed into a single mental model.

## Daemon-Wide System Snapshot

The daemon-wide composite snapshot is `MissionSystemSnapshot`:

```ts
type MissionSystemSnapshot = {
  state: MissionSystemState;
  airportProjections: AirportProjectionSet;
  airportRegistryProjections: Record<string, AirportProjectionSet>;
}
```

This is the state surface that Tower and other clients consume from the daemon.

### `MissionSystemState`

`MissionSystemState` packages three concerns:

| Field | Responsibility |
| --- | --- |
| `version` | Monotonic daemon snapshot version |
| `domain` | Semantic context graph for repository, mission, task, artifact, and session selection |
| `airport` | Active repository airport state |
| `airports` | Registry of repository airports and their persisted intents |

This is daemon-wide state. It is not stored in `mission.json`.

## `ContextGraph`

`ContextGraph` is the daemon's semantic domain graph:

```ts
type ContextGraph = {
  selection: ContextSelection;
  repositories: Record<string, RepositoryContext>;
  missions: Record<string, MissionContext>;
  tasks: Record<string, TaskContext>;
  artifacts: Record<string, ArtifactContext>;
  agentSessions: Record<string, AgentSessionContext>;
}
```

Its role is selection and projection, not mission execution persistence. It tells the daemon and surfaces:

- which repository is selected
- which mission is selected
- which task, artifact, or session is selected
- what mission, task, artifact, and session contexts currently exist

This is derived daemon state built from workspace discovery and mission status, not a mission-local persisted workflow record.

## Airport State Versus Airport Registry State

`MissionSystemState.airport` is the active airport state for the currently scoped repository.

`MissionSystemState.airports.repositories` is the repository airport registry. Each entry stores:

- `repositoryId`
- `repositoryRootPath`
- `airport`
- `persistedIntent`

This means there are two airport views in the daemon snapshot:

- the active airport that current surfaces are centered on
- the broader registry of repository-scoped airport states known to the daemon

That distinction matters because the active airport is only one projection over a potentially larger multi-repository control set.

## Mission-Local Runtime Record

The per-mission persisted runtime record is `MissionRuntimeRecord` in `mission.json`:

```ts
type MissionRuntimeRecord = {
  schemaVersion: number;
  missionId: string;
  configuration: MissionWorkflowConfigurationSnapshot;
  runtime: MissionWorkflowRuntimeState;
  eventLog: MissionWorkflowEventRecord[];
}
```

This record is mission-local. It belongs to one mission workspace, not to the daemon as a whole.

### `MissionWorkflowConfigurationSnapshot`

This snapshot freezes workflow policy into the mission record:

- workflow version
- workflow source
- stage order
- stage launch policy
- human-in-the-loop settings
- panic settings
- execution settings
- gate definitions
- task generation rules

It is copied from global or repository settings at mission start and then becomes the mission's authoritative runtime policy.

### `MissionWorkflowRuntimeState`

The runtime section of `mission.json` contains:

- mission lifecycle
- pause state
- panic state
- stage projections
- task runtime state
- session runtime state
- airport pane projections
- launch queue
- last update timestamp

This is persisted execution state.

## Persisted State Versus Derived Projection

Mission deliberately mixes persisted facts with derived projections, but only inside the correct boundary:

| Scope | Persisted facts | Derived projections |
| --- | --- | --- |
| Daemon system snapshot | Active and registry airport state, semantic context graph, version | Airport projections for active and registry airports |
| Mission runtime record | Configuration snapshot, mission lifecycle, task state, session state, pause and panic state, launch queue, event log | Stage projections and airport pane projections stored inside runtime after reducer normalization |

Two distinctions are especially important:

1. `mission.json` does not contain airport pane bindings, panel registrations, or substrate pane ids.
2. `MissionSystemSnapshot` does not replace the mission runtime record for per-mission execution semantics.

## Repository Control State Versus Mission Execution State

Repository control state is separate again:

- `.mission/settings.json` stores repository-scoped daemon and workflow defaults
- `mission.json` stores one mission's execution runtime

This is the practical division of responsibility:

| State location | What it is |
| --- | --- |
| `.mission/settings.json` | Repository policy and control defaults |
| `MissionSystemSnapshot` | Live daemon-wide composite state and airport projections |
| `mission.json` | Mission-local persisted execution record |

For an adopting team, this is the main schema rule to remember: repository control state, daemon control-plane state, and mission execution state are separate on purpose. Mission is safer when those layers remain explicit.