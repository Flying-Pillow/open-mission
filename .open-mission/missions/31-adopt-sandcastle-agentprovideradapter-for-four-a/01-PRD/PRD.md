---
title: "PRD: #31 - Adopt Sandcastle `AgentProviderAdapter` for four agent coders without sandboxing"
artifact: "prd"
createdAt: "2026-05-04T07:01:50.223Z"
updatedAt: "2026-05-04T09:18:09.261Z"
stage: "prd"
---

# PRD: Adopt Sandcastle `AgentProviderAdapter` for Four Agent Coders Without Sandboxing

**Branch:** `mission/31-adopt-sandcastle-agentprovideradapter-for-four-a`

## Outcome

Mission will adopt `@ai-hero/sandcastle` as a **provider-adapter dependency** for provider-specific command construction and optional stream parsing behind a Mission-owned `AgentProviderAdapter` boundary.

The product outcome is:

1. Mission exposes four Sandcastle-backed agent coders through its own registry:
   - `claude-code`
   - `pi`
   - `codex`
   - `opencode`
2. Interactive-capable providers still launch through Mission's existing daemon-owned PTY transport, including the current `TerminalAgentTransport` / `node-pty` path.
3. Airport terminal attach, input, resize, reconnect, screen state, logs, and runtime ownership continue to work unchanged.
4. Mission retains ownership of agent session lifecycle, Mission worktree selection, terminal transport, runtime messages, session logs, and state-store updates.
5. The integration creates a small Mission-owned extension point so future compatible Sandcastle providers can be added by registering exported provider factories without adopting Sandcastle orchestration or sandbox features.
6. Mission introduces a first-class Mission-owned agent signal boundary so two-way Mission/workflow <-> Agent session communication is explicit, policy-governed, and not dependent on raw terminal text being interpreted as workflow law.

## Operating Context

### Affected Surface

- Mission agent runtime and provider registry
- `AgentRunner` / `AgentSession` runtime boundary
- Mission terminal launch path
- `TerminalAgentTransport` / `node-pty` integration
- Mission worktree selection
- Provider metadata mapping
- Optional print-mode and stream parsing behavior
- Runtime message conversion
- Agent session signal parsing, policy, and promotion
- Agent session execution UX and operator input affordances
- Optional local Mission MCP signal server for agent-to-Mission state reporting
- Mission agent runtime Skill/instruction protocol for runtimes without a stronger structured channel
- Daemon audit and state logging decisions
- Airport terminal behavior for agent sessions

### Authoritative Inputs

1. `.mission/missions/31-adopt-sandcastle-agentprovideradapter-for-four-a/BRIEF.md`
2. Issue #31 as captured in that brief
3. `.mission/missions/31-adopt-sandcastle-agentprovideradapter-for-four-a/01-PRD/tasks/01-prd-from-brief.md`

## Problem Statement

Mission already owns agent lifecycle, worktree choice, terminal transport, logs, state updates, and Airport UI behavior, but provider-specific command construction is scattered and does not yet use Sandcastle's exported provider adapters for Claude Code, Pi, Codex, and OpenCode.

Without a Mission-owned adapter boundary around Sandcastle's public provider shape, adding these providers risks:

- leaking dependency-specific types and behavior into core Mission runtime code
- accidentally adopting Sandcastle features that conflict with Mission's runtime ownership
- treating provider output or model-authored text as authoritative workflow state
- confusing terminal-level interactive I/O with structured two-way Mission/workflow signaling

The product problem is to gain Sandcastle's provider command-building and optional stream-parsing value while preserving Mission as the sole owner of:

- session lifecycle
- PTY execution
- terminal UX
- runtime messages
- session logs
- state transitions
- signal interpretation and promotion into workflow-visible state

## Success Criteria

### Core Integration

- `@ai-hero/sandcastle` is added in the appropriate Mission package as a dependency-backed provider adapter source.
- Mission has a Sandcastle-backed `AgentProviderAdapter` boundary instead of using Sandcastle provider APIs directly throughout runtime code.
- Mission registers and can launch `claude-code`, `pi`, `codex`, and `opencode` through its adapter registry.
- Existing Mission runtime abstractions remain the owner of lifecycle, state, logs, and terminal behavior.
- Mission treats Sandcastle agent initialization as an adapter-owned provider factory and launch-plan step. The adapter must instantiate the selected Sandcastle provider with Mission-resolved model/options, validate capabilities, merge provider env with Mission/provisioner env, and build an explicit launch plan before the daemon starts the Agent session.
- Mission has a canonical `AgentSessionSignal` / observation boundary that accepts inputs from local MCP calls, Sandcastle/provider structured parsing, model-emitted Mission protocol markers, and terminal heuristics.
- Mission has a Mission-owned signal policy that is the only authority allowed to promote observations into `AgentSession` snapshots, `AgentSessionEvent`s, workflow-visible state, state-store transactions, or daemon broadcasts.
- Mission exposes or launches a local Mission MCP signal server for agent runtimes that can use MCP, and that server is session-scoped, local-only, schema-validated, idempotent, and connected to the daemon through a narrow Mission-owned signal port.
- Mission automatically provisions MCP access for every MCP-capable Agent session by registering the session with the Mission MCP signal server, materializing the selected runner's expected MCP client configuration, and injecting session-scoped identity into the launch environment.

