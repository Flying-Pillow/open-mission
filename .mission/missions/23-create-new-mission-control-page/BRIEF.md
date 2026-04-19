---
issueId: 23
title: "Create new Mission Control page"
type: "feature"
branchRef: "mission/23-create-new-mission-control-page"
createdAt: "2026-04-19T14:14:29.839Z"
updatedAt: "2026-04-19T14:14:29.839Z"
url: "https://api.github.com/repos/Flying-Pillow/mission/issues/23"
---

Issue: #23

Create a dedicated Mission Control page for the Mission web app that reproduces the functional model of the deprecated Tower mission surface in the old airport-terminal app, but in the current Svelte web UI.

## Intent

Build the primary operator console for a single mission. This page must let the user steer the entire mission workflow from one place, with the same core behavior as the deprecated Tower mission mode:
- a top mission progress and control surface
- task and workflow steering actions
- artifact selection
- agent session selection
- a lower split view where the selected artifact is editable on the left and the active or selected agent session is shown in an xterm panel on the right

This is not a generic dashboard. It is the web replacement for Tower mission mode.

### Reference behavior to preserve

The deprecated Tower mission experience lives in:
- [mission/deprecated/apps/airport-terminal/src/AirportApp.tsx](mission/deprecated/apps/airport-terminal/src/AirportApp.tsx)
- [mission/deprecated/apps/airport-terminal/src/tower/components/mission-control/MissionControlPanel.tsx](mission/deprecated/apps/airport-terminal/src/tower/components/mission-control/MissionControlPanel.tsx)
- [mission/deprecated/apps/airport-terminal/src/tower/components/mission-control/missionControlController.ts](mission/deprecated/apps/airport-terminal/src/tower/components/mission-control/missionControlController.ts)
- [mission/deprecated/apps/airport-terminal/src/tower/components/mission-control/panelBindings.ts](mission/deprecated/apps/airport-terminal/src/tower/components/mission-control/panelBindings.ts)

Selection semantics are already defined centrally and should be reused, not reinvented:
- [mission/packages/core/src/lib/resolveMissionSelection.ts](mission/packages/core/src/lib/resolveMissionSelection.ts)
- [mission/specifications/mission/model/selection-resolution.md](mission/specifications/mission/model/selection-resolution.md)

### Current web app context

The current repository page is here:
- [mission/apps/airport/web/src/routes/repository/[repositoryId]/+page.svelte](mission/apps/airport/web/src/routes/repository/[repositoryId]/+page.svelte)

Mission runtime snapshot loading already exists here:
- [mission/apps/airport/web/src/routes/api/runtime/missions/[missionId]/+server.ts](mission/apps/airport/web/src/routes/api/runtime/missions/[missionId]/+server.ts)

The client mission entity already exposes workflow, stages, tasks, sessions, and mission actions:
- [mission/apps/airport/web/src/lib/client/entities/Mission.ts](mission/apps/airport/web/src/lib/client/entities/Mission.ts)

There is already a lightweight mission summary/control component here:
- [mission/apps/airport/web/src/lib/components/entities/Mission/SelectedMission.svelte](mission/apps/airport/web/src/lib/components/entities/Mission/SelectedMission.svelte)

## Scope

Implement a new mission-specific Mission Control page. Prefer a route shape like:
- /repository/[repositoryId]/missions/[missionId]

If another route shape is more consistent with the current app, use it, but keep the behavior mission-centric.

The page must have 2 major vertical regions.

Top region: mission progress and control surface

This top region is the steering surface for the workflow. It must include:
- mission identity and repository context
- workflow lifecycle and updated timestamp
- overall progress and current stage visibility
- stage-by-stage mission structure
- task rows under stages
- artifact rows and agent session rows where applicable
- mission-level controls: pause, resume, panic, clear panic, restart queue, deliver
- contextual task actions where available: start, complete, block, reopen
- contextual session actions where available: complete, cancel, terminate
- clear selection state so the operator knows what stage, task, artifact, or session is currently selected

The top region should behave like Tower mission mode, where the mission-control selection is the operator cursor.

Bottom region: 2-pane workspace

Below the control surface, render two panels side by side.

Left panel:
- editor for the selected artifact
- this should show the resolved artifact, not just the raw clicked row
- for task selection, show the canonical instruction artifact
- for stage selection, show the canonical stage result artifact
- for explicit artifact row selection, show that artifact
- if no artifact resolves, show an appropriate mission-level or empty state

Right panel:
- xterm panel for the active or selected agent session
- if a session row is explicitly selected, that session wins
- if a task is selected, show the preferred session for that task when one exists
- if no active session resolves, show an empty or inactive session state
- this panel should be designed as the operator’s live runtime console

Selection resolution requirements

Do not implement pane selection with local ad hoc UI heuristics.

Use the same resolved-selection model as the deprecated Tower behavior:
- selecting a task resolves the task’s canonical instruction artifact and preferred agent session
- selecting a task artifact resolves the same task selection bundle, with that artifact as the active instruction
- selecting a stage resolves the canonical stage result artifact
- selecting a stage artifact resolves that artifact as the active stage result
- selecting a session row keeps the owning task’s instruction artifact active while pinning the chosen session in the terminal panel

The web Mission Control page should centralize this selection logic or reuse shared logic from core so artifact/session resolution is deterministic and consistent.

Design and UX requirements

This page is an operator console.
Optimize for clarity, density, and safe control.
Do not build a marketing-style dashboard.

The layout should make it obvious:
- where the mission is in the workflow
- what is actionable right now
- which task is active, ready, blocked, or completed
- which artifact is being edited
- which agent session is currently attached to the terminal
- what the current selection is driving in the lower panes

Use the current Airport web visual language:
- AirportHeader
- AirportSidebar
- SidebarProvider
- SidebarInset
- existing card, border, muted, and rounded styles

Do not introduce a new design system.
Refactor existing mission components into reusable web Mission Control components if that improves cohesion.

Implementation constraints

- Use SvelteKit and existing project conventions.
- Reuse the current mission runtime entity and transport instead of rebuilding state management.
- Support live mission updates if the existing runtime observation path can be used.
- Keep changes focused and minimal.
- Do not regress the current repository page.
- Prefer extracting reusable mission-control subcomponents instead of creating one huge route component.
- If xterm is not already wired in this surface, add the smallest focused integration needed for the right-hand session console panel.
- Keep artifact editing and session viewing clearly separated by responsibility.

## Expected outcome

When finished, the app should have a working Mission Control page where the user can:
- open a single mission
- see mission progress and workflow control at the top
- select stages, tasks, artifacts, and agent sessions from the mission-control surface
- steer the workflow using mission and task actions
- edit the resolved selected artifact in the lower-left panel
- inspect or interact with the resolved active or selected agent session in the lower-right xterm panel
- remain on this page as the mission progresses, with refreshed or live-updating state

Implementation request

Before coding, briefly summarize:
- which route you will add
- which existing files/components you will reuse
- which new focused components you expect to add

Then implement the page end to end, including:
- route and load logic
- mission-control top surface
- resolved artifact editor panel
- resolved agent-session xterm panel
- selection wiring between the top surface and lower panels
- loading, empty, and error states
- small targeted tests only if there is an obvious nearby pattern
