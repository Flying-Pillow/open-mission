---
layout: default
title: Repository Workflow Settings Plan
nav_exclude: true
---

# Repository Workflow Settings Plan

This document translates the repository workflow settings definition spec into implementation work.

It is intentionally concrete.

It defines:

- what must be implemented first
- what files must be introduced, refactored, or removed from the workflow-settings path
- what current scalar setup code must be isolated from repository workflow policy editing
- what tests must prove the daemon-owned settings contract before any surface work ships

This plan assumes the rules defined by the repository workflow settings specification.

## Implementation Law

The rewrite must follow these rules.

1. The daemon is the only authority allowed to initialize, validate, patch, and persist repository workflow settings.
2. No UI, CLI flow, extension view model, or webview may write `.missions/settings.json` directly.
3. Repository workflow settings updates must use RFC 6902 JSON Patch only.
4. No deep-partial merge API may exist for repository workflow settings.
5. The daemon revision token must be derived from on-disk file state, not from an in-memory counter.
6. Every update attempt must revalidate the expected revision against current disk state before persistence.
7. Atomic write semantics are mandatory: temp file plus rename only.
8. Mission workflow snapshots must not be captured during mission object creation if the mission is still `draft`.
9. The workflow snapshot must be captured exactly at the `draft` to `ready` transition.
10. Repository workflow settings changes must affect `draft` missions only; once a mission is `ready` or later, repository changes must not mutate that mission's snapshot.
11. Surface work is blocked until the daemon API, persistence, validation, revision, and snapshot timing are implemented and tested.
12. Existing scalar control settings support may remain, but it must be explicitly isolated from repository workflow settings APIs and command flows.
13. No compatibility shim may pretend the old scalar `field` or `value` setup flow is sufficient for workflow policy editing.

## Desired End State

At the end of this work, the system should have:

1. one repository workflow settings service in core
2. one daemon-owned persistence and revision path for `.missions/settings.json`
3. one daemon API for get, initialize, and update
4. one snapshot boundary at `draft` to `ready`
5. one client contract used by CLI and Tower or web surfaces
6. zero direct workflow-settings file writes from any surface
7. zero reuse of the scalar `control.settings.update` field or value flow for workflow settings mutations

## Phase Order

The order is strict.

### Phase 1: Core Types, Patch Semantics, And Validation

Define the repository workflow settings contract in code before touching daemon request routing.

Required output:

- typed request and response shapes for workflow settings get, initialize, and update
- RFC 6902 JSON Patch parsing and allow-list validation for workflow settings paths
- semantic validation for `WorkflowGlobalSettings`
- file-state-derived revision token generation
- reusable normalization from `createDefaultWorkflowSettings()`

This phase blocks all daemon routing and all surface work.

Do not add protocol methods until the core patch and validation code exists.

Implementation tasks:

1. Introduce a dedicated settings namespace under `packages/core/src/settings`.
2. Add a settings type file for workflow settings metadata, revision tokens, validation errors, and daemon payloads.
3. Add a JSON Patch helper module that validates allowed operations and allowed paths.
4. Add a semantic validator for `WorkflowGlobalSettings` after patch application.
5. Add a revision helper that computes a deterministic token from current file contents or an equally strict file-state fingerprint.
6. Add unit tests for patch acceptance, patch rejection, validation failures, and revision derivation.

### Phase 2: Daemon Persistence And API

Build the daemon-owned persistence path and the new control API before any client or UI refactor begins.

Required output:

- workflow settings store with atomic reads and writes
- conflict detection against out-of-band edits
- `control.workflow.settings.get`
- `control.workflow.settings.initialize`
- `control.workflow.settings.update`
- settings update event emission

After this phase, all repository workflow settings mutation must flow through the daemon only.

Implementation tasks:

1. Add a dedicated workflow settings store in core that reads `.missions/settings.json`, normalizes defaults, computes revision, and writes atomically.
2. Refactor `daemonConfig.ts` so the file-format helpers remain neutral, while workflow settings mutation moves into the new store.
3. Extend daemon protocol types with the new workflow settings methods and payloads.
4. Update `Workspace.ts` to route the new methods into the workflow settings store.
5. Emit `control.workflow.settings.updated` after successful persistence.
6. Keep `control.settings.update` available for scalar daemon settings only.
7. Add integration tests covering initialization, valid update, stale revision failure, and out-of-band edit conflict behavior.

Surface work is blocked until these tests pass.

### Phase 3: Mission Snapshot Integration

Fix the current workflow snapshot timing so repository workflow settings are captured at the right lifecycle boundary.

Required output:

- mission creation no longer hard-snapshots workflow configuration merely because a mission object was initialized
- `draft` missions remain linked to repository workflow settings until `ready`
- `draft` to `ready` captures the mission-local configuration snapshot into `mission.json`

This phase is mandatory before surfaces expose editable workflow policy, because otherwise repository edits would not match mission behavior.

Implementation tasks:

1. Refactor `MissionWorkflowController.initialize()` so it no longer eagerly persists the final workflow snapshot at mission initialization time for `draft` missions.
2. Move snapshot capture to the transition that changes lifecycle from `draft` to `ready`.
3. Update the document helpers so runtime initialization and configuration creation support the delayed snapshot boundary.
4. Refactor `Factory.ts` and `Workspace.ts` workflow binding resolution so new missions draw from repository workflow settings instead of hard-coded `createDefaultWorkflowSettings()` fallbacks except when the repository truly has no settings yet.
5. Add tests proving that repository workflow edits made while a mission is `draft` affect that mission when it becomes `ready`.
6. Add tests proving that once the mission reaches `ready`, later repository edits do not affect that mission.

### Phase 4: CLI Surface Integration

Only after Phases 1 through 3 are stable should the CLI setup and tower flows be refactored.

Required output:

- CLI client helpers for workflow settings get, initialize, and update
- workflow-settings-aware setup or control flow that emits RFC 6902 patch requests
- no direct file writes and no misuse of scalar field or value flow for workflow settings edits

Implementation tasks:

1. Extend the typed client-side daemon protocol facade with `DaemonControlApi` methods for the new workflow settings endpoints.
2. Update the CLI tower setup path to split scalar daemon settings from repository workflow settings editing.
3. Replace any workflow-policy editing logic that assumes one selected `field` and one freeform `value`.
4. Introduce guided patch construction in the CLI for common operations such as toggle, replace, reorder, and delete.
5. Render daemon-side validation errors and `SETTINGS_CONFLICT` without local fallback logic.
6. Add CLI-focused tests for emitted daemon requests and conflict recovery behavior.

### Phase 5: Tower And Web Surface Integration

After the daemon and CLI contracts are proven, wire the extension and tower or web surfaces to the same API.

Required output:

- Mission operator client support for workflow settings methods
- Tower or web panel that shows effective workflow settings and revision state
- live refresh behavior on `control.workflow.settings.updated`
- no surface-local patch semantics

Implementation tasks:

1. Extend the extension-side operator client to call the new daemon methods.
2. Add view-model state for workflow settings payload, revision token, validation errors, and save conflicts.
3. Add tower or web UI components that edit workflow settings through daemon requests only.
4. Subscribe to the workflow settings update event and refresh the UI state on notification.
5. Add surface contract tests for refresh-on-event, validation error rendering, and stale revision handling.

### Phase 6: Cleanup, Isolation, And Legacy Removal

Once the new path is working end to end, isolate or remove legacy assumptions that would otherwise keep the old model alive.

Required output:

- scalar control settings path remains narrow and explicit
- workflow policy editing flows no longer rely on the scalar setup command contract
- no dead helpers or accidental deep-merge code remains

Implementation tasks:

1. Remove any workflow-settings-specific branching from the scalar setup field or value pipeline.
2. Delete or rewrite helpers that derive workflow changes from a single freeform string value.
3. Update exports so the new settings namespace is the canonical workflow settings entry point.
4. Rewrite tests that assume repository workflow defaults are captured at mission creation time.