### Interactive and Non-Interactive Behavior

- Interactive-capable providers use Sandcastle `buildInteractiveArgs()` to produce command and args, and Mission executes the result through existing `TerminalAgentTransport` / PTY infrastructure.
- Non-interactive or structured-output paths may use Sandcastle `buildPrintCommand()` and `parseStreamLine()` only where they fit Mission's runtime model and do not bypass Mission runtime ownership.
- Interactive mode is terminal-duplex only: Mission can send terminal input and capture terminal output through its PTY, but Sandcastle interactive launch does not provide a structured provider-native callback protocol for awaiting-input, ready, blocked, done, or workflow events.
- SDK / print / non-interactive mode is structured-output but not live-duplex: Mission may send a prompt/stdin payload and parse provider output, but must not assume mid-run input injection or provider-native workflow callbacks.
- A provider that lacks interactive support may still be registered and launched through an honest limited-capability path; Mission must not misrepresent it as interactive.
- Print-only or exec-only provider behavior must remain off the Airport interactive terminal path and be surfaced only through honest non-interactive runtime behavior.
- Airport terminal attach, input, resize, reconnect, and session behavior remain compatible for Sandcastle-backed providers.
- Mission-to-agent and agent-to-Mission communication must remain explicit through Mission's existing `AgentSession` / runtime event path rather than through hidden provider-local control flow.
- If a running agent needs operator input, that state must be surfaced back to Mission/workflow as an explicit awaiting-input signal compatible with the existing Mission runtime model.
- If a running agent becomes ready to continue, resumes progress, emits normalized messages, or completes/fails, those state changes must continue to flow back into Mission/workflow through Mission-owned session snapshots, events, and daemon broadcasts.
- A local Mission MCP signal server is the preferred high-confidence side channel where an agent runtime can call MCP tools; it must be optional and capability-gated because not every in-scope provider/runtime can be assumed to support MCP.
- Mission Skills or instructions may teach agents to use the MCP tools or, when unavailable, emit strict Mission protocol markers in stdout, but those markers are behavioral guidance and remain lower-trust claims until evaluated by Mission-owned policy.

### Execution UX and Operator Input

- The current PTY-backed terminal experience is a protected product capability. Interactive Agent sessions must continue to use the existing Airport terminal pane for live input, output, attach, resize, reconnect, scrollback/screen state, focus behavior, keyboard shortcuts, copy/paste, logs, and terminal lifecycle.
- The Sandcastle adoption must not replace the terminal with a chat UI, transcript-only surface, or provider-specific console. For interactive-capable providers, the terminal remains the primary operator control.
- Mission must publish each Agent session's operator interaction mode explicitly so Airport can render the correct input affordance:
  - `pty-terminal`: live terminal input is available and is the primary UX.
  - `agent-message`: no live PTY input is available, but Mission can accept structured follow-up prompts or commands for the Agent session or next Agent iteration.
  - `read-only`: the session can be observed but cannot currently receive operator input.
- For `pty-terminal` sessions, any new UI must be additive and non-disruptive. It must not steal focus from the terminal, duplicate keystrokes, intercept terminal keyboard shortcuts, or obscure the terminal output.
- For `agent-message` sessions, Airport should expose a narrow prompt/command composer below the Agent session panel or equivalent session detail surface. That composer sends Mission-owned `AgentPrompt` or `AgentCommand` messages through the daemon/runtime API; it must not write directly to a provider process, bypass the workflow, or pretend to be terminal input.
- The prompt/command composer must show why terminal input is unavailable, what communication mode is active, whether the message will resume/continue an existing provider session or start a follow-up iteration, and whether MCP signaling is validated, degraded, or unavailable.
- The composer must be disabled with a clear reason when a provider/session is one-shot, completed, cancelled, failed, lacks resume/follow-up support, or is otherwise not accepting input.
- If an Agent session requests operator input through MCP, provider-structured output, or policy-promoted markers, Airport must show that request in the session state and route the operator response through the correct channel for the session's interaction mode:
  - terminal input for `pty-terminal`
  - structured `AgentPrompt` / `AgentCommand` submission for `agent-message`
  - read-only explanation for `read-only`
- User-entered prompt/command submissions are Mission-to-agent messages. They must be logged, correlated with the Agent session, and reflected in session events/snapshots just like terminal-delivered operator input, while preserving the distinction between terminal input and structured follow-up prompts.
- This mission may add the minimum Airport UI and route/gateway support required for this interaction-mode projection, but it must not redesign Airport's terminal model or introduce provider-specific Airport UI.

### Sandcastle Provider Initialization

