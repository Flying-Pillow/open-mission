---
title: "SPEC: #31 - Adopt Sandcastle `AgentProviderAdapter` for four agent coders without sandboxing"
artifact: "spec"
createdAt: "2026-05-04T07:01:50.223Z"
updatedAt: "2026-05-04T09:18:09.261Z"
stage: "spec"
---

Branch: mission/31-adopt-sandcastle-agentprovideradapter-for-four-a

## Architecture

### Design

Mission will add a Mission-owned Sandcastle adapter layer inside `packages/core` and keep Sandcastle behind that boundary. The design is:

1. `@ai-hero/sandcastle` is added only to `packages/core` as a provider-adapter dependency.
2. A new Mission-owned `SandcastleAgentProviderAdapter` contract wraps Sandcastle's public provider shape and exposes only Mission-owned initialization results, launch plans, capability flags, and runtime observations.
3. A generic `SandcastleAgentRunner` composes that adapter with the existing `AgentRunner` / `TerminalAgentTransport` path so interactive-capable providers still launch through Mission's daemon-owned PTY transport.
4. `AgentRuntimeFactory` remains the sole registry owner and explicitly registers `claude-code`, `pi`, `codex`, and `opencode`.
5. Mission schemas continue to own which runner ids are legal in runtime data and repository/workflow settings.
6. A Mission-owned `AgentSessionSignal` boundary normalizes agent-to-Mission observations from local MCP tools, Sandcastle/provider parsers, strict Mission protocol markers, and terminal heuristics.
7. A Mission-owned signal policy is the only authority that may promote observations into `AgentSessionSnapshot` updates, `AgentSessionEvent`s, workflow-visible state, state-store transactions, or daemon broadcasts.
8. A local Mission MCP signal server is the preferred high-confidence agent-to-Mission side channel where a runtime can use MCP, but it remains optional per runner and capability-gated per session.
9. An `AgentSessionMcpAccessProvisioner` automatically registers each MCP-capable Agent session with the Mission MCP signal server, materializes runner-specific MCP client configuration, injects per-session identity at launch, and reports MCP access state.
10. Mission Skills/instructions teach agents to use MCP where available and strict fallback markers where MCP is unavailable; Skills are guidance, not state authority.
11. Agent sessions publish an explicit operator interaction mode so Airport can preserve the existing PTY terminal for interactive sessions and expose a narrow prompt/command composer only for non-interactive sessions that can accept structured follow-up input.
12. Airport remains a projection over Mission terminal sessions and Agent session interaction capabilities; it receives no Sandcastle-specific logic.

### Ownership Rules

| Concern | Authoritative owner | Allowed changes | Forbidden changes |
| --- | --- | --- | --- |
| Provider initialization, command construction, env mapping, and optional stream parsing | `packages/core/src/daemon/runtime/agent/providers/*` | Wrap Sandcastle factories, instantiate providers with Mission-resolved model/options, map Mission metadata/env, normalize observations | Import Sandcastle directly in Mission entities, Airport, or workflow code; rely on Sandcastle to initialize Mission sessions |
| Session lifecycle, PTY spawn, attach, input, resize, reconnect, logs | `AgentRunner`, `SandcastleAgentRunner`, `TerminalAgentTransport` | Reuse existing Mission terminal transport and session state flow | Sandcastle `interactive()`, `run()`, sandbox, worktree, branch, or orchestration APIs |
| Runner registry and runner-id legality | `AgentRuntimeFactory.ts`, `AgentRuntimeIds.ts`, `MissionSchema.ts`, `WorkflowSchema.ts` | Add the four Sandcastle-backed runner ids and registry entries | Hidden auto-discovery, parallel legacy registry, implicit runner aliases |
| Agent signal ingestion | `packages/core/src/daemon/runtime/agent/signals/*` | Normalize MCP calls, provider parser output, Mission protocol markers, and terminal heuristics into typed signals | Let runners, parsers, Skills, or MCP tools mutate Mission/workflow state directly |
| Runtime observation promotion | `AgentSessionSignalPolicy` in `packages/core/src/daemon/runtime/agent/signals/*` | Accept, reject, downgrade, or promote signals into Mission-owned observations, runtime messages, snapshots, and events | Treat parsed Sandcastle output, raw terminal text, or model claims as canonical Mission state |
| Persistence and audit material | Existing Mission runtime/state-store/log writers | Preserve current log ownership and state updates | Hand session ownership or raw transcript authority to Sandcastle |
| Local MCP signal server | `packages/core/src/daemon/runtime/agent/mcp/*` plus signal port files | Expose local-only tools for progress, needs-input, blocked, ready-for-verification, completion/failure claims, session notes, and optional usage | Let MCP own workflow decisions, expose remote unauthenticated state mutation, or bypass signal policy |
| AgentSession MCP access provisioning | `packages/core/src/daemon/runtime/agent/mcp/*` and runner integration | Register sessions, create runner-specific MCP client config, inject session env, and publish MCP access state | Assume one universal `.agents/mcp.json`, commit session secrets, or mark unproven runtimes as MCP-capable |
| Mission agent Skill/protocol guidance | `.agents/skills/mission-agent-runtime-protocol/*` | Teach agents the preferred MCP tools and strict fallback marker format | Treat Skill compliance as proof or workflow authority |
| Agent session execution UX | Mission-owned Agent session snapshots/events plus Airport Agent session panel projection | Preserve PTY terminal UX for interactive sessions; expose a generic prompt/command composer only for sessions with structured follow-up input | Provider-specific UI paths, replacing the PTY terminal, stealing terminal focus, or treating structured prompts as terminal input |
| Presentation | Airport terminal surfaces | Preserve existing attach/input/resize/reconnect/screen/log behavior; add only generic interaction-mode projection if needed | Provider-specific UI paths, new terminal ownership, or attach model redesign |