## File Actions

This section is the practical map.

### New Files To Introduce

These files define the new settings ownership boundary.

#### Add `packages/core/src/settings/types.ts`

Purpose:

- define workflow settings metadata types
- define revision token type
- define validation error payloads
- define daemon request and response payloads for get, initialize, and update

#### Add `packages/core/src/settings/jsonPatch.ts`

Purpose:

- validate RFC 6902 operations
- enforce allowed operation kinds and allowed JSON pointer paths
- apply patch operations to a normalized `WorkflowGlobalSettings` value

#### Add `packages/core/src/settings/validation.ts`

Purpose:

- validate semantic invariants after patch application
- return deterministic field-path-based validation errors

#### Add `packages/core/src/settings/revision.ts`

Purpose:

- compute the file-state-derived revision token
- centralize comparison logic used by the store and daemon

#### Add `packages/core/src/settings/WorkflowSettingsStore.ts`

Purpose:

- own reading, initialization, normalization, patching, conflict checks, and atomic persistence for repository workflow settings

#### Add `packages/core/src/settings/index.ts`

Purpose:

- export the canonical settings API for daemon and clients

#### Add tests under `packages/core/src/settings/`

Recommended test files:

- `jsonPatch.test.ts`
- `validation.test.ts`
- `revision.test.ts`
- `WorkflowSettingsStore.test.ts`

### Refactor Heavily

These files must be substantially rewired.

#### Refactor `packages/core/src/lib/daemonConfig.ts`

Reason:

- currently owns raw read and write behavior for the entire settings file
- currently normalizes workflow defaults inline

Target action:

- preserve neutral file-path and default-shape helpers only
- move workflow settings mutation and revision logic into `WorkflowSettingsStore`
- keep scalar daemon settings support separate from workflow-policy mutation support

#### Refactor `packages/core/src/daemon/protocol.ts`

Reason:

- currently exposes only scalar `control.settings.update`

Target action:

- add `control.workflow.settings.get`
- add `control.workflow.settings.initialize`
- add `control.workflow.settings.update`
- add payload types for JSON Patch updates, revision tokens, metadata, and validation errors
- add `control.workflow.settings.updated` notification type

#### Refactor `packages/core/src/daemon/Workspace.ts`

Reason:

- currently updates repository settings through the scalar `writeControlSetting(field, rawValue)` path
- currently reads workflow settings directly from daemon config helpers
- currently builds setup UI around a single selected field and a single input value

Target action:

- route workflow settings methods through `WorkflowSettingsStore`
- keep scalar settings updates on the old narrow path only
- stop treating workflow policy as a scalar setup field
- split setup flow definitions so scalar settings and workflow settings are distinct command families
- emit workflow settings update notifications from daemon-owned code only

#### Refactor `packages/core/src/client/DaemonControlApi.ts`

Reason:

- the control facade must own both scalar setup requests and workflow-settings requests without collapsing them into one stringly helper

Target action:

- add typed workflow settings client methods
- keep scalar settings on `updateSetting(...)`
- do not overload scalar methods to carry JSON Patch as a disguised string payload

#### Refactor `packages/core/src/client/DaemonClient.ts`

Reason:

- currently includes surface path only for a small fixed list of control methods

Target action:

- include new workflow settings methods in the surface-path allow-list
- preserve request routing for control-scoped workflow settings updates

#### Refactor `packages/core/src/initializeMissionRepository.ts`

Reason:

- currently initializes repository control directories and writes default settings through the old helper only

Target action:

- route repository workflow settings initialization through the new store or store-backed helper
- ensure initialization produces a revision-bearing settings file

#### Refactor `packages/core/src/daemon/mission/Factory.ts`

Reason:

- currently falls back to hard-coded `createDefaultWorkflowSettings()` bindings
- currently disables autostart inline without consulting repository settings store

Target action:

- resolve workflow bindings from repository settings service
- preserve explicit runtime overrides only where they are intentional
- stop making factory-level defaults the silent source of repository workflow policy