- Sandcastle's current provider surface does not expose a separate async "initialize AgentSession" lifecycle hook. The practical initialization point is creating the provider instance from the exported factory, then calling its command builder for the chosen mode.
- Mission's `AgentProviderAdapter` must therefore own initialization semantics around Sandcastle rather than expecting Sandcastle to initialize Mission sessions.
- For each launch, the adapter must:
  - resolve the Mission runner id to exactly one Sandcastle provider factory: `claudeCode`, `pi`, `codex`, or `opencode`
  - resolve model, effort/reasoning options, permission-bypass policy, resume-session data where supported, and provider env from Mission-owned settings
  - create the Sandcastle provider instance with those resolved options
  - read and preserve provider facts such as `name`, `env`, `captureSessions`, `buildInteractiveArgs`, `buildPrintCommand`, `parseStreamLine`, and optional `parseSessionUsage`
  - verify the selected mode is supported before launch; for example, interactive launch requires `buildInteractiveArgs`
  - merge Sandcastle provider env, Mission runtime env, and MCP provisioner launch env with an explicit precedence policy and without leaking secrets into tracked files
  - convert Sandcastle's interactive args into a Mission launch plan where the executable, argv, working directory, env, and initial prompt behavior are explicit
  - convert Sandcastle's print command into a non-interactive Mission launch plan that preserves `stdin` when returned by Sandcastle and does not attach to Airport's interactive terminal path
  - expose `captureSessions` and `parseSessionUsage` as optional observation/metadata capabilities only, not as Mission session ownership
- The adapter must validate launch-plan output before spawning. Empty commands, missing executables, unsupported mode, unknown provider name, malformed env, or unsupported resume/session-capture behavior must fail with explicit provider-initialization errors.
- Current upstream Sandcastle facts that must be reflected by implementation tests:
  - all four provider factories accept a model and optional provider-specific options
  - all four current providers expose `env`, `captureSessions`, `buildPrintCommand`, `buildInteractiveArgs`, and `parseStreamLine`
  - Claude Code defaults `captureSessions` to true, supports optional `parseSessionUsage`, and emits a structured `session_id` event from `system/init` stream JSON
  - Claude print mode can receive the prompt through `stdin` and supports `resumeSession`; interactive args do not currently expose resume-session handling
  - Pi, Codex, and OpenCode currently default `captureSessions` to false
  - OpenCode currently exposes no useful structured parse events through `parseStreamLine`

### Local MCP Signal Server

- The MCP signal server is a required design surface for this mission. It may run inside the daemon process or as a daemon-managed local sidecar, but in either case the daemon remains the owner of Mission state and signal policy.
- The server must be local-only. It must not expose a remote unauthenticated network endpoint, and it must not depend on external hosted MCP services for Mission state mutation.
- The server must connect to Mission through a narrow port such as `AgentSessionSignalPort`, not by importing workflow internals or mutating repositories/state stores directly.
- Every MCP tool call must be scoped to a known `missionId`, `taskId`, and `agentSessionId`, plus a per-call `eventId` for idempotency.
- The daemon must reject MCP calls for unknown sessions, completed sessions, mismatched task/mission ids, duplicate event ids, invalid payloads, oversized payloads, or tools not allowed for the current session capability.
- MCP calls produce high-confidence claims, not automatic workflow law. They still pass through Mission-owned signal policy before becoming snapshots, events, workflow state, or broadcasts.
- The MCP server must expose narrowly scoped tools for:
  - reporting progress
  - requesting operator input
  - reporting blocked state
  - reporting ready for verification
  - reporting completion claims
  - reporting failure claims
  - appending a session note
  - optionally reporting usage or provider metadata when a provider exposes it
- The MCP server must return an acknowledgement that states whether the signal was accepted, rejected, recorded only, or promoted by policy. The acknowledgement is delivery feedback, not proof that workflow verification passed.
- Agent launch context must tell MCP-capable runtimes how to reach the local Mission MCP server and which session identity to use. Non-MCP runtimes must continue to launch honestly with lower-confidence fallback signaling.

### AgentSession MCP Access Provisioning

- Mission must not assume a universal industry-standard MCP config file across all coding agents. The shared standard is MCP itself; client configuration is runner-specific.
- Mission must introduce an `AgentSessionMcpAccessProvisioner` or equivalent service that makes the local Mission MCP signal server automatically available to each launched MCP-capable Agent session.
- The provisioner must register the Agent session with the Mission MCP signal server before launch and receive session-scoped registration data, allowed tools, endpoint/bridge configuration, event-id de-duplication scope, and credentials or tokens if needed.
- The provisioner must materialize runner-specific MCP client configuration rather than relying on one generic `.agents/mcp.json` file:
  - Claude Code uses repo/project-scoped `.mcp.json` with `mcpServers` where appropriate.
  - Codex uses project-scoped `.codex/config.toml` with `[mcp_servers.<name>]` where appropriate.
  - OpenCode configuration is version-sensitive and must support the active OpenCode convention, such as current `opencode.json` / `opencode.jsonc` `mcp` configuration or older `.opencode.json` / `mcpServers` where required.
  - Pi MCP support is unknown unless proven by the implementation; Pi must default to degraded non-MCP signaling until support is verified.
