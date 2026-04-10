# The Human In The Loop

> As the operator, I want the AI to remain subordinate to explicit workflow policy and human approval, so automation never outruns governance.

Mission treats the human as the runtime authority, not as a passive observer. The codebase expresses that authority through mission lifecycle events, pause state, panic state, task launch policy, and daemon-surfaced actions. The workflow engine may generate requests and signals, but operator control remains explicit and reviewable.

## Governance Model

The runtime state distinguishes mission lifecycle from task execution:

- missions move through `draft`, `ready`, `running`, `paused`, `panicked`, `completed`, and `delivered`
- tasks move through `pending`, `ready`, `queued`, `running`, `blocked`, `completed`, `failed`, and `cancelled`
- sessions move through `starting`, `running`, `completed`, `failed`, `cancelled`, and `terminated`

That distinction matters because stages do not execute work. Tasks execute work. The operator therefore governs the mission by controlling lifecycle and by deciding which tasks may proceed.

## Pause, Checkpoints, And Manual Control

The runtime model supports several pause reasons:

| Pause reason | Meaning in code |
| --- | --- |
| `human-requested` | Operator explicitly paused the mission |
| `panic` | Emergency stop is active |
| `checkpoint` | Workflow started in a checkpointed pause state |
| `agent-failure` | Reserved pause reason for failure handling |
| `system` | Reserved system pause reason |

When the reducer receives `mission.started`, it either moves the mission to `running` or pauses immediately with reason `checkpoint` if `humanInLoop.pauseOnMissionStart` is enabled in the workflow snapshot. In the default workflow, `pauseOnMissionStart` is `false`, so a newly started mission is not checkpoint-paused by default.

The default workflow snapshot does, however, encode a manual policy for some stages:

| Stage | Default autostart | Launch mode |
| --- | --- | --- |
| PRD | `true` | `automatic` |
| SPEC | `true` | `automatic` |
| Implementation | `false` | `manual` |
| Audit | `true` | `automatic` |
| Delivery | `false` | `manual` |

One implementation detail matters here: the reducer carries launch policy in task runtime state, but the current `queueAutostartTasks` function is still a no-op. So while the configuration snapshot and task records model autostart versus manual launch explicitly, operator-driven task actions remain the reliable control path today.

## What The Agent Is Actually Allowed To See

Mission launches work with a bounded task prompt. The launch prompt explicitly tells the agent:

- which task it is working on
- the exact mission workspace boundary it must stay inside
- the authoritative task file path
- the task summary extracted from that file

That is a concrete safety boundary, not a documentation promise. The task launch prompt instructs the agent to stay strictly inside the mission workspace and to treat the task file as authoritative. The mission workspace path and task file path are injected directly into the prompt text.

## How Humans Start, Pause, And Resume Work

At the daemon surface, the implemented mission actions include:

- pause mission
- resume mission
- panic stop mission
- clear panic
- deliver mission

The task-level action surface then handles actual work selection and status changes. This is consistent with Mission's architectural rule that task execution is authoritative and stage control is presentation shorthand at most.

In practice, that means the human decides:

1. when a mission enters running state
2. when it is paused
3. when panic is invoked
4. which ready task is started or relaunched
5. whether future tasks should remain manual or be allowed to autostart under policy

## Manual Launch Policy And Autostart Policy

Mission snapshots workflow policy into the mission runtime record. That means launch policy is a property of the mission's persisted configuration snapshot, not a transient UI preference. The operator can reason about policy by reading mission state, not by reconstructing what the UI happened to do earlier.

The practical interpretation for senior operators is:

- policy is durable and mission-local
- task execution remains bounded to task files and mission workspaces
- stage vocabulary is descriptive, not executable
- the human remains the governing authority over start, pause, resume, and emergency stop behavior

This is the correct boundary for AI governance. The system can automate request execution, but it does not demote the human below the workflow policy.