### Required Failure Behavior

1. Missing provider registration is a hard runtime/configuration error.
2. Missing `buildInteractiveArgs()` for an interactive launch request must fail explicitly with a provider capability error; Mission must not pretend the provider is interactive.
3. Print-only capability may exist only on a non-interactive path. It must not attach to Airport's interactive terminal flow.
4. If Sandcastle public exports are insufficient, the only allowed fallback is a minimal Mission-owned compatibility type around the public provider runtime shape. That fallback must stay confined to the adapter folder and must be documented with an upstream follow-up issue or PR.
5. Unsupported parsing or session-usage extraction must surface as unavailable capability, not silent success.
6. Provider initialization failure must be distinguishable from process spawn failure. Unknown provider factory, missing model, unsupported option mapping, malformed provider env, empty command, unsupported mode, or unsupported resume/session-capture behavior must fail before PTY/process launch with an explicit provider-initialization error.
7. Missing MCP support must be represented as a capability limit and must fall back to provider parsing or Mission protocol markers; it must not make the provider appear broken if launch remains honest.
8. Malformed, spoofed, unscoped, duplicate, or oversized Mission protocol markers must be rejected or recorded as diagnostics only.
9. Raw terminal heuristics must never be the sole basis for task completion, verification, delivery, or gate passage.
10. Agent-declared completion or ready-for-verification must not be treated as deterministic verification success.
11. MCP server startup, registration, or health failure must be surfaced explicitly as degraded signaling or launch failure according to runner policy.
12. MCP tool handlers must never write Mission runtime data, workflow state, or repository files directly.
13. MCP access provisioning failure must be distinguishable from provider launch failure.
14. Per-session MCP credentials, tokens, endpoint secrets, and session ids must not be written into tracked repository files.
15. Interactive PTY regressions are release-blocking. Keyboard input, focus, resize, reconnect, terminal output, and log behavior for `pty-terminal` sessions must remain unchanged.
16. A prompt/command composer must never be shown as the primary input for a live `pty-terminal` session. If shown for diagnostics or structured replies, it must be clearly secondary and must not intercept terminal input.
17. Non-interactive sessions must not pretend to be terminals. They may expose structured prompt/command input only when Mission runtime can route that input through a supported Agent session continuation path.

## Signatures

### Mission-Owned Boundary

The implementation must introduce a Mission-owned boundary equivalent to:

```ts
type SandcastleRunnerId = 'claude-code' | 'pi' | 'codex' | 'opencode';

type AgentProviderCapabilities = {
  interactive: boolean;
  print: boolean;
  streamParsing: boolean;
  sessionCapture: boolean;
  sessionUsage: boolean;
};

type AgentSessionInteractionMode =
  | 'pty-terminal'
  | 'agent-message'
  | 'read-only';

type AgentSessionInteractionCapabilities = {
  mode: AgentSessionInteractionMode;
  canSendTerminalInput: boolean;
  canSendStructuredPrompt: boolean;
  canSendStructuredCommand: boolean;
  reason?: string;
};

type AgentProviderLaunchPlan = {
  mode: 'interactive' | 'print';
  command: string;
  args: string[];
  stdin?: string;
  env?: NodeJS.ProcessEnv;
};

type AgentProviderObservation =
  | { kind: 'message'; channel: 'agent' | 'system'; text: string }
  | { kind: 'signal'; signal: AgentSessionSignal }
  | { kind: 'usage'; payload: AgentMetadata }
  | { kind: 'none' };

interface AgentProviderAdapter {
  readonly runnerId: SandcastleRunnerId;
  readonly label: string;
  initialize(config: AgentLaunchConfig): AgentProviderInitialization;
  getCapabilities(): AgentProviderCapabilities;
  buildInteractiveLaunch(config: AgentLaunchConfig): AgentProviderLaunchPlan;
  buildPrintLaunch(config: AgentLaunchConfig): AgentProviderLaunchPlan;
  parseRuntimeOutput(line: string): AgentProviderObservation[];
  parseSessionUsage?(line: string): AgentProviderObservation | undefined;
}
```

The exact Sandcastle constructor and provider type imports must follow Sandcastle's public exports at implementation time, but Sandcastle types must not leak past this adapter boundary.

The implementation must introduce an initialization result equivalent to:

```ts
type AgentProviderInitialization = {
  runnerId: SandcastleRunnerId;
  providerName: string;
  model: string;
  capabilities: AgentProviderCapabilities;
  interactionCapabilities: AgentSessionInteractionCapabilities;
  providerEnv: Record<string, string>;
  captureSessions: boolean;
};
```

The concrete type may differ, but initialization semantics must preserve these rules:

1. Sandcastle does not currently expose a separate Agent-session initialization lifecycle hook. Mission initialization means resolving Mission settings, constructing the selected Sandcastle provider instance, reading provider facts, validating capabilities, and preparing a launch plan.
2. The adapter maps runner ids to the public Sandcastle factories `claudeCode`, `pi`, `codex`, and `opencode`; no hidden auto-discovery is allowed.
3. Provider factory inputs are resolved from Mission-owned configuration: model, provider-specific effort/reasoning option, permission-bypass policy, resume-session id where supported, capture-session preference where supported, and provider env.
4. The adapter reads provider `name`, `env`, `captureSessions`, `buildPrintCommand`, optional `buildInteractiveArgs`, `parseStreamLine`, and optional `parseSessionUsage` and converts them into Mission-owned capabilities.
5. `buildInteractiveLaunch(...)` calls Sandcastle `buildInteractiveArgs(...)`, validates a non-empty argv, treats the first element as the executable command and the remaining elements as args, merges env, and returns a PTY-safe Mission launch plan.
6. `buildPrintLaunch(...)` calls Sandcastle `buildPrintCommand(...)`, preserves returned `stdin`, marks the launch plan as print/non-interactive, and must not route that plan into Airport's interactive PTY attach path unless a future Mission runtime explicitly supports non-interactive process viewing.
7. Env merge order must be explicit and tested. The launch env must include Mission runtime env, Sandcastle provider `env`, and MCP provisioner `launchEnv` without committing per-session secrets.
8. Claude Code current upstream facts must be modeled truthfully: `captureSessions` defaults true, `parseSessionUsage` is optional and Claude-specific, stream JSON `system/init` can yield a provider session id, and `resumeSession` is exposed for print command construction but not for interactive args.
9. Pi, Codex, and OpenCode current upstream facts must be modeled truthfully: `captureSessions` defaults false for all three, and OpenCode currently has no useful structured stream parsing output.
10. Provider initialization and launch-plan validation must be covered by adapter tests before runtime integration tests rely on a launch plan.
11. Interaction capabilities must be derived from the selected launch mode and runtime support, not only from provider identity. Interactive PTY launch maps to `pty-terminal`; honest non-interactive follow-up support maps to `agent-message`; no supported input maps to `read-only`.

### Mission-Owned Signal Boundary

The implementation must introduce a Mission-owned signal boundary equivalent to:

```ts
type AgentSessionSignalSource =
  | 'daemon-authoritative'
  | 'mcp-validated'
  | 'provider-structured'
  | 'agent-declared'
  | 'terminal-heuristic';

type AgentSessionSignalConfidence =
  | 'authoritative'
  | 'high'
  | 'medium'
  | 'low'
  | 'diagnostic';

type AgentSessionSignal =
  | {
      type: 'progress';
      summary: string;
      detail?: string;
      source: AgentSessionSignalSource;
      confidence: AgentSessionSignalConfidence;
    }
  | {
      type: 'needs_input';
      question: string;
      choices: Array<
        | { kind: 'fixed'; label: string; value: string }
        | { kind: 'manual'; label: string; placeholder?: string }
      >;
      source: AgentSessionSignalSource;
      confidence: AgentSessionSignalConfidence;
    }
  | {
      type: 'blocked';
      reason: string;
      source: AgentSessionSignalSource;
      confidence: AgentSessionSignalConfidence;
    }
  | {
      type: 'ready_for_verification';
      summary: string;
      source: AgentSessionSignalSource;
      confidence: AgentSessionSignalConfidence;
    }
  | {
      type: 'completed_claim';
      summary: string;
      source: AgentSessionSignalSource;
      confidence: AgentSessionSignalConfidence;
    }
  | {
      type: 'failed_claim';
      reason: string;
      source: AgentSessionSignalSource;
      confidence: AgentSessionSignalConfidence;
    }
  | {
      type: 'message';
      channel: 'agent' | 'system' | 'stdout' | 'stderr';
      text: string;
      source: AgentSessionSignalSource;
      confidence: AgentSessionSignalConfidence;
    }
  | {
      type: 'usage';
      payload: AgentMetadata;
      source: AgentSessionSignalSource;
      confidence: AgentSessionSignalConfidence;
    };

type AgentSessionSignalDecision =
  | { action: 'reject'; reason: string }
  | { action: 'record-observation-only'; reason: string }
  | { action: 'emit-message'; event: AgentSessionEvent }
  | {
      action: 'update-session';
      eventType: 'session.updated' | 'session.awaiting-input' | 'session.completed' | 'session.failed';
      snapshotPatch: Partial<AgentSessionSnapshot>;
    };
```

The concrete TypeScript may differ, but it must preserve the same semantics: signal source/confidence is explicit, observations are not state transitions, and a policy object decides promotion.

### Mission MCP Server Boundary

The implementation must introduce a local Mission MCP server boundary equivalent to:

```ts
type MissionMcpSignalToolName =
  | 'mission_report_progress'
  | 'mission_request_operator_input'
  | 'mission_report_blocked'
  | 'mission_report_ready_for_verification'
  | 'mission_report_completion_claim'
  | 'mission_report_failure_claim'
  | 'mission_append_session_note'
  | 'mission_report_usage';

type MissionMcpSignalEnvelope = {
  missionId: string;
  taskId: string;
  agentSessionId: string;
  eventId: string;
};

type MissionMcpSignalAcknowledgement = {
  accepted: boolean;
  outcome: 'promoted' | 'recorded' | 'rejected';
  reason?: string;
  sessionStatus?: AgentSessionSnapshot['status'];
  waitingForInput?: boolean;
};

interface AgentSessionSignalPort {
  reportSignal(input: {
    envelope: MissionMcpSignalEnvelope;
    signal: AgentSessionSignal;
  }): Promise<MissionMcpSignalAcknowledgement>;
}

interface MissionMcpSignalServer {
  start(): Promise<MissionMcpSignalServerHandle>;
  registerSession(input: {
    missionId: string;
    taskId: string;
    agentSessionId: string;
    allowedTools: MissionMcpSignalToolName[];
  }): Promise<MissionMcpSessionRegistration>;
  unregisterSession(agentSessionId: string): Promise<void>;
  stop(): Promise<void>;
}
```

The concrete server implementation may be in-process or a daemon-managed sidecar, but the contract must preserve these semantics:

1. The daemon owns server lifecycle, session registration, endpoint discovery, health checks, and cleanup.
2. The server is local-only: stdio, local pipe/socket, or loopback with session-scoped credentials. Remote hosted MCP is forbidden for Mission state signaling.
3. Every tool payload includes `missionId`, `taskId`, `agentSessionId`, `eventId`, and a strict tool-specific body.
4. Tool payloads are strict-schema validated, bounded in size, session-scoped, and idempotent by `eventId`.
5. Unknown sessions, mismatched mission/task ids, completed sessions, duplicate event ids, invalid payloads, oversized payloads, and disallowed tools are rejected.
6. Valid tool calls become `mcp-validated` `AgentSessionSignal`s and go through `AgentSessionSignalPolicy`.
7. The acknowledgement returned to the agent reports accepted/rejected/recorded/promoted outcome and does not imply deterministic task verification.

### AgentSession MCP Access Provisioning Boundary

The implementation must introduce automatic AgentSession MCP access provisioning equivalent to:

```ts
type AgentSessionMcpAccessState =
  | 'mcp-validated'
  | 'mcp-degraded'
  | 'mcp-unavailable';

type AgentSessionMcpProvisioningPolicy =
  | 'required'
  | 'optional'
  | 'disabled';

type AgentSessionMcpRegistration = {
  missionId: string;
  taskId: string;
  agentSessionId: string;
  allowedTools: MissionMcpSignalToolName[];
  bridgeCommand: string;
  bridgeArgs: string[];
  env: Record<string, string>;
  accessState: AgentSessionMcpAccessState;
};

interface AgentSessionMcpConfigMaterializer {
  readonly runnerId: AgentRunnerId;
  detectSupport(): Promise<{ supported: boolean; reason?: string }>;
  materialize(input: AgentSessionMcpRegistration): Promise<{
    accessState: AgentSessionMcpAccessState;
    launchEnv: Record<string, string>;
    generatedFiles: string[];
    cleanup(): Promise<void>;
  }>;
}

interface AgentSessionMcpAccessProvisioner {
  provision(input: {
    runnerId: AgentRunnerId;
    policy: AgentSessionMcpProvisioningPolicy;
    missionId: string;
    taskId: string;
    agentSessionId: string;
    allowedTools: MissionMcpSignalToolName[];
  }): Promise<AgentSessionMcpProvisioningResult>;
}
```

The concrete types may differ, but the implementation must preserve these semantics:

1. There is no universal MCP config file consumed by all runners. The provisioner delegates to runner-specific materializers.
2. Claude Code materialization targets project-scoped `.mcp.json` / `mcpServers` or an equivalent Claude-supported local configuration.
3. Codex materialization targets project-scoped `.codex/config.toml` / `[mcp_servers.<name>]` or an equivalent Codex-supported configuration.
4. OpenCode materialization is version-aware and targets the active OpenCode convention, such as current `opencode.json` / `opencode.jsonc` `mcp` config or older `.opencode.json` / `mcpServers` where required.
5. Pi defaults to `mcp-unavailable` until implementation proves and tests a supported Pi MCP configuration mechanism.
6. The preferred portable server entrypoint is a Mission-owned stdio bridge command, for example `mission mcp agent-bridge`, with per-session identity supplied through launch environment variables.
7. Static tracked config may contain stable command names and environment-variable references only. It must not contain live session credentials.
8. Generated untracked/temporary config must be cleaned up on session end where possible.
9. If policy is `required`, provisioning failure fails launch explicitly. If policy is `optional`, launch continues only with `mcp-degraded` or `mcp-unavailable` reflected in session capabilities/metadata.

### Boundary Semantics

1. `AgentLaunchConfig`, `AgentPrompt`, and `AgentMetadata` remain Mission-owned input contracts. Provider-specific knobs must be mapped from existing metadata/settings through adapter-local translation rather than by widening core runtime schemas with Sandcastle-specific fields.
2. `buildInteractiveLaunch(...)` returns the executable command, args, mode, and env for Mission's existing PTY path. Mission still chooses the worktree, opens the PTY, owns the terminal session name, and handles prompt submission.
3. `buildPrintLaunch(...)` is allowed only for honest non-interactive behavior. It must preserve Sandcastle-provided `stdin`, must not bypass Mission lifecycle ownership, and must not reuse Airport's interactive terminal path.
4. `parseRuntimeOutput(...)` and `parseSessionUsage(...)` return Mission-owned observations only. Promotion into `session.message`, audit logs, or state transactions is decided by Mission runtime code.
5. `captureSessions` from Sandcastle is capability metadata only. It does not transfer session ownership away from Mission.
6. Claude-specific resume behavior must remain truthful: print-mode resume may be used only where exported by Sandcastle; interactive resume must not be claimed unless Sandcastle actually exports it for interactive launch building.
7. Interactive mode is terminal-duplex but not structured-duplex. The adapter may send terminal input and receive terminal output through Mission's PTY; it must not claim Sandcastle gives provider-native workflow callbacks.
8. SDK / print mode is structured-output but not live-duplex. The adapter may send one prompt/stdin payload and parse output; it must not claim live mid-run operator input unless a future provider exposes a real protocol.
9. Local MCP signal tools are a structured side channel into Mission policy, not a replacement for `AgentSession` ownership.
10. Mission protocol markers emitted in stdout are lower-confidence agent declarations. They must be schema-validated, session-scoped, idempotent, and policy-gated.
11. Terminal heuristics are diagnostics. They may surface possible waiting states to operators but must not pass workflow gates or prove completion.
12. Agent launch for MCP-capable runners must include the local MCP server configuration and session registration data needed by the runtime to call Mission tools.
13. If a runner is configured to require MCP for high-confidence two-way binding and the MCP server is unavailable, launch must fail explicitly; if MCP is optional for that runner, launch may continue with degraded signaling clearly represented in capabilities.
14. Agent launch must include provisioned MCP access only through runner-supported config and per-session launch environment, never through committed session secrets.