- The preferred portable access pattern is a per-session local stdio MCP bridge command, such as a Mission CLI subcommand, that exposes Mission tools to the agent and forwards calls to the daemon-owned signal port.
- Per-session secrets, credentials, tokens, and session ids must not be committed to tracked repository files. They must be supplied through launch environment variables, generated untracked temporary config, a controlled runtime config directory, or an equivalent daemon-owned ephemeral mechanism.
- Static project config may reference environment variables for session identity, but it must not contain live session secrets.
- The provisioner must publish each session's MCP access state as one of: `mcp-validated`, `mcp-degraded`, or `mcp-unavailable`.
- If runner policy requires MCP and provisioning fails, launch must fail explicitly. If MCP is optional, launch may proceed only with degraded capability surfaced to Mission runtime and operator surfaces.
- Generated per-session MCP config must be cleaned up when the Agent session ends where the selected runner/config format permits cleanup.

### Capability and Failure Semantics

- Unsupported provider capabilities are surfaced honestly as unavailable states or explicit runtime errors.
- If a Sandcastle export gap blocks one of the four in-scope providers, Mission may land that provider in an explicit unavailable state only when the gap is documented and an upstream issue or PR is part of the delivery record.
- Provider-specific settings such as model, effort, resume session, and permission handling stay in Mission metadata or adapter-local configuration rather than expanding broad core runtime fields.
- Missing MCP support must not block provider registration when the provider can still launch honestly; it must reduce the confidence of agent-to-Mission signals and fall back to provider parsing or Mission protocol markers.
- MCP server startup/configuration failure for an MCP-capable runtime must be surfaced as degraded signaling capability or explicit launch failure according to runner policy; it must not silently pretend high-confidence signaling is available.
- MCP access provisioning failure must be reported separately from provider launch failure so operators can distinguish "agent cannot run" from "agent can run but high-confidence MCP signaling is unavailable."
- Raw terminal text and heuristic parsing must never be treated as authoritative completion, verification, gate, or delivery evidence.
- Agent claims such as done, blocked, ready for verification, or needs input must be represented as signals with source/confidence and must pass Mission-owned policy before they affect workflow-visible state.
- "Agent completed", "agent claims ready", "ready for verification", and "verification passed" are separate concepts. This mission must not collapse them into one terminal-output-derived state.

### Evidence and Documentation

- Tests cover provider registration, command-building behavior, transport invocation, explicit handling of missing `buildInteractiveArgs()`, any supported stream parsing boundary, and the prohibition on Sandcastle orchestration imports.
- Tests cover the wrapped provider contract that Sandcastle actually exports today: provider `name`, `env`, session-capture signaling, command builders, and stream parsing behavior where supported.
- Tests cover the Mission-owned signal boundary, signal source confidence, promotion policy, and rejection of raw or malformed output as workflow authority.
- Tests cover MCP-sourced signals as high-confidence claims, Sandcastle parsed output as provider-structured observations, Skill/marker output as agent-declared claims, and heuristic terminal parsing as low-confidence diagnostics.
- Relevant Mission runtime documentation is updated to explain the Sandcastle dependency boundary and preserved Mission / Airport ownership model.

## Constraints

### Disallowed Sandcastle Usage

Mission must **not** adopt or use:

- Sandcastle `run()`
- Sandcastle `interactive()`
- `createSandbox()`
- `createWorktree()`
- Docker sandbox providers
- Podman sandbox providers
- Vercel sandbox providers
- Daytona sandbox providers
- Sandcastle branch strategies
- Sandcastle worktree lifecycle management
- Sandcastle orchestration lifecycle
- foreground interactive execution managed by Sandcastle

### Required Runtime Ownership

- Mission must continue to run agents inside the Mission-selected worktree using Mission-owned daemon lifecycle, PTY transport, logs, and state-store ownership.
- Airport's terminal UI model is not being redesigned in this mission; provider-native prompts must still flow through the existing Airport terminal pane behavior.
- Additive Airport UX is allowed only to expose Mission-owned Agent session interaction modes. The PTY terminal remains unchanged for interactive sessions; a prompt/command composer is allowed only when the session does not have live terminal input or when policy directs a structured operator response through Mission runtime APIs.
- Parsed Sandcastle output is runtime observation only. Mission decides what becomes runtime messages, terminal updates, daemon audit logs, or state-store transactions.
- Raw terminal output remains daemon-owned session log material unless Mission explicitly promotes structured information into runtime messages.
- Mission's daemon-owned `AgentSession` event flow remains authoritative for workflow-visible agent state, including started, attached, updated, awaiting-input, resumed/ready-to-continue, completed, failed, cancelled, and terminated states.
- The workflow engine and operator surfaces must continue to learn about agent readiness or operator-needed input through Mission-owned session events and snapshots, not by calling Sandcastle provider APIs directly and not by inferring hidden provider-local state.
- Mission-owned signal policy is the only authority that may convert an observation into a workflow-visible state transition.
- The local MCP signal server, Sandcastle provider parser, Mission protocol marker parser, and terminal heuristic parser are adapters into the signal boundary. None of them owns Mission state.
- Agent session logs remain audit material. Log-derived signals are observations until promoted by policy and must not replace deterministic verification evidence.
- The daemon must own MCP session registration, session capability publication, event id de-duplication, and signal acknowledgement semantics.
- The daemon must own automatic MCP access provisioning and must prevent tracked repository files from receiving per-session secrets.