#### Refactor `packages/core/src/workflow/engine/controller.ts`

Reason:

- currently snapshots workflow configuration during controller initialization
- currently emits `mission.created` and `mission.started` immediately after first document creation

Target action:

- move final snapshot capture to the `draft` to `ready` transition
- preserve document persistence, but stop hard-freezing configuration too early

#### Refactor `packages/core/src/workflow/engine/document.ts`

Reason:

- currently creates initial runtime state directly from an already-final configuration snapshot

Target action:

- support delayed capture or draft-time configuration linkage semantics
- keep snapshot creation explicit at the correct lifecycle boundary

#### Refactor `packages/core/src/daemon/mission/Mission.ts`

Reason:

- mission initialization currently calls controller initialization immediately
- status and refresh flows rely on the existing snapshot timing

Target action:

- preserve mission aggregate behavior while aligning initialization with the new draft-to-ready snapshot boundary
- ensure mission status reflects the correct repository-backed workflow settings prior to snapshot capture

#### Refactor `apps/tower/terminal/src/tower/mountTowerUi.tsx`

Reason:

- current setup flow is built around `control.setup.edit` with one selected field and one freeform value
- that flow cannot express RFC 6902 patch operations such as array reorder or deletion

Target action:

- split scalar setup editing from workflow settings editing
- add workflow-specific flows that emit structured patch requests
- remove any assumption that `/setup` maps all repository settings to one text box

#### Refactor `apps/tower/terminal/src/tower/components/ControlStatusPanel.tsx`

Reason:

- setup messaging currently treats repository configuration as a generic scalar setup task

Target action:

- update control-state messaging to reflect workflow settings readiness and conflict states where relevant

#### Refactor `apps/vscode-extension/src/MissionOperatorClient.ts`

Reason:

- currently exposes only control status, mission status, issue bootstrap, and command execution paths

Target action:

- add typed workflow settings API methods
- surface daemon conflict and validation results without local mutation logic

#### Refactor `apps/vscode-extension/src/MissionTowerViewModel.ts`

Reason:

- will need to hold workflow settings state and update lifecycle for the tower surface

Target action:

- add workflow settings model state, revision token handling, and update status tracking

#### Refactor `apps/vscode-extension/src/webview/TowerApp.svelte`

Reason:

- tower webview needs an operator-facing control mode surface for repository workflow settings

Target action:

- add workflow settings panel or route
- render daemon validation and conflict states
- refresh on workflow settings update events

### Delete Or Replace

These paths represent legacy assumptions that must be removed or narrowed.

#### Replace workflow-policy use of `control.settings.update` in `packages/core/src/daemon/protocol.ts`

Reason:

- it is a scalar field or value contract
- it cannot represent RFC 6902 JSON Patch semantics

Target action:

- retain for scalar daemon settings only
- remove it from all workflow settings use cases

#### Replace workflow-policy use of `updateSetting()` in `packages/core/src/client/DaemonControlApi.ts`

Reason:

- it is built around one field and one string value

Target action:

- do not reuse for workflow settings
- create dedicated workflow settings client methods instead

#### Replace workflow-policy use of `writeControlSetting()` and `asControlSettingField()` in `packages/core/src/daemon/Workspace.ts`

Reason:

- this is the current scalar mutation path
- it encourages treating workflow policy as a list of editable scalar leaves

Target action:

- keep only for scalar daemon settings
- move workflow settings mutation out entirely

#### Replace workflow-policy use of `buildSetupCommandFlow()` and `buildSetupCommandFlowOptions()` in `packages/core/src/daemon/Workspace.ts`

Reason:

- the current setup flow is not expressive enough for JSON Patch operations

Target action:

- split command definitions so workflow settings use their own flow or command family

#### Delete or isolate workflow settings assumptions in `apps/tower/terminal/src/tower/mountTowerUi.tsx`

Reason:

- current adaptive setup flow logic assumes a single selected setting and a single value edit

Target action:

- isolate this flow to scalar settings only
- remove workflow-policy editing from that path