### Execution UX Boundary

The implementation must preserve the current Agent session terminal UX and add only a generic interaction-mode projection:

1. `pty-terminal` sessions use the existing Airport terminal pane as the primary and expected operator interface. Existing attach, live input, output rendering, resize, reconnect, focus, keyboard shortcut, copy/paste, scrollback/screen-state, and log behavior must not regress.
2. Airport must not replace a `pty-terminal` session with a chat panel, transcript-only view, provider-specific console, or prompt composer as the primary input.
3. `agent-message` sessions do not have live terminal input. If Mission runtime supports follow-up prompts or commands for the selected session, Airport may render a generic prompt/command composer below the Agent session panel or equivalent session detail surface.
4. The composer submits Mission-owned `AgentPrompt` / `AgentCommand` messages through daemon/runtime routes. It must not write to a provider process directly, open a PTY, mutate workflow state, or pretend the submitted text was terminal input.
5. `read-only` sessions show transcript/status and an explicit reason input is unavailable. The composer must be absent or disabled with a clear reason.
6. When policy promotes a needs-input signal, the UI routes the operator response through the session's interaction mode: terminal input for `pty-terminal`, structured prompt/command submission for `agent-message`, or explanatory read-only state for `read-only`.
7. The UI must display relevant session capability state near the input affordance: interaction mode, awaiting-input state, MCP access state, degraded signaling state, and whether a submission resumes/continues the provider session or starts a follow-up iteration.
8. Prompt/command submissions are first-class Mission-to-agent messages. They must be correlated with mission/task/session ids, recorded in session events/snapshots/logs according to existing runtime conventions, and distinguishable from raw terminal input.
9. This UX must remain provider-neutral. Airport may branch on Mission interaction capabilities, not on Sandcastle provider names.

## File Matrix

### Required Files

| Path | Change type | Reason |
| --- | --- | --- |
| `packages/core/package.json` | update | Add `@ai-hero/sandcastle` in the package that owns agent runtime orchestration. |
| `pnpm-lock.yaml` | update | Lock the new dependency. |
| `packages/core/src/daemon/runtime/agent/AgentRunner.ts` | update | Provide a Mission-owned way for runner implementations to supply per-launch command/args/env while preserving the existing PTY/session flow. |
| `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeFactory.ts` | update | Keep explicit registry ownership and register the four Sandcastle-backed runners. |
| `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeIds.ts` | update | Add canonical runner ids and supported-runner guard coverage. |
| `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeIds.test.ts` | update | Prove supported-runner ids and defaults stay correct. |
| `packages/core/src/entities/Mission/MissionSchema.ts` | update | Extend legal persisted runner ids. |
| `packages/core/src/workflow/WorkflowSchema.ts` | update | Extend legal workflow runtime settings runner ids. |
| `packages/core/src/entities/AgentSession/**` or existing Agent session snapshot/event files | update | Publish provider-neutral interaction mode/capability state and preserve the distinction between terminal input and structured AgentPrompt/AgentCommand submissions. |
| `packages/core/src/daemon/runtime/agent/providers/SandcastleAgentProviderAdapter.ts` | create | Define the Mission-owned adapter contract, provider initialization result, launch-plan validation, and Sandcastle wrapping logic. |
| `packages/core/src/daemon/runtime/agent/providers/SandcastleAgentProviderAdapter.test.ts` | create | Cover provider registration facts, initialization, capability reporting, command building, stdin preservation, env mapping/precedence, launch-plan validation, and parsing behavior. |
| `packages/core/src/daemon/runtime/agent/signals/AgentSessionSignal.ts` | create | Define canonical signal, source, confidence, observation, and decision types. |
| `packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPolicy.ts` | create | Own promotion rules from signal claims into session messages, snapshots, and events. |
| `packages/core/src/daemon/runtime/agent/signals/AgentSessionObservationRouter.ts` | create | Route MCP calls, provider parser output, protocol markers, and heuristics into signal policy. |
| `packages/core/src/daemon/runtime/agent/signals/MissionProtocolMarkerParser.ts` | create | Parse strict fallback stdout markers without trusting raw prose. |
| `packages/core/src/daemon/runtime/agent/signals/ProviderOutputSignalParser.ts` | create | Convert Sandcastle parsed events and provider observations into Mission signals. |
| `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.ts` | create | Own local MCP server lifecycle, tool registration, session registration, and local endpoint/stdio configuration. |
| `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalTools.ts` | create | Define MCP tool names, schemas, payload validation, size limits, and acknowledgement shapes. |
| `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSessionRegistry.ts` | create | Track registered Agent sessions, allowed tools, session credentials if needed, and event-id idempotency. |
| `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.test.ts` | create | Cover startup/shutdown, registration, local-only configuration, tool validation, authorization, idempotency, and acknowledgement behavior. |
| `packages/core/src/daemon/runtime/agent/mcp/AgentSessionMcpAccessProvisioner.ts` | create | Register sessions with the MCP server, select runner materializers, produce launch env/config, and publish access state. |
| `packages/core/src/daemon/runtime/agent/mcp/MissionMcpAgentBridge.ts` | create | Provide the local stdio bridge entrypoint that an agent MCP client can launch to reach the daemon-owned signal server. |
| `packages/core/src/daemon/runtime/agent/mcp/materializers/ClaudeCodeMcpConfigMaterializer.ts` | create | Materialize Claude Code-compatible project/local MCP config using `.mcp.json` / `mcpServers` semantics or equivalent supported config. |
| `packages/core/src/daemon/runtime/agent/mcp/materializers/CodexMcpConfigMaterializer.ts` | create | Materialize Codex-compatible project MCP config using `.codex/config.toml` / `[mcp_servers.<name>]` semantics or equivalent supported config. |
| `packages/core/src/daemon/runtime/agent/mcp/materializers/OpenCodeMcpConfigMaterializer.ts` | create | Materialize active OpenCode-compatible MCP config, accounting for current `mcp` config and older `mcpServers` shape where required. |
| `packages/core/src/daemon/runtime/agent/mcp/materializers/PiMcpConfigMaterializer.ts` | create | Report Pi MCP as unavailable/degraded until a supported Pi MCP mechanism is proven; do not fake support. |
| `packages/core/src/daemon/runtime/agent/mcp/AgentSessionMcpAccessProvisioner.test.ts` | create | Cover runner-specific materialization, secret-safe config, launch env injection, required/optional policy, access state, and cleanup. |
| `packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPort.ts` | create | Define the narrow daemon port used by MCP and other adapters to report signals without owning workflow state. |
| `packages/core/src/daemon/runtime/agent/signals/*.test.ts` | create | Cover signal source/confidence, policy promotion, rejection, idempotency, marker validation, and no direct workflow mutation from raw output. |
| `packages/core/src/daemon/runtime/agent/runtimes/SandcastleAgentRunner.ts` | create | Compose adapter launch plans with Mission's existing PTY-backed `AgentRunner` flow. |
| `packages/core/src/daemon/runtime/agent/runtimes/SandcastleAgentRunner.test.ts` | create | Cover transport invocation, explicit unsupported-capability failures, and observation handling boundaries. |
| `apps/airport/**/AgentSessionPanel*` or equivalent Agent session panel files | update | Preserve PTY terminal behavior for interactive sessions and add a provider-neutral prompt/command composer only for `agent-message` sessions. |
| `apps/airport/**` route/remote/gateway files for Agent session prompt submission | update | Wire structured prompt/command submissions through existing Mission/Airport gateway patterns without provider-specific UI logic. |
| `specifications/mission/execution/agent-runtime.md` | update | Document the Sandcastle dependency boundary and preserved Mission/Airport ownership. |
| `.agents/skills/mission-agent-runtime-protocol/SKILL.md` | create | Teach agents to use Mission MCP signal tools where available and strict fallback markers where unavailable. |

### Required Cleanup

| Path | Rule |
| --- | --- |
| `packages/core/src/daemon/runtime/agent/runtimes/PiAgentRunner.ts` | Delete or reduce to a thin compatibility-free redirect only if it is still the implementation file for the new Sandcastle-backed Pi path. A long-lived parallel Pi runner path is forbidden. |
| `packages/core/src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts` | Delete or rewrite to assert the Sandcastle-backed Pi behavior. Tests must not preserve the old direct-command Pi contract as active truth. |

### Allowed Support Files

| Path | Allowed scope |
| --- | --- |
| `packages/core/src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.ts` | Helper extraction only if required to keep shared PTY launch behavior centralized. No behavior change for Copilot CLI. |
| `packages/core/src/entities/Repository/RepositorySchema.ts` | Update only if type or validation fallout requires explicit runner-id coverage beyond the imported Mission schema. |
| `packages/core/src/daemon/runtime/agent/**/*.test.ts` | Add or adjust focused tests when coverage belongs beside the touched runtime code. |
| `.mcp.json`, `.codex/config.toml`, `opencode.json`, `.opencode.json`, or generated runner MCP configuration | Update/create only when required by a runner materializer. Tracked files may contain stable command/env references only, never live session secrets. |

### Forbidden Scope

| Path or area | Why forbidden |
| --- | --- |
| `apps/airport/**` outside the Agent session interaction-mode projection | Airport behavior must remain compatible without redesign or provider-specific UI changes. Only a generic prompt/command composer for non-interactive Agent sessions is allowed. |
| `packages/core/src/daemon/runtime/agent/TerminalAgentTransport.ts` | Terminal transport semantics are not being redesigned; only consume its existing contract. |
| `packages/core/src/entities/**` outside runner-id schema updates and provider-neutral Agent session interaction-mode projection | Mission entities should not absorb provider-specific behavior. Interaction capability state is allowed only when it remains provider-neutral and session-owned. |
| `docs/adr/**` | This mission adopts an existing boundary; it does not author a new ADR. |
| Any Sandcastle sandbox/worktree/orchestration integration files | Explicitly out of scope by PRD. |
| Workflow gate or verification code | Signal claims may trigger readiness, but deterministic verification/gates are not redefined in this mission. |
| Any parser that directly mutates workflow state | All promotion must go through `AgentSessionSignalPolicy`. |
| Remote MCP services or hosted endpoints | Mission state signaling must be local and daemon-owned. |
| `.agents/mcp.json` as a presumed universal agent config | No evidence all in-scope runners consume it; Mission may define internal settings elsewhere, but runtime access must be runner-specific. |
| Tracked files containing per-session MCP credentials | Session secrets must be ephemeral or environment-provided. |
| Replacing or wrapping the PTY terminal with a chat-first Agent UI | The current terminal is a protected UX; non-interactive prompt/command input is secondary and capability-gated. |

## Implementation Slices