### Dependency Boundary Rules

- Allowed dependency use is limited to importing exported provider factories, importing public provider-related types, calling provider command builders, and calling provider stream parsers where useful.
- If Sandcastle does not export enough stable provider-level API, the only acceptable fallback is a very small Mission-owned compatibility type matching the public provider runtime shape while still using exported provider factories where possible.
- Missing stable exports must be documented, and the required follow-up path is to pursue an upstream issue or PR to expose provider APIs before relying on a minimal Mission-owned compatibility type around the public runtime shape.
- A missing export may justify an explicit unavailable state for an in-scope provider, but only with documented evidence and upstream action; silent omission is not allowed.
- Automatic provider discovery is not required unless Sandcastle exposes a stable public provider registry; explicit Mission registry entries are acceptable.

### Known Unrelated Failures

None were identified in the intake brief or task instructions.

### Compatibility Policy

Preserve current Mission runtime and Airport compatibility:

- no migration of runtime ownership to Sandcastle
- no sandbox fallback
- no broadening of Mission core types for provider-specific concerns
- no legacy provider-path compatibility shims beyond the runtime semantics Mission already owns
- no direct workflow mutation from provider output, model prose, or terminal heuristics
- no direct workflow mutation from MCP tool handlers
- no replacement of the existing PTY terminal UX for interactive sessions
- no chat-style composer as the primary control for `pty-terminal` sessions
- no assumption that interactive mode is structured-duplex
- no assumption that SDK / print mode supports live mid-run input
- no requirement that every provider support MCP; MCP support is preferred and capability-gated
- no remote MCP dependency for core Mission state signaling
- no assumption that `.agents/mcp.json` or any single config file is consumed by all coding agents
- no committed per-session MCP credentials, tokens, endpoint secrets, or session ids

## Verification Expectations

### Smallest Verification Signals

1. Adapter registry contains `claude-code`, `pi`, `codex`, and `opencode`.
2. Each registered provider can produce a Mission terminal launch request.
3. Interactive providers route through `buildInteractiveArgs()` and then into `TerminalAgentTransport`.
4. Print-only behavior, if exposed, routes through `buildPrintCommand()` without bypassing Mission runtime ownership.
5. Provider environment variables merge through Mission's existing environment handling.
6. Provider metadata mapping covers model, effort, resume session, and permission settings where supported.
7. Agent-to-Mission signaling still surfaces awaiting-input, message, progress/update, completion, failure, and termination states through Mission-owned session events or snapshots.
8. Agent readiness or resume-to-continue signals, where detectable, are translated back into Mission runtime observations without bypassing the Mission event path.
9. Mission-owned signal policy accepts, rejects, or downgrades signals according to their source and confidence.
10. MCP-sourced signals, provider-structured Sandcastle parsing, agent-declared Mission protocol markers, and terminal heuristics are distinguishable in tests and runtime types.
11. Malformed markers, spoofed raw text, and heuristic matches cannot mark a task verified, delivered, or completed as workflow truth.
12. Local MCP server tool calls are session-scoped, schema-validated, idempotent, and acknowledged with accepted/rejected/recorded/promoted outcomes.
13. MCP tool handlers cannot bypass `AgentSessionSignalPolicy` or mutate workflow state directly.
14. Agent launch context for MCP-capable runtimes includes the local MCP endpoint/configuration and session identity needed to report signals.
15. The MCP access provisioner materializes runner-specific MCP client config for Claude Code, Codex, and OpenCode where supported, and reports Pi as non-MCP/degraded unless support is proven.
16. Per-session MCP credentials are supplied through environment or daemon-owned ephemeral config and are not written into tracked files.
17. Missing or unsupported capabilities fail explicitly instead of pretending support.
18. Mission runtime code does not import or call Sandcastle sandboxing or orchestration APIs.
19. Parsed stream output, where supported, is converted only into Mission runtime observations.
20. Agent session UX tests prove interactive sessions keep the existing PTY terminal as the primary input/output surface, non-interactive sessions expose only a Mission-owned prompt/command composer when follow-up input is supported, and read-only sessions explain why input is unavailable.

### Known Unrelated Failing Checks

None documented by the intake brief. If unrelated baseline failures are discovered during implementation, they should be treated as non-blocking to this mission and recorded separately.

## Non-Goals

