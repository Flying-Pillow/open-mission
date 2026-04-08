# CLI Cockpit Layout And Routing Spec

## Status

Current implementation reference.

This document defines the routing and layout model for the Mission CLI cockpit after removing the separate daemon-log mode.

## Design Goals

1. Keep the shell layout fixed and easy to reason about.
2. Restrict top-level cockpit modes to `mission` and `repository`.
3. Separate context selection from center-panel routing.
4. Keep repository interaction in a dedicated center flow panel.
5. Keep the command dock as a stable shell region.
6. Keep mission layout deterministic and focused on the flight deck.

## Shell Layout

The cockpit shell always uses this vertical structure:

1. Header
2. Center
3. Command panel
4. Key hints row

### Header

- always visible
- shows daemon connection state and GitHub login state
- shows mission-specific details when a mission context is active

### Center

- `flex: 1`
- exactly one active layout at a time
- selected strictly from the top-level cockpit mode

### Command Panel

- always visible
- remains the operational command surface for both repository and mission work

### Key Hints Row

- always visible
- one line only
- plain text only

## Top-Level Modes

There are exactly two cockpit modes:

1. `mission`
2. `repository`

`control` is legacy naming and should map to `repository` in layout and routing state.

## Header Tabs

The header tab strip represents:

- selectable mission contexts
- one global repository tab: `REPOSITORY`

### Ordering

1. mission tabs in existing mission ordering
2. `REPOSITORY`

### Selection Semantics

- selecting a mission tab activates `mission` mode for that mission context
- selecting `REPOSITORY` activates repository mode and clears mission context for the shell surface

## Mode Layouts

## Mission Mode

Mission mode uses one center panel: the mission flight deck.

The mission console panel is no longer rendered in the center region.

### Flight Deck Rules

- the center region is owned entirely by the flight deck tree
- selecting a mission tab must never fall back to repository flow content
- repository setup flows must not continue rendering after the shell switches to mission mode

### Command Panel

- always visible
- reacts to the selected mission target
- remains the primary command surface for mission actions

## Repository Mode

Repository mode uses one center panel: `RepositoryFlowPanel`.

This is the primary repository interaction surface, not a temporary picker.

### Repository Flow Panel

The flow panel always renders these regions in order:

1. title row
2. helper text
3. committed-step summary strip
4. active-step body
5. status badges

The panel must stay mounted while step types change. Only the active-step body changes.

### Supported Step Types

1. single selection
2. multi selection
3. text input

### Navigation

- `Up` / `Down` move highlighted options for selection steps
- `Space` toggles multi-select options
- `Enter` commits the active step when valid
- `Ctrl+Right` advances when the step is valid
- `Ctrl+Left` retreats to the previous step
- `Tab` cycles shell focus

### Command Panel Relationship

- the flow panel owns repository flow progression and step input
- the command dock remains available for slash commands and command execution
- repository flows must not hide the command dock

## Routing Model

### Context Layer

```ts
type CockpitContext =
  | { kind: 'repository' }
  | { kind: 'mission'; missionId: string }
```

### Mode Layer

```ts
type CockpitMode = 'repository' | 'mission'
```

### Center Route Layer

```ts
type CenterRoute =
  | { kind: 'repository-flow' }
  | { kind: 'mission-flight-deck' }
```

### Overlay Layer

```ts
type ShellOverlay =
  | { kind: 'none' }
  | { kind: 'command-select' }
  | { kind: 'mission-flow' }
```

Overlays do not redefine the shell layout. They layer on top of it.

## Focus Model

### Mission Mode Focus Order

1. header
2. tree
3. command

### Repository Mode Focus Order

1. header
2. flow
3. command

Suggested focus enum:

```ts
type FocusArea = 'header' | 'tree' | 'console' | 'flow' | 'command'

Updated CLI implementation:

type FocusArea = 'header' | 'tree' | 'flow' | 'command'
```

The external terminal right pane owns artifact and session output. The CLI cockpit no longer mounts or focuses an internal console surface.

## Panel Ownership

### Mission

- center owner: mission flight deck panel
- command owner: command dock

### Repository

- center owner: repository flow panel
- command owner: command dock

## Acceptance Criteria

### Mission Mode

- selecting a mission tab always shows the mission split layout
- selecting a mission tab never shows repository setup flow content in the center region
- the center panel shows only the mission flight deck
- command panel remains visible

### Repository Mode

- selecting `REPOSITORY` always shows the flow panel in center
- command panel remains visible
- repository flows support single-select, multi-select, and text steps
- text steps are edited in the center flow panel, not the command dock
- repository mode shows a valid idle flow panel when no flow is active

## Non-Goals

- redesigning mission header content
- redesigning future right-panel markdown behavior
- redesigning command dock confirmation behavior
- adding a separate daemon-log cockpit mode
