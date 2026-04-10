# Agent Sessions

An agent session in Mission is the live runtime attached to a workflow task.

That runtime is deliberately separated from workflow state. A task belongs to the workflow engine and is persisted in the mission runtime record. A session belongs to the agent runtime layer and represents the active provider connection doing work for that task.

## Session Versus Task

The distinction is simple but important:

| Concept | Role |
| --- | --- |
| Workflow task | The bounded unit of planned work with dependencies, lifecycle, and launch policy |
| Agent session | The live provider-backed execution context attached to a task |

This separation lets Mission keep workflow semantics stable even if the underlying agent provider changes.

## Provider-Neutral Runtime Contract

Mission's runtime layer standardizes sessions through a small contract:

- start a session
- attach to an existing session
- inspect a session snapshot
- submit a prompt
- submit a structured command
- cancel a session
- terminate a session

The session snapshot carries the runtime id, transport identity, session id, mission id, task id, current phase, prompt capability, accepted commands, and update timestamp. That gives the rest of the system a provider-neutral way to reason about a running agent.

## Session Phases

The common runtime model tracks these phases:

- `starting`
- `running`
- `awaiting-input`
- `completed`
- `failed`
- `cancelled`
- `terminated`

Mission's workflow runtime then projects its own session lifecycle vocabulary into the mission runtime record. The point is not that every provider behaves identically. The point is that Mission can normalize providers into a shared orchestration model.

## Prompt Submission And Structured Commands

The runtime contract supports two distinct interaction paths:

- freeform prompts
- structured commands such as `interrupt`, `continue`, `checkpoint`, and `finish`

Whether a given runner truly supports those operations is capability-driven. For example:

- the Copilot CLI terminal runner supports prompt submission, structured commands, interruption, and attachment, but not MCP client attachment
- the Copilot SDK runner supports prompt submission, structured commands, attachment, telemetry, and MCP client attachment

Mission does not assume that every provider exposes the same transport or interaction semantics. That is why capabilities are part of the runner contract.

## Bounded Task Launch Prompt

When Mission launches a task session, it builds a bounded launch prompt that names:

- the task sequence and subject
- the mission workspace boundary
- the authoritative task file path
- the task summary

The prompt explicitly tells the agent to stay strictly inside the mission workspace and to treat the task file as authoritative. That is the runtime boundary between workflow planning and agent execution.

## Reattachment, Failure, And Cleanup

Mission is designed to survive reconnects and stale provider state:

- the orchestrator can attach to existing sessions when a runner supports it
- session snapshots can be persisted and normalized
- terminal sessions are released when a session reaches a terminal phase
- if a previously known provider session no longer exists, Mission normalizes that attachment to a terminated session rather than pretending it is still alive

That last behavior is important for crash recovery. Reattachment failure becomes explicit terminated state with a reason, not silent ambiguity.

## MCP Attachment

Mission can attach MCP server references to a session start request when the selected runner supports MCP client behavior. The orchestrator merges explicitly requested MCP servers with any injected servers and rejects the request if the chosen runner does not support MCP attachment.

Today that means MCP is architecture-supported but runner-specific:

- supported by the Copilot SDK runner
- not supported by the terminal-backed Copilot CLI runner

## What Operators Should Understand

For operators, the most important facts are:

1. A task is the workflow object; a session is the live runtime attached to it.
2. Session capabilities vary by runner, but Mission normalizes them behind one contract.
3. Cancellation and termination are first-class lifecycle operations.
4. Reattachment is supported where the provider permits it.
5. Missing or stale provider sessions are surfaced as terminated state rather than hidden.

That contract is what lets Mission remain runtime-neutral while still giving the human a concrete, governable session model.