- Adopting Sandcastle sandbox, worktree, Docker, Podman, Vercel, Daytona, branch-strategy, or orchestration features
- Replacing Mission-owned lifecycle, terminal transport, logs, state updates, or Airport terminal ownership
- Changing Airport's terminal UI model beyond preserving existing attach / input / resize / reconnect behavior and adding a provider-neutral prompt/command affordance for sessions without live terminal input
- Broadening core Mission runtime types with provider-specific fields when metadata or adapter-local configuration is sufficient
- Preserving old provider-specific runner paths as fallback shims after the Sandcastle-backed adapter path exists
- Automatic support for unregistered future providers without an explicit compatible factory registration path
- Treating text parsing, model instructions, or Skills as the canonical state-transition mechanism
- Building an MCP server that owns workflow decisions rather than adapting tool calls into Mission's signal policy
- Exposing Mission state mutation through a remote or unauthenticated MCP endpoint
- Claiming full structured duplex communication for Sandcastle interactive mode or live mid-run input for SDK / print mode
- Requiring or inventing a universal `.agents/mcp.json` runtime config as if every agent consumes it

## Required Design Shape

- The implementation must use a Mission-owned adapter layer around Sandcastle's public `AgentProvider` shape rather than direct Sandcastle usage throughout runtime code.
- The current upstream `AgentProvider` contract is concrete and must be wrapped accurately: `name`, `env`, `captureSessions`, `buildPrintCommand()`, optional `buildInteractiveArgs()`, `parseStreamLine()`, and optional `parseSessionUsage()`.
- The implementation must introduce a Mission-owned agent signal boundary that separates observation ingestion from workflow state mutation.
- Signal sources must be explicitly tracked at least as:
  - daemon-authoritative lifecycle/process state
  - MCP-validated agent signal
  - provider-structured Sandcastle/parser output
  - agent-declared Mission protocol marker
  - terminal-heuristic diagnostic
- Signal confidence must determine what a signal is allowed to do; low-confidence signals may inform operators but must not pass gates or mark tasks verified.
- The Mission adapter contract must explicitly model:
  - provider identity
  - label
  - capabilities for `interactive`, `print`, `streamParsing`, and `sessionCapture`
  - interactive launch building
  - print launch building
  - runtime output parsing
  - optional session-usage extraction where a provider exposes it
- Mission `AgentLaunchConfig`, `AgentPrompt`, and provider metadata must map into Sandcastle provider options through the adapter boundary.
- Mission owns the registry that maps Mission runner ids to Sandcastle provider factories.
- Future compatible providers are added by explicit registry entry when Sandcastle exports factories matching the same public `AgentProvider` shape, unless Sandcastle later exposes a stable public registry.
- Exact constructor signatures must follow Sandcastle's public exports at implementation time.
- A Mission runtime Skill/instruction protocol must tell agents how to use MCP tools where available and strict fallback Mission protocol markers where MCP is unavailable, while making clear that deterministic verification, not agent assertion, proves correctness.
- The MCP server must be specified as a local Mission runtime capability with explicit tool contracts, launch-time session registration, and daemon-owned acknowledgement semantics.
- The MCP access provisioner must be specified as the automatic bridge between Mission Agent sessions and each runner's actual MCP client configuration mechanism.

## Provider Requirements

### Claude Code

- Use Sandcastle's Claude Code provider for command construction.
- Support:
  - model
  - effort, where supported
  - resume session, where supported
  - deliberate permission-bypass mapping from Mission policy
- Current upstream Sandcastle exposes Claude session capture and optional session-usage parsing; Mission must decide explicitly whether and how to consume those signals without yielding runtime ownership.
- Current upstream Sandcastle exposes `resumeSession` on Claude print-command construction, but not on `buildInteractiveArgs()`; Mission must not assume interactive resume support that the provider contract does not actually export.

### Pi

- Replace or refactor the existing Mission Pi runner path so Pi launches through the Sandcastle-backed adapter.
- Preserve the current shared terminal-transport behavior.
- Current code indicates Pi-specific behavior is limited to runner identity and launch command over that shared path.

### Codex

- Add Codex as a Sandcastle-backed agent coder.
- Support interactive launch only if the provider exposes `buildInteractiveArgs()`.
- Otherwise, surface the capability honestly.

### OpenCode

- Add OpenCode as a Sandcastle-backed agent coder.
- Handle provider-specific limitations explicitly, especially when stream parsing is passthrough or unavailable.

### Partial Capability Policy

Providers with partial capability remain in scope if Mission can represent those limits truthfully through adapter capabilities and runtime behavior.

Provider communication capabilities are also partial:

- Interactive providers support terminal-level duplex I/O through Mission's PTY, not structured provider-native workflow callbacks.
- Print / SDK-style providers support one-shot prompt input and parseable output where `parseStreamLine()` is useful, not live mid-run operator input.
- MCP-capable runtimes may provide the highest-confidence agent-to-Mission signal path, but support must be detected/configured per runner and must not be assumed globally.
- Providers without MCP support may still participate through provider-structured parsing and Mission protocol markers, with lower confidence and stricter policy.

### Current Upstream Provider Facts

