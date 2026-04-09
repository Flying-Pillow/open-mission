---
layout: default
title: Tower Layout And Routing
nav_exclude: true
---

# Tower Layout And Routing

This document defines the terminal Tower shell layout and routing contract.

It replaces the older app-local implementation note that lived under the terminal package.

This is development-stage material.

It belongs in the airport-spec mission dossier until the Tower shell contract is stable enough to promote into the root product documentation.

It describes the stable shell structure that the Tower must present once launched.

It does not define workflow semantics, command availability, or daemon authority rules beyond what is needed to explain shell routing.

For the broader control-surface command contract, see [Workflow Control Surface](controller/workflow-control-surface.md).

## Scope

This document defines:

- launch entry behavior that determines the initial Tower context
- the shell regions that remain stable while the Tower is running
- the top-level routing model for repository and mission work
- focus order expectations for the terminal Tower surface
- invariants that keep repository flows and mission-control content separate

This document does not define:

- the outer zellij workspace layout around the Tower
- operator command semantics
- mission workflow semantics
- daemon-side gate bindings or airport control-plane policy

## Launch Boundary

The terminal Tower can be launched from either the repository checkout or a mission worktree.

- Launching from the repository checkout opens repository mode.
- Launching from a mission worktree auto-selects that mission and opens mission mode.

The terminal Tower may run inside a larger zellij layout, but that outer layout is not the same thing as the Tower shell.

This document only describes the Tower surface itself.

## Design Goals

1. Keep the shell layout fixed and easy to reason about.
2. Restrict top-level Tower routing to repository work or one active mission.
3. Separate shell context selection from center-panel content routing.
4. Keep repository setup and intake flows in a dedicated center panel.
5. Keep the command panel visible across both repository and mission work.
6. Keep mission mode deterministic and centered on the flight deck.

## Shell Layout

The Tower shell uses one persistent vertical stack:

1. header
2. center panel
3. command panel
4. key hints row

### Header

The header is always visible.

It shows connection and repository state and exposes the top-level tab strip for mission tabs and the repository tab.

When a mission context is active, the header also shows mission identity details.

### Center Panel

The center panel owns the primary routed content.

Exactly one center route is active at a time.

The active route is determined from the current top-level Tower mode.

### Command Panel

The command panel is always visible.

It remains the stable execution surface for slash commands, command entry, and mission actions that are not being collected through a center-panel flow.

Repository flows must not replace or hide the command panel.

### Key Hints Row

The key hints row is always visible.

It is a single-line shell hint region that reflects the current focus area and interaction mode.

## Top-Level Context Model

The Tower selects between exactly two shell contexts:

```ts
type TowerContext =
  | { kind: 'repository' }
  | { kind: 'mission'; missionId: string }
```

The repository context represents repository-wide work from the control checkout.

The mission context represents one selected mission worktree.

Legacy `control` naming is obsolete here.

`repository` is the correct top-level term for the non-mission Tower surface.

## Top-Level Mode Model

The shell mode derived from context is:

```ts
type TowerMode = 'repository' | 'mission'
```

There are no additional top-level Tower modes.

In particular, the Tower does not expose a separate daemon-log mode and does not treat overlays as alternate shell modes.

## Header Tabs

The header tab strip represents selectable mission contexts plus one global repository tab:

- mission tabs
- `REPOSITORY`

Ordering rules:

1. mission tabs in mission ordering
2. `REPOSITORY`

Selection rules:

- selecting a mission tab activates mission mode for that mission
- selecting `REPOSITORY` activates repository mode
- selecting `REPOSITORY` clears the active mission context for the shell surface

## Center Routes

The center route model is:

```ts
type CenterRoute =
  | { kind: 'repository-flow' }
  | { kind: 'mission-control' }
```

### Repository Mode

Repository mode routes the center panel to the repository flow surface.

This is the repository-facing setup and intake surface for the Tower.

The center panel must remain in repository flow mode whenever the shell is in repository mode.

The repository flow surface may change step type internally, but the shell must keep one stable center region while the flow advances.

Supported step classes are:

1. single selection
2. multi selection
3. text input

Repository text entry for an active flow belongs in the center flow surface, not in the command panel.

### Mission Mode

Mission mode routes the center panel to the mission flight deck.

The center region is owned entirely by the mission-control tree while mission mode is active.

Mission selection must never fall back to repository flow content.

Repository setup or intake flows must stop owning the center panel as soon as the shell switches to mission mode.

## Overlay Model

The Tower may render overlays on top of the shell without redefining the shell layout.

```ts
type ShellOverlay =
  | { kind: 'none' }
  | { kind: 'command-select' }
  | { kind: 'mission-flow' }
```

Overlays are layered behavior.

They are not top-level shell routes.

## Focus Model

Repository mode focus order:

1. header
2. flow
3. command

Mission mode focus order:

1. header
2. tree
3. command

The current focus-area vocabulary is:

```ts
type FocusArea = 'header' | 'tree' | 'flow' | 'command'
```

The Tower no longer models an internal console focus area in the shell.

Operator output and attached session views belong to the surrounding runtime environment rather than to an internal Tower console pane.

## Routing Invariants

The following rules must remain true:

1. The command panel stays visible in both repository and mission mode.
2. Repository flow content only appears while the shell is in repository mode.
3. Mission-control content only appears while the shell is in mission mode.
4. Switching header tabs changes shell context first and center-panel content second.
5. Overlay activation never creates a new top-level Tower mode.
6. Repository flow input does not displace the command panel.

## Acceptance Criteria

### Repository Mode

- selecting `REPOSITORY` always shows the repository flow surface in the center panel
- the command panel remains visible
- flow steps support single-select, multi-select, and text-entry states
- repository flow text steps are edited in the center flow surface

### Mission Mode

- selecting a mission tab always shows the mission flight deck in the center panel
- repository flow content does not remain mounted as the visible center route
- the command panel remains visible
- focus order remains header, tree, command

## Relationship To Other Tower Material

This document defines shell layout and routing only.

It stays in the airport-spec dossier until the Tower shell contract is ready for promotion into the root Tower docs.