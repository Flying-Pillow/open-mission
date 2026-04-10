# Workflow Control

Mission's workflow control surface is task-centric even when the UI speaks in stage language.

That distinction is architectural, not stylistic. The workflow engine persists task state and mission lifecycle state. Stage status is a projection. So an operator may think "start implementation," but the daemon must translate that intent into mission, task, generation, session, or gate actions that are actually valid in runtime.

## The Control Boundary

The daemon-owned mission object currently exposes action handling for these executable families:

| Action family | Examples in the current code |
| --- | --- |
| Mission actions | pause, resume, panic stop, clear panic, deliver |
| Generation actions | generate tasks for the eligible stage |
| Task actions | start, launch, mark done, mark blocked, reopen, enable or disable autostart, set launch mode |
| Session actions | cancel session, terminate session |

Selection and gate-focused behavior are then projected around those action families rather than replacing them.

## Mission Actions

Mission actions operate on lifecycle and governance state:

- pause mission
- resume mission
- panic stop mission
- clear panic
- deliver mission

These actions map directly to workflow events such as `mission.paused`, `mission.resumed`, `mission.panic.requested`, `mission.panic.cleared`, and `mission.delivered`.

This is the correct abstraction layer for human control. Operators control the mission as a governed runtime, not as a collection of ad hoc shell commands.

## Task Actions

Tasks are the units that execute work. The current daemon mission surface supports:

- start a task
- launch a task session
- mark a task done
- mark a task blocked
- reopen a task
- enable or disable task autostart
- switch task launch mode between `automatic` and `manual`

Those controls operate on runtime task state and on task runtime policy. They do not mutate stage runtime state because stages do not own execution.

## Session Actions

Sessions are runtime attachments to tasks. The current action surface includes:

- cancel a session
- terminate a session

Session prompting and command submission also exist in the runtime and mission layers, even when they are not the primary top-level toolbar action. This matters because a task and a session are not interchangeable:

- the task is the workflow unit
- the session is the live runtime attached to that task

## Generation Actions

Mission can request task generation for the currently eligible stage. The daemon enforces that generation is only allowed for that eligible stage and rejects generation if runtime tasks already exist for it.

This is how stage-oriented operator language is made safe. When a human says "start the next stage," the implemented action is not a stage mutation. It is usually one of these:

1. generate the tasks for the eligible stage
2. start a ready task in that stage
3. change launch policy for tasks in that stage
4. resume a paused mission so ready work can proceed

## Selection And Gate-Focused Interaction

The operator surface also projects selection state:

- repository selection
- mission selection
- stage focus
- task focus
- session focus

That selection state matters because action availability and target context are derived from it. In the Tower, selected mission, stage, task, and session state shape which command descriptors are relevant.

Mission also exposes workflow gates as projections. Gates such as `implement`, `verify`, `audit`, and `deliver` are derived from workflow state and evaluated by the daemon. They are not terminal layout slots and they are not stage commands.

This is the distinction to keep straight:

- workflow gates are readiness projections
- airport gates are layout slots such as `dashboard`, `editor`, and `agentSession`

## Stage Language Is Translation, Not Authority

Principal Architects will naturally speak in stage-oriented language. Mission supports that language at the surface layer, but the daemon translates it into valid runtime intents.

So when an operator says:

- "start this stage"
- "stop this stage"
- "go back to this stage"

the daemon should interpret that as combinations of:

- mission lifecycle changes
- task generation
- task start or reopen actions
- launch policy changes
- session cancellation or termination

The stage itself remains structural and derived.

That is one of Mission's core safety properties: stage vocabulary can help the human think, but it is not allowed to become an ambiguous runtime authority.