- Sandcastle currently exports provider factories `claudeCode`, `pi`, `codex`, and `opencode` from the top-level package.
- All four current providers expose `buildPrintCommand()`, `buildInteractiveArgs()`, and `parseStreamLine()`.
- `captureSessions` is currently enabled by default for Claude Code and disabled for the other three providers.
- Optional `parseSessionUsage()` is currently Claude Code-specific.
- OpenCode currently exposes no structured stream parsing output.

## Launch Flow Requirements

The required launch flow is:

1. Mission receives an agent launch request.
2. Mission resolves the selected Mission worktree.
3. Mission selects the Sandcastle-backed provider adapter.
4. The adapter initializes the Sandcastle provider by resolving Mission-owned model/options/env, constructing the provider instance, reading provider facts/capabilities, and validating the selected launch mode.
5. Mission registers/provisions MCP access before launch when the selected runner can consume MCP, then merges provisioner launch env into the provider launch env.
6. The adapter asks the Sandcastle provider for the mode-specific launch shape: `buildInteractiveArgs()` for PTY-backed interactive sessions or `buildPrintCommand()` for honest non-interactive sessions.
7. Mission validates the launch plan, including executable/args, env, mode, and any `stdin` required by print mode.
8. Mission starts interactive plans via `TerminalAgentTransport`; print plans remain on a non-interactive runtime path and must not masquerade as Airport terminal sessions.
9. Airport attaches to the Mission terminal session using the existing terminal APIs.
10. Operator input, resize, reconnect, and screen-state behavior continue through Mission's existing terminal APIs.
11. Mission runtime continues to translate terminal/provider observations into Mission-owned `AgentSession` snapshots and events for workflow and surface consumers.
12. When the agent requires operator input or becomes ready to continue, that state is surfaced back through Mission-owned session signaling rather than hidden inside provider-local transport behavior.

Sandcastle `interactive()` must not be used because it would hand current-process stdio directly to the provider command and bypass Mission's daemon-owned PTY model.

## Agent Signal Binding Requirements

Mission must implement two-way bindings as a layered, policy-governed signal model:

1. Mission/workflow sends prompts and commands to an Agent session through `AgentPrompt` and `AgentCommand`.
2. Agent runtimes send state claims or observations back through one of the supported observation sources:
   - daemon-authoritative lifecycle/process updates
   - local Mission MCP signal tools where available
   - Sandcastle/provider structured output parsing
   - strict Mission protocol markers emitted by a model following Mission Skills/instructions
   - terminal heuristics used only as low-confidence diagnostics
3. Mission normalizes every non-daemon input into an `AgentSessionSignal` or equivalent observation with source and confidence.
4. Mission-owned policy decides whether the signal is rejected, recorded as audit/diagnostic material, emitted as a `session.message`, or promoted into a session snapshot/event such as awaiting-input, updated/progress, ready-for-verification, failed, or completed.
5. Workflow state is derived from policy-approved Mission session snapshots/events, not raw provider output.

The preferred high-confidence agent-to-Mission path is a local Mission MCP signal server. It must expose narrowly scoped tools for reporting progress, requesting operator input, reporting blocked state, reporting ready-for-verification, recording completion/failure claims, appending session notes, and optionally reporting usage/provider metadata. The MCP server must be a runtime adapter into Mission policy, not a workflow owner.

### MCP Server Functional Requirements

The MCP signal server must implement the following behavior:

1. **Placement:** run in-process with the daemon or as a daemon-managed local sidecar. If sidecar-based, the daemon owns startup, shutdown, health checks, endpoint discovery, and cleanup.
2. **Transport:** use only local stdio, local pipe/socket, or loopback with session-scoped credentials. Remote hosted MCP is forbidden for Mission state signaling.
3. **Registration:** when an Agent session starts, Mission registers the session with the MCP signal server and provides session identity, allowed tools, event id de-duplication scope, and any endpoint/configuration needed by the agent runtime.
4. **Tools:** expose stable Mission tool names such as `mission_report_progress`, `mission_request_operator_input`, `mission_report_blocked`, `mission_report_ready_for_verification`, `mission_report_completion_claim`, `mission_report_failure_claim`, `mission_append_session_note`, and optionally `mission_report_usage`.
5. **Payloads:** every tool payload must include `missionId`, `taskId`, `agentSessionId`, `eventId`, and a tool-specific body. Payloads must be strict-schema validated and bounded in size.
6. **Authorization:** the daemon must verify that the target Agent session exists, belongs to the mission/task, is in a state that can receive the signal, and has MCP signaling enabled.
7. **Idempotency:** duplicate `eventId`s for a session must not create duplicate events or repeated workflow transitions.
8. **Policy:** tool calls become `mcp-validated` signals and must pass through `AgentSessionSignalPolicy`.
9. **Acknowledgement:** tool responses must tell the agent whether the signal was accepted, rejected, recorded only, or promoted, with a reason and any resulting session state summary.
10. **Failure behavior:** MCP server unavailability must be surfaced as degraded signaling or launch failure according to runner capability, never hidden as successful high-confidence signaling.
11. **Audit:** accepted and rejected MCP calls must be auditable through daemon-owned runtime logs or session observations without turning the raw log into workflow truth.

