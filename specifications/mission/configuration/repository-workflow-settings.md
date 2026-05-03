---
layout: default
title: Repository Workflow Settings
parent: Configuration
nav_order: 1
---

# Repository Workflow Settings

This document defines the missing repository-level workflow settings functionality.

It establishes one authoritative settings boundary in core, with daemon-owned initialization and mutation, and surface-specific interaction contracts for CLI, Tower, and future clients.

## Problem

The file may first be created inside a Repository setup branch created from the Airport setup screen.

The original local checkout does not need to contain `.mission/settings.json` immediately after clone, but regular missions cannot begin until Repository setup has made the settings document available to the usable checkout.

Current control settings support is focused on scalar daemon preferences such as runner, mode, model, and paths.

Repository workflow settings exist in core types and defaults, but there is no complete repository-level surface contract for:

- initializing workflow settings for a repository in a consistent way
- updating workflow settings through daemon-owned validation and persistence
- exposing settings to multiple control surfaces with the same behavior
- ensuring UI and CLI flows cannot bypass daemon policy

This creates drift risk between surfaces and weakens clean architectural boundaries.

## Goals

1. Define one repository-level workflow settings contract in core.
2. Keep daemon as the only authority for initialize and update operations.
3. Allow multiple surfaces to consume the same contract without duplicating policy logic.
4. Make control mode the explicit place where CLI and Tower can edit settings.
5. Preserve deterministic behavior by validating, normalizing, and versioning updates in daemon.

## Non-Goals

- Defining mission runtime reducer internals.
- Allowing mission-level runtime setting edits for already started missions.
- Allowing surfaces to write `.mission/settings.json` directly.
- Defining provider-specific UI design.

## Terminology

- Repository workflow settings: The repository defaults used to seed mission workflow snapshots.
- Control mode: Operational mode where setup and repository policy operations are available.
- Surface: A client entry point such as CLI, Tower webview, extension view, MCP membrane, or future API client.

## Source Of Truth

Repository settings are persisted at:

- `.mission/settings.json`

The workflow policy section under this file is the only repository-level source of truth for workflow defaults.

## Settings Model

The repository-level workflow settings payload is `WorkflowGlobalSettings`.

The daemon settings model remains `MissionDaemonSettings` and includes:

- non-workflow daemon settings (runner, mode, model, paths, theme, tracking)
- `workflow: WorkflowGlobalSettings`

Repository and task-level workflow settings may also carry opaque agent metadata used by a selected runner.

That metadata is configuration for the adapter, not a new source of Mission semantics.

Required behavior:

1. Repository initialization must always produce a complete `workflow` object.
2. Partial update requests must be merged against the current effective settings.
3. Missing fields must be filled from `createDefaultWorkflowSettings()` through normalization.
4. Invalid values must be rejected before persistence.
5. Opaque runner metadata may be persisted and snapshotted, but the daemon must treat unknown metadata keys as adapter-owned unless a key is promoted into a cross-runner Mission concept by specification.

## Ownership And Responsibility Boundaries

### Daemon Responsibilities (Authoritative)

The daemon is solely responsible for:

- loading effective repository settings
- initializing repository settings if absent
- validating and normalizing workflow update requests
- applying and persisting updates atomically
- emitting updated control status after mutation
- exposing protocol methods used by all surfaces

The daemon must not delegate policy validation to UI clients.

### Surface Responsibilities (Non-Authoritative)

CLI, Tower, and future surfaces are responsible for:

- presenting daemon-reported settings and validation errors
- collecting operator input
- sending structured requests to daemon
- refreshing state from daemon responses

Surfaces must not:

- write settings files directly
- apply local merge logic that can differ from daemon behavior
- silently coerce invalid values before daemon acknowledgement

## Control Mode Contract

Workflow settings edits are available only in control mode.

Behavior rules:

1. If control plane status indicates setup or root mode, surfaces may present workflow settings operations.
2. When a mission-focused mode is active, surfaces may still route settings operations through control endpoints, but command affordances should remain grouped under setup or control actions, not mission task actions.
3. Control mode actions are command-driven in both CLI and Tower.

CLI and Tower must use the same daemon command and method contract.

## Daemon API Additions

Define new daemon protocol methods:

- `control.workflow.settings.get`
- `control.workflow.settings.initialize`
- `control.workflow.settings.update`

### `control.workflow.settings.get`

Returns:

- effective workflow settings
- metadata (`workflowVersion`, `sourcePath`, `lastUpdatedAt`, `initialized`)
- optional warnings

### `control.workflow.settings.initialize`

Purpose:

- initialize workflow settings when missing
- optionally force reinitialize only with explicit confirmation flag

Returns:

- effective workflow settings metadata
- control status snapshot

### `control.workflow.settings.update`

Accepts:

- RFC 6902 JSON Patch operations
- expected revision token for optimistic concurrency
- update context (`requestedBySurface`, `requestedBy`, optional reason)

Returns:

- updated effective workflow settings
- new revision token
- control status snapshot

Failure shape includes:

- validation errors with stable codes and field paths
- conflict error when revision token is stale

