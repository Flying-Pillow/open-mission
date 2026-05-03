---
layout: default
title: Current Architecture Notes
parent: Architecture
nav_order: 99
---

# Current Architecture Notes

This page records current architecture boundaries that need precise vocabulary.

<div class="mission-status-grid">
 <div class="mission-status-card mission-status-card--current">
  <strong>Current implementation</strong>
  <p>Use the repository code, routed CLI, and persisted runtime data as the operational authority for what Mission ships right now.</p>
 </div>
 <div class="mission-status-card mission-status-card--target">
  <strong>Architecture direction</strong>
  <p>Use the architecture pages and ADRs as the source for the cleaner shape Mission is converging on.</p>
 </div>
</div>

## 1. Workflow Gates And Airport Panes Use Different Vocabularies

- Workflow gates in `mission.json` use gate ids such as `implement`, `verify`, `audit`, and `deliver`.
- Airport panes in `packages/airport/src/types.ts` use pane ids such as `tower`, `briefingRoom`, and `runway`.

They are both first-class, but they mean different things. One is workflow progression. The other is Airport layout topology.

## 2. There Are Two Task State Models On Purpose

- `MissionTaskRuntimeState` uses workflow lifecycle values such as `pending`, `ready`, `queued`, `running`, `blocked`, and `completed`.
- `MissionTaskState` uses simplified operator-facing values such as `todo`, `active`, `blocked`, and `done`.

This is not merely duplication. It is an intentional split between execution truth and operator summary, but it is easy to misread as inconsistency.

## 3. Session Persistence Is A Hook, Not Yet A Universal Hard Requirement

The runtime architecture exposes session-persistence hooks, and a daemon-owned control layer may save and reload normalized session references or snapshots through them. But the core mission path does not always supply a concrete persisted store. The workflow architecture should therefore be described as supporting runtime session persistence hooks rather than requiring a single always-on persisted session store.

## 4. Repository Control State, Daemon Snapshot State, And Mission Execution State Are Separate

Mission separates them clearly:

- `.mission/settings.json` is repository control state
- `MissionSystemSnapshot` is live daemon-wide state
- `mission.json` is mission execution state

Any document that compresses those into one "Mission state" concept is underspecified.

## 5. Core Folder Boundaries

The current `packages/core/src` structure promotes mission, repository, workspace, and agent concerns to first-class folders:

- `src/mission`
- `src/repository`
- `src/workspace`
- `src/agent`

The current tree and imports are the operational authority.