Skills and task instructions must teach agents to call MCP tools when available. When MCP is unavailable, they may instruct the agent to emit strict Mission protocol markers in stdout. Those markers are lower-confidence agent-declared claims and must be schema-validated, session-scoped, idempotent, and policy-gated.

### MCP Access Provisioning Requirements

Mission must automatically make the local MCP signal server available to Agent sessions that can consume MCP:

1. **No universal config assumption:** Mission must not rely on `.agents/mcp.json` or any other invented universal file. It must support runner-specific MCP client configuration.
2. **Session registration first:** before launch, Mission registers the Agent session with the MCP signal server and receives session-scoped access data.
3. **Bridge-first default:** the preferred integration is a Mission-owned stdio bridge command, such as `mission mcp agent-bridge`, that is launched by the agent's MCP client and forwards calls to the daemon using session-scoped credentials.
4. **Runner materialization:** Mission materializes config for the selected runner:
   - Claude Code project config uses `.mcp.json` / `mcpServers` where appropriate.
   - Codex project config uses `.codex/config.toml` / `[mcp_servers.<name>]` where appropriate.
   - OpenCode uses the active OpenCode config shape for the installed/runtime version.
   - Pi is treated as MCP-unavailable until implementation verifies a supported Pi MCP config mechanism.
5. **Secret handling:** tracked config files may include stable command names and environment-variable references, but never live per-session tokens or credentials.
6. **Launch environment:** the runner launch receives `MISSION_ID`, `MISSION_TASK_ID`, `MISSION_AGENT_SESSION_ID`, the session token/credential, daemon endpoint or bridge target, and any allowed-tool metadata required by the bridge.
7. **Capability publication:** the Agent session records whether MCP access is `mcp-validated`, `mcp-degraded`, or `mcp-unavailable`.
8. **Cleanup:** generated untracked or temporary MCP configuration is cleaned up on session end where possible.
9. **Failure semantics:** provisioning failure fails launch only when runner policy requires MCP; otherwise the session launches with degraded signaling and fallback instructions.

## Runtime Message Handling

- Parsed Sandcastle output is observational input only and never canonical Mission state.
- Mission decides whether an observation becomes:
  - an agent runtime message
  - an awaiting-input or ready-to-continue session state transition
  - a terminal session update
  - a daemon audit log
  - a state-store transaction
- Raw terminal output remains daemon-owned session log material unless Mission explicitly promotes structured information into runtime messages.
- Mission must preserve the existing two-way contract: Mission/workflow can send prompts or commands into the live agent session, and the live agent session can send normalized state and message signals back to Mission/workflow.
- Agent-declared `completed`, `ready`, or `verification passed` text must never directly satisfy workflow completion or verification. At most it may become a ready-for-verification or completion-claim signal that triggers deterministic verification.
- Heuristic terminal parsing may detect possible prompts or waiting states for operator visibility, but must not be used as the only evidence for workflow-critical transitions.

## Documentation Expectations

Relevant Mission runtime documentation must explain:

1. Mission depends on Sandcastle for provider command adapters.
2. Sandcastle does not own Mission agent sessions.
3. Mission does not use Sandcastle sandboxing in this integration.
4. Airport continues to provide the interactive terminal for agent coders.
5. Adding future Sandcastle providers requires registering compatible exported provider factories behind Mission's adapter boundary.
6. Interactive mode is terminal-duplex but not structured-duplex.
7. SDK / print mode is structured-output but not live-duplex.
8. Mission's local MCP signal server is the preferred structured agent-to-Mission side channel where supported.
9. Skills and stdout markers are fallback guidance and claims, not workflow authority.
10. The local MCP server tool contract, session scoping, acknowledgement semantics, and failure behavior are part of the runtime contract.
11. AgentSession MCP access provisioning is automatic, runner-specific, secret-safe, and capability-visible.
12. Execution UX is PTY-first: interactive sessions keep the existing terminal as the primary input/output surface, while non-interactive structured prompt/command input is capability-gated, provider-neutral, and routed through Mission runtime APIs.

## Open Questions

1. What exact public Sandcastle provider factory signatures and exported provider-related types are available at implementation time?
2. How should Mission represent Claude resume behavior, given current upstream Sandcastle exposes `resumeSession` on print-command construction but not on `buildInteractiveArgs()`?
3. How should Mission consume Claude-specific `captureSessions` and optional `parseSessionUsage()` while keeping Mission as the owner of session lifecycle, logs, and state?
4. Which of the four in-scope runtime commands can be configured to use a local MCP server in the target operator environment?
5. Which Mission signal source confidence levels should be allowed to set `awaiting-input` automatically versus requiring operator confirmation?
6. Should the first MCP implementation run in-process with the daemon or as a daemon-managed local sidecar, given the existing daemon process model and agent launch environment?
7. Which runner-specific MCP config materializers can be implemented immediately from public docs, and which require capability detection or operator configuration?
8. Which non-interactive runners should support `agent-message` follow-up submission in the first implementation, and which should remain `read-only` until resume/continuation semantics are proven?