### Slice 1: Dependency and runner-id boundary

- **Objective:** Add the Sandcastle dependency and extend the set of legal Mission runner ids without introducing provider behavior yet.
- **Files:** `packages/core/package.json`, `pnpm-lock.yaml`, `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeIds.ts`, `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeIds.test.ts`, `packages/core/src/entities/Mission/MissionSchema.ts`, `packages/core/src/workflow/WorkflowSchema.ts`
- **Checks:** `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`
- **Ignore:** none
- **Verification slice:** Confirm all new runner ids are legal in schemas and recognized by the supported-runner guard.

### Slice 2: Mission-owned Sandcastle provider initialization boundary

- **Objective:** Introduce the adapter contract that wraps Sandcastle's public provider shape and normalizes provider initialization, capabilities, launch plans, env, stdin, and observations.
- **Files:** `packages/core/src/daemon/runtime/agent/providers/SandcastleAgentProviderAdapter.ts`, `packages/core/src/daemon/runtime/agent/providers/SandcastleAgentProviderAdapter.test.ts`
- **Checks:** `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`
- **Ignore:** none
- **Verification slice:** Confirm the adapter maps exactly to `claudeCode`, `pi`, `codex`, and `opencode`; initializes providers with Mission-resolved model/options/env; reports upstream facts such as `name`, `env`, `captureSessions`, optional `parseSessionUsage`, and OpenCode's absent structured parse output; validates interactive argv and print command/stdin; verifies env precedence; and reports explicit provider-initialization or unsupported-capability errors without importing Sandcastle orchestration APIs.

### Slice 3: Agent session signal boundary and policy

- **Objective:** Add Mission-owned signal types, source/confidence tracking, observation routing, marker parsing, provider-output conversion, and promotion policy.
- **Files:** `packages/core/src/daemon/runtime/agent/signals/AgentSessionSignal.ts`, `packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPolicy.ts`, `packages/core/src/daemon/runtime/agent/signals/AgentSessionObservationRouter.ts`, `packages/core/src/daemon/runtime/agent/signals/MissionProtocolMarkerParser.ts`, `packages/core/src/daemon/runtime/agent/signals/ProviderOutputSignalParser.ts`, `packages/core/src/daemon/runtime/agent/signals/*.test.ts`
- **Checks:** `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`
- **Ignore:** none
- **Verification slice:** Confirm MCP-validated, provider-structured, agent-declared, and terminal-heuristic signals are distinguishable; policy can promote valid needs-input/progress messages; malformed or low-confidence output cannot mark tasks verified, delivered, or completed as workflow truth.

### Slice 4: Local MCP signal server

- **Objective:** Provide the preferred structured agent-to-Mission side channel without making MCP a workflow owner.
- **Files:** `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.ts`, `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalTools.ts`, `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSessionRegistry.ts`, `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.test.ts`, `packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPort.ts`, focused signal/MCP tests under `packages/core/src/daemon/runtime/agent/signals/`, and optionally repo-local MCP configuration if required for local server wiring.
- **Checks:** `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`
- **Ignore:** none
- **Verification slice:** Confirm MCP server lifecycle is daemon-owned; configuration is local-only; session registration scopes allowed tools; payloads are schema-validated, session-scoped, idempotent, and routed through signal policy; acknowledgements report promoted/recorded/rejected outcomes; MCP handlers cannot mutate workflow state directly.

### Slice 5: AgentSession MCP access provisioning

- **Objective:** Automatically make the local Mission MCP signal server available to MCP-capable Agent sessions through runner-specific configuration and secret-safe launch environment.
- **Files:** `packages/core/src/daemon/runtime/agent/mcp/AgentSessionMcpAccessProvisioner.ts`, `packages/core/src/daemon/runtime/agent/mcp/MissionMcpAgentBridge.ts`, `packages/core/src/daemon/runtime/agent/mcp/materializers/ClaudeCodeMcpConfigMaterializer.ts`, `packages/core/src/daemon/runtime/agent/mcp/materializers/CodexMcpConfigMaterializer.ts`, `packages/core/src/daemon/runtime/agent/mcp/materializers/OpenCodeMcpConfigMaterializer.ts`, `packages/core/src/daemon/runtime/agent/mcp/materializers/PiMcpConfigMaterializer.ts`, `packages/core/src/daemon/runtime/agent/mcp/AgentSessionMcpAccessProvisioner.test.ts`, and runner launch integration files as needed.
- **Checks:** `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`
- **Ignore:** none
- **Verification slice:** Confirm Claude/Codex/OpenCode materializers produce supported config shapes, Pi defaults to unavailable until proven, no per-session secret is written to tracked config, launch env includes session identity, required policy fails launch on provisioning failure, optional policy degrades capability, and cleanup runs for generated config.

### Slice 6: Agent Skill protocol and launch instructions

- **Objective:** Teach agents to use the local MCP server when available and strict lower-confidence marker fallback when unavailable.
- **Files:** `.agents/skills/mission-agent-runtime-protocol/SKILL.md`, `packages/core/src/daemon/runtime/agent/runtimes/SandcastleAgentRunner.ts` or launch-context files only as needed to pass MCP endpoint/session instructions to MCP-capable runtimes, focused tests for launch context if runtime code changes.
- **Checks:** `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`
- **Ignore:** none
- **Verification slice:** Confirm Skill instructions define MCP-first behavior, exact fallback marker format, and the rule that agent claims do not prove verification; confirm MCP-capable launch context consumes provisioner output while non-MCP launches are marked degraded rather than falsely high-confidence.

### Slice 7: PTY launch integration and Pi migration