#### Replace early snapshot capture in `packages/core/src/workflow/engine/controller.ts`

Reason:

- it freezes workflow configuration too early for `draft` missions

Target action:

- move snapshot capture to the explicit lifecycle transition boundary

#### Delete any new code that attempts deep-partial workflow merges

Reason:

- the spec forbids deep-partial workflow update semantics

Target action:

- reject or remove such code immediately during review

No such deep-partial workflow merge path should remain in final code.

## Testing Strategy

The tests are part of the implementation contract.

### Unit Tests

Add focused tests for the new settings namespace.

Required coverage:

1. RFC 6902 `replace`, `add`, and `remove` operations on allowed workflow paths.
2. Rejection of unsupported JSON Patch operations or forbidden paths.
3. Reordering `stageOrder` through full-array replacement.
4. Gate deletion through array removal.
5. Validation failure when `stageOrder` and `stages` disagree.
6. Validation failure for invalid concurrency numbers.
7. Deterministic revision token generation from unchanged file content.
8. Revision token change when file content changes out of band.

Recommended files:

- `packages/core/src/settings/jsonPatch.test.ts`
- `packages/core/src/settings/validation.test.ts`
- `packages/core/src/settings/revision.test.ts`

### Integration Tests

Add daemon and repository persistence tests.

Required coverage:

1. `initialize` creates `.missions/settings.json` with a complete workflow object and a valid revision token.
2. `get` returns effective workflow settings, revision, and initialization metadata.
3. `update` applies RFC 6902 JSON Patch and persists atomically.
4. `update` returns `SETTINGS_CONFLICT` when the settings file was modified out of band after the client fetched its revision.
5. `update` emits `control.workflow.settings.updated` on success.
6. Scalar `control.settings.update` still works for scalar daemon settings and does not accept workflow policy mutation.

Recommended files:

- `packages/core/src/settings/WorkflowSettingsStore.test.ts`
- `packages/core/src/daemon/Workspace.test.ts`
- `packages/core/src/initializeMissionRepository.test.ts`

### Mission Snapshot Tests

Add tests around the lifecycle boundary.

Required coverage:

1. Mission created in `draft` does not yet own an isolated final workflow snapshot.
2. Updating repository workflow settings while the mission is `draft` affects that mission's eventual ready-time snapshot.
3. The `draft` to `ready` transition captures the workflow configuration into `mission.json` exactly once.
4. Updating repository workflow settings after the mission is `ready` does not affect the mission snapshot.

Recommended files:

- `packages/core/src/workflow/engine/controller.test.ts`
- `packages/core/src/daemon/mission/Mission.test.ts`
- `packages/core/src/daemon/mission/Factory.test.ts`

### Surface Contract Tests

Add tests that prove surfaces are only daemon clients.

Required coverage:

1. CLI setup or control flow emits daemon workflow settings requests and never writes `.missions/settings.json` directly.
2. CLI renders daemon validation errors and `SETTINGS_CONFLICT` without local merge fallback.
3. Extension or tower client refreshes workflow settings state on `control.workflow.settings.updated`.
4. Tower or web UI never derives its own patch semantics differently from the daemon contract.

Recommended files:

- CLI tower tests adjacent to `apps/tower/terminal/src/tower/mountTowerUi.tsx`
- extension tests adjacent to `apps/vscode-extension/src/MissionOperatorClient.ts`
- webview tests adjacent to `apps/vscode-extension/src/webview/TowerApp.svelte`

## Delivery Gate

The implementation is not complete until all of the following are true.

1. Repository workflow settings update requests use RFC 6902 JSON Patch end to end.
2. The daemon rejects stale revisions caused by out-of-band file edits.
3. Mission workflow snapshotting occurs at `draft` to `ready`, not earlier.
4. CLI workflow settings edits use the new daemon API only.
5. Tower or web workflow settings edits use the same daemon API only.
6. Scalar setup code is isolated from workflow policy editing.
7. No direct workflow-settings file writes remain in any surface.