Patch format is normative.

Updates must use RFC 6902 JSON Patch.

Example operations:

- replace `stageOrder` with a reordered array
- remove a gate from `/gates/1`
- replace `/stages/implementation/taskLaunchPolicy/defaultAutostart`

The daemon must not accept ambiguous deep-partial object merges for workflow settings updates.

This rule exists because workflow settings contain arrays and dictionaries where deletion and reorder semantics must be explicit and deterministic across surfaces.

## Update Semantics

Updates follow read-validate-write rules:

1. Resolve current effective settings.
2. Validate RFC 6902 patch shape and path allow-list.
3. Apply patch to a normalized copy.
4. Run semantic validation (cross-field and invariant checks).
5. Persist atomically.
6. Emit mission control status update event.
7. Return updated settings and revision.

No direct mutation is allowed outside this path.

## Validation Rules

Minimum required validations:

- `execution.maxParallelTasks` and `execution.maxParallelSessions` are integers >= 1
- `stageOrder` is non-empty, unique, and consistent with `stages`
- each `stages[stageId]` has matching `stageId`
- each gate references a valid stage when `stageId` is present
- task generation rules reference known stages
- task launch policy booleans are valid

Validation rule for opaque metadata:

- the daemon may validate that metadata is a JSON object containing scalar JSON values only
- the daemon must not reject unknown metadata keys merely because one runner currently ignores them

Validation failures must be deterministic and surface-safe.

## Concurrency And Integrity

To prevent lost updates across surfaces:

- daemon tracks a settings revision token derived from persisted file state
- `update` requires `expectedRevision`
- mismatch returns `SETTINGS_CONFLICT`

Revision token requirements:

- the token must be derived from the current `.mission/settings.json` file contents or an equally strict file-state fingerprint
- an in-memory monotonic counter alone is not sufficient
- daemon must recompute or revalidate the token against disk state before applying an update

This is required so out-of-band edits made directly in an editor do not get silently overwritten by a surface that is holding stale daemon state.

If the settings file was modified outside daemon control:

1. the next update attempt must detect the file-state mismatch
2. the daemon must return `SETTINGS_CONFLICT`
3. the surface must fetch the latest settings before retrying

Persistence requirement:

- write to temp file and rename for atomic replace

## Events And Observability

Daemon should publish a control-plane event after successful settings updates:

- event type: `control.workflow.settings.updated`
- includes revision, actor metadata, and changed paths

This allows Tower and other live surfaces to refresh without polling.

## Surface Integration Requirements

### CLI

- Control command group includes workflow settings get, initialize, and update.
- In control mode, setup flow can render editable workflow fields or grouped policy sections.
- CLI submits structured updates, not raw file writes.

### Tower

- Control mode shows repository workflow settings panel.
- Edit actions call daemon update endpoint and render daemon errors inline.
- On settings update event, Tower refreshes displayed revision and values.

### Future Surfaces

- Must use same daemon protocol methods.
- Must not add direct filesystem mutation backdoors.
- May provide custom UX, but behavior remains daemon-defined.

## Mission Snapshot Interaction

Repository workflow settings affect new mission starts and initialization snapshots.

Rules:

1. A mission in `draft` does not yet own an isolated workflow configuration snapshot.
2. Repository workflow settings are snapshotted into `mission.json` at the exact transition from `draft` to `ready`.
3. Repository setting updates made while a mission is still `draft` do apply to that mission when it transitions to `ready`.
4. Once a mission is `ready`, `running`, `paused`, `panicked`, `completed`, or `delivered`, its workflow snapshot is mission-local and isolated from later repository setting changes.
5. Later repository updates do not retroactively mutate existing mission snapshots unless an explicit future migration command is defined.

## Security And Policy

- Only trusted local daemon clients can call control methods.
- Surface identity in requests is informational; authorization is daemon-side.
- Paths or values that attempt traversal or malformed objects are rejected.

## Compatibility And Migration

1. Preserve existing scalar control settings methods during transition.
2. Add dedicated workflow settings methods.
3. Update existing setup command flow to include workflow policy sections routed through new methods.
4. Keep old `control.settings.update` for scalar daemon settings only.

## Testing Requirements

Add coverage at three levels.

### Unit

- patch application and normalization
- workflow semantic validation
- revision conflict handling

### Integration (Daemon + Workspace)

- initialize when settings file is missing
- update with valid patch persists and returns new revision
- stale revision update fails with conflict
- event emission after successful update

### Surface Contract

- CLI control mode calls daemon methods and reflects validation errors
- Tower control mode updates through daemon and refreshes on event
- no surface writes settings file directly

## Acceptance Criteria

1. A repository can initialize workflow settings through daemon-owned Repository setup even when `.mission/settings.json` is missing.
2. CLI and Tower can both read and update repository workflow settings in control mode.
3. All updates are daemon-validated and atomically persisted.
4. Concurrent updates are protected by revision checks.
5. Existing mission snapshots remain unchanged after repository setting edits.
6. No UI surface contains independent workflow settings policy logic.