- **Objective:** Route Sandcastle-backed providers through Mission's existing PTY transport and replace the old direct Pi runner path.
- **Files:** `packages/core/src/daemon/runtime/agent/AgentRunner.ts`, `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeFactory.ts`, `packages/core/src/daemon/runtime/agent/runtimes/SandcastleAgentRunner.ts`, `packages/core/src/daemon/runtime/agent/runtimes/SandcastleAgentRunner.test.ts`, `packages/core/src/daemon/runtime/agent/runtimes/PiAgentRunner.ts`, `packages/core/src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts`, and signal router integration files from Slice 3 only as needed.
- **Checks:** `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`, `pnpm --filter @flying-pillow/mission-core build`
- **Ignore:** none
- **Verification slice:** Confirm interactive-capable providers launch via Mission PTY transport, print-only behavior stays off the interactive path, missing interactive capability fails explicitly, and terminal/provider observations flow through the signal router/policy instead of directly mutating workflow state.

### Slice 8: Agent session execution UX

- **Objective:** Preserve the existing PTY terminal experience and add a generic non-interactive prompt/command input path only where Mission session capabilities allow it.
- **Files:** provider-neutral Agent session snapshot/event/capability files under `packages/core/src/entities/AgentSession/**` or their existing equivalents, `packages/core/src/daemon/runtime/agent/AgentRunner.ts` only as needed to publish interaction capabilities and accept structured AgentPrompt/AgentCommand submissions, `apps/airport/**/AgentSessionPanel*` or equivalent Agent session panel files, and existing Airport route/remote/gateway files only as needed to submit structured prompts through Mission runtime APIs.
- **Checks:** `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`, `pnpm run test:web`
- **Ignore:** none
- **Verification slice:** Confirm `pty-terminal` sessions preserve terminal input/output/focus/resize/reconnect behavior and do not show a chat-style composer as primary input; `agent-message` sessions show a prompt/command composer that submits Mission-owned messages through the daemon gateway; `read-only` sessions disable or hide input with a clear reason; needs-input signals route operator responses through the correct interaction mode; no Airport code branches on Sandcastle provider names.

### Slice 9: Documentation and final cleanup

- **Objective:** Publish the preserved ownership model and remove any obsolete direct-provider runner truth left behind by the migration.
- **Files:** `specifications/mission/execution/agent-runtime.md` plus any cleanup files from Slice 3 that remain obsolete
- **Checks:** `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`, `pnpm --filter @flying-pillow/mission-core build`
- **Ignore:** none
- **Verification slice:** Confirm documentation states Sandcastle is a provider-adapter dependency, Mission still owns lifecycle/logs/PTY transport, interactive mode is terminal-duplex but not structured-duplex, SDK/print mode is structured-output but not live-duplex, the local MCP server is the preferred optional signal side channel with daemon-owned lifecycle/session registration/acknowledgement semantics, AgentSession MCP access provisioning is automatic and runner-specific, the PTY terminal remains the primary UX for interactive sessions, non-interactive prompt/command input is capability-gated and provider-neutral, Skills/markers are fallback claims, and no legacy Pi-only path remains active.

## Task Authoring Rules

1. Every implementation task must name one slice, list only that slice's allowed files, restate forbidden files from this spec, and declare the exact validation gate from this spec.
2. Every verification task must name its paired implementation task, check only the behaviors promised by that slice, and call out the exact failure signals: provider initialization not validated, unsupported capability not surfaced, PTY launch bypassed, terminal UX regression, non-interactive composer shown as primary input for a live PTY session, structured prompt bypassing Mission runtime APIs, schema ids missing, direct Sandcastle orchestration import, stale Pi path still active, raw output directly mutating workflow state, malformed signal accepted, or agent claim treated as deterministic verification.
3. Verification tasks must record **Ignored baseline failures: none** unless a later implementation run proves an unrelated repository failure. Newly discovered unrelated failures must be documented explicitly and must not be retroactively assumed here.
4. Compatibility policy is strict: preserve current Airport terminal behavior and Mission runtime ownership, but do **not** preserve legacy direct Pi command-building paths once the Sandcastle-backed path lands.
5. Fallback policy is strict: no sandbox fallback, no hidden manual provider command builders, no automatic provider discovery, and no broadened core runtime schema for provider-specific metadata. The only allowed fallback is a minimal adapter-local compatibility type for missing Sandcastle public exports, paired with documented upstream follow-up.
6. Signal policy is strict: MCP, provider parsing, protocol markers, and heuristics are signal sources only. They must not own workflow law or bypass `AgentSessionSignalPolicy`.
7. Skill policy is strict: Skills instruct agent behavior and fallback marker syntax, but Skill compliance is not proof of correctness or completion.
8. MCP policy is strict: the local MCP signal server may provide high-confidence structured claims only after local-only transport, session registration, session scoping, schema validation, idempotency checks, and signal policy evaluation. It must not own Mission state or gate decisions.
9. MCP access policy is strict: each Agent session must receive MCP access through a runner-specific materializer and secret-safe launch environment. Do not invent a universal config file, and do not write per-session secrets to tracked files.
10. Execution UX policy is strict: preserve the current PTY terminal as the primary interaction surface for `pty-terminal` sessions. A prompt/command composer is allowed only for provider-neutral `agent-message` sessions or explicitly secondary structured replies.
11. Cleanup policy is required: remove obsolete runner code/tests in the same implementation slice that supersedes them. Do not leave dual active paths.
12. Verification evidence belongs only in verification-task artifacts under a task-specific heading. `SPEC.md` must remain normative design input and must not accumulate execution evidence.
