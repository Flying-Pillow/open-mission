# Agent Runtime

Mission's agent runtime is a provider-neutral execution boundary. It allows the workflow engine to launch, attach, prompt, command, cancel, and terminate sessions without hard-coding orchestration semantics to one provider or one transport.

This is not an implementation detail. It is the boundary that keeps workflow policy separate from provider SDK behavior.

## The Common Contract

The core runner interface is intentionally small:

- runtime id
- transport id
- display name
- capability declaration
- availability check
- start session
- optional attach session
- optional list sessions

Each session then exposes:

- `getSnapshot()`
- `submitPrompt(...)`
- `submitCommand(...)`
- `cancel(...)`
- `terminate(...)`
- event subscription

That contract is the stable center of the runtime architecture.

## Runner Capabilities And Transport Identity

Mission makes runner capabilities explicit through `AgentRunnerCapabilities`. The current capability model covers:

- attachable sessions
- prompt submission
- structured commands
- interruptible behavior
- interactive input support
- telemetry
- MCP client support

Transport identity is separate from runtime identity. That matters because different runners can represent the same provider through different substrates. For example:

- the Copilot CLI runner uses transport id `terminal`
- the Copilot SDK runner uses transport id `direct`

This separation lets Mission reason about provider identity and transport behavior independently.

## Session Lifecycle Flow

The orchestrated lifecycle is:

1. workflow emits a `session.launch` request
2. request executor chooses the configured runner
3. `AgentSessionOrchestrator` starts or attaches the session
4. the runner returns a normalized `AgentSession`
5. session events are translated back into workflow events
6. workflow state updates the mission runtime record

The same runtime boundary is used later for:

- prompt submission
- structured commands
- cancellation
- termination
- reattachment

This keeps provider control inside the runtime layer rather than scattering it across workflow code and UI code.

## Session Start, Attach, Prompt, Command, Cancel, Terminate

The runtime contract supports six operator-meaningful flows:

| Flow | Meaning |
| --- | --- |
| Start | Create a new provider-backed session for a task |
| Attach | Rebind Mission to an existing provider session |
| Prompt | Send freeform text into a live session |
| Command | Send a structured Mission command such as `interrupt` |
| Cancel | Stop a session cooperatively and mark it cancelled |
| Terminate | Stop a session as a harder end-state and mark it terminated |

The orchestrator persists and normalizes snapshots as those actions occur. When a provider session no longer exists, attachment is normalized into an explicit terminated snapshot rather than hidden behind a false positive.

## MCP Attachment

Mission can include MCP server references in session start requests. The orchestrator merges explicitly requested MCP servers with injected servers and only passes them to a runner when that runner declares `mcpClient: true`.

Today that means:

- the Copilot SDK runner supports MCP attachment
- the Copilot CLI terminal runner does not

This is a good architectural boundary. MCP support is additive capability, not a hard dependency of the runtime model.

## Concrete Copilot Examples

The current codebase includes two concrete adapters:

### Copilot CLI Runner

The terminal-backed Copilot CLI runner:

- launches sessions through `TerminalAgentTransport`
- supports prompt submission and interrupt-style commands
- polls the terminal substrate to infer output and terminal phase
- can reattach to named terminal sessions
- does not support MCP attachment

### Copilot SDK Runner

The Copilot SDK runner:

- creates direct SDK sessions
- uses SDK events to update normalized session snapshots
- supports prompt submission and interrupt-style commands
- supports MCP server mapping when provided
- supports attachment by resuming SDK sessions

These adapters differ operationally, but they both implement the same Mission runtime boundary.

## Why This Matters Architecturally

For an adopting team, the important conclusion is not that Mission works with Copilot in two ways. It is that Mission's workflow engine does not need to care which one is underneath. The runtime boundary keeps provider specifics below the orchestration layer while still exposing a governable session model to the daemon and Tower.