---
title: "VERIFY: #31 - Adopt Sandcastle `AgentProviderAdapter` for four agent coders without sandboxing"
artifact: "verify"
createdAt: "2026-05-04T07:01:50.223Z"
updatedAt: "2026-05-05T08:43:50Z"
stage: "implementation"
---

Branch: mission/31-adopt-sandcastle-agentprovideradapter-for-four-a

## Unit Test Evidence

- TODO: Aggregate the focused verification logs for completed implementation tasks.

## Task Verification Ledger

- TODO: For each verification task, record task id, checks, result, fixes, and ignored unrelated failures.

### `verification/01-dependency-and-runner-id-boundary-verify`

- **Paired task:** `implementation/01-dependency-and-runner-id-boundary`
- **Result:** **Passed with deferred validation**
- **Checks:**
  - Confirmed `@ai-hero/sandcastle` appears in exactly one workspace manifest, `packages/core/package.json`, and `pnpm-lock.yaml` records it only under the `packages/core` importer.
  - Confirmed the canonical Mission runner-id enum in `packages/core/src/entities/Mission/MissionSchema.ts` includes `copilot-cli`, `claude-code`, `pi`, `codex`, and `opencode`.
  - Confirmed workflow task and runtime schemas in `packages/core/src/workflow/WorkflowSchema.ts` both reuse `MissionAgentRunnerSchema`, so all four added runner ids are legal in workflow definitions.
  - Confirmed `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeIds.ts` re-exports `MISSION_AGENT_RUNNER_IDS` as `SUPPORTED_AGENT_RUNNER_IDS`, and `isSupportedAgentRunner()` checks that shared list rather than a divergent allowlist.
  - Confirmed `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeIds.test.ts` explicitly covers all five supported runner ids in the guard and schema assertions.
  - Confirmed no direct `@ai-hero/sandcastle`, `Sandcastle`, or `AgentProviderAdapter` usage exists under `packages/core/src`, so this slice has not introduced provider initialization or orchestration behavior ahead of the adapter boundary.
  - Ran `pnpm --filter @flying-pillow/mission-core check` and `pnpm --filter @flying-pillow/mission-core test`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - `pnpm --filter @flying-pillow/mission-core test` remains **to be checked** and is not treated as a blocker for this verification entry.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** Filtered core test results deferred for follow-up.

#### Reverification at `2026-05-04T10:47:03Z`

- **Result:** **Passed with deferred validation**
- **Checks:**
  - Confirmed `@ai-hero/sandcastle` appears only in `packages/core/package.json`, and `pnpm-lock.yaml` records it only under the `packages/core` importer.
  - Confirmed `packages/core/src/entities/Mission/MissionSchema.ts` defines the legal Mission runner ids as `copilot-cli`, `claude-code`, `pi`, `codex`, and `opencode`.
  - Confirmed `packages/core/src/workflow/WorkflowSchema.ts` reuses `MissionAgentRunnerSchema` for both generated workflow tasks and workflow runtime settings, so all four added ids are legal in workflow definitions.
  - Confirmed `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeIds.ts` derives `SUPPORTED_AGENT_RUNNER_IDS` from `MISSION_AGENT_RUNNER_IDS`, and `isSupportedAgentRunner()` recognizes all supported ids through that shared list.
  - Confirmed `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeIds.test.ts` exercises all supported runner ids against the guard plus Mission and workflow schema parsing.
  - Confirmed no `@ai-hero/sandcastle`, `Sandcastle`, or `AgentProviderAdapter` references exist under `packages/core/src`, so this slice still does not introduce provider initialization or direct Sandcastle orchestration before the adapter boundary.
  - Ran `pnpm --filter @flying-pillow/mission-core check` and `pnpm --filter @flying-pillow/mission-core test`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - `pnpm --filter @flying-pillow/mission-core test` is **to be checked** in follow-up and is not treated as a blocker for this entry.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** Filtered core test results deferred for follow-up.

### `verification/02-mission-owned-sandcastle-provider-initialization-boundary-verify`

- **Paired task:** `implementation/02-mission-owned-sandcastle-provider-initialization-boundary`
- **Result:** **Focused adapter checks passed; package validation gate blocked by failures outside this task change**
- **Checks:**
  - Confirmed `packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.ts` defines the Mission-owned runner-id contract as exactly `claude-code`, `pi`, `codex`, and `opencode`, and its default provider factory map binds only those runner ids to Sandcastle's public `claudeCode`, `pi`, `codex`, and `opencode` factories.
  - Confirmed `initialize(...)` resolves Mission-owned settings first, validates non-empty model/launch mode/provider env, constructs the selected provider with Mission-resolved model plus provider env, and reports capabilities from upstream facts without inventing support: interactive capability follows `buildInteractiveArgs`, print is always available, `opencode` reports `streamParsing: false`, session capture follows `provider.captureSessions`, and session usage is exposed only when `parseSessionUsage` exists.
  - Confirmed provider-specific option mapping stays inside the adapter boundary: Claude Code alone accepts `reasoningEffort`, `dangerouslySkipPermissions`, `resumeSession` for print mode, and optional `captureSessions`; Codex accepts its own reasoning effort values; Pi and OpenCode reject unsupported options through `ProviderInitializationError`.
  - Confirmed launch-plan validation is explicit before runtime spawn: `buildInteractiveLaunch(...)` rejects interactive resume, rejects providers without `buildInteractiveArgs`, validates non-empty argv and executable command, and returns command/args separately; `buildPrintLaunch(...)` rejects empty commands and preserves provider-returned `stdin`.
  - Confirmed env precedence is explicit and preserved as `runtimeEnv -> provider.env -> launchEnv`, so per-session launch env wins over provider defaults and runtime env.
  - Confirmed structured observation handling remains Mission-owned: parsed provider events are normalized into Mission message/signal/usage observations, and unsupported parsing yields `{ kind: 'none' }` instead of a false positive capability claim.
  - Confirmed Sandcastle remains confined to the provider adapter boundary in tracked source: the only `@ai-hero/sandcastle` source import is `packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.ts`; no direct sandbox/worktree/orchestration import was introduced elsewhere under `packages/core/src`.
  - Ran `pnpm --filter @flying-pillow/mission-core check`, `pnpm exec vp test run --config vitest.config.ts src/daemon/runtime/agent/providers/AgentProviderAdapter.test.ts`, and `pnpm --filter @flying-pillow/mission-core test`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - Focused adapter coverage passes in `src/daemon/runtime/agent/providers/AgentProviderAdapter.test.ts` with 10/10 tests passing, including exact mappings for `claude-code`, `pi`, `codex`, and `opencode`; env precedence; stdin preservation; capability honesty; and explicit provider-initialization / unsupported-capability failures.
  - `pnpm --filter @flying-pillow/mission-core test` does **not** satisfy this task's validation gate in the current workspace: beyond the two approved baseline failures in `src/lib/config.test.ts` and `src/daemon/runtime/agent/TerminalAgentTransport.test.ts`, the run also fails in `src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts`, `src/system/SystemStatus.test.ts`, `src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.test.ts`, and `src/entities/Repository/Repository.test.ts`.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** `src/lib/config.test.ts` (`scaffolds a default config in XDG config home`) and `src/daemon/runtime/agent/TerminalAgentTransport.test.ts` (`resolves the Copilot CLI from the VS Code global storage fallback when PATH is missing it`) per task instructions.

#### Reverification at `2026-05-04T11:39:07Z`

- **Result:** **Done — validation failed**
- **Checks:**
  - Confirmed the current adapter implementation in `packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.ts` still keeps Sandcastle confined to the provider boundary and imports only the public provider factories `claudeCode`, `pi`, `codex`, and `opencode` from `@ai-hero/sandcastle`.
  - Confirmed the adapter contract still maps exactly to the four required runner ids, resolves Mission-owned model/settings/env before provider construction, validates launch mode and provider options before process launch, preserves `runtimeEnv -> provider.env -> launchEnv` precedence, preserves provider-returned `stdin` for print launches, and reports capabilities from upstream facts rather than inferred support.
  - Confirmed launch-plan validation remains explicit: interactive launch rejects unsupported resume behavior, missing `buildInteractiveArgs`, empty argv, and invalid commands; print launch rejects empty commands.
  - Confirmed runtime observation parsing remains Mission-owned and normalizes provider output into Mission message/signal/usage observations, with `{ kind: 'none' }` returned when parsing yields no structured events.
  - Confirmed no direct `@ai-hero/sandcastle/*` subpath import or sandbox/worktree/orchestration import exists under `packages/core/src`.
  - Ran `pnpm --filter @flying-pillow/mission-core check`, `pnpm exec vitest run packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.test.ts`, and `pnpm --filter @flying-pillow/mission-core test`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` fails with `TS2307` because `packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.test.ts` imports `./AgentProviderAdapter.js`, but the implementation file present in the workspace is `AgentProviderAdapter.ts`.
  - The focused adapter test run fails before executing any tests for the same missing-module import, so the adapter behavior is not currently validated by executable test evidence in this workspace.
  - `pnpm --filter @flying-pillow/mission-core test` does not satisfy the validation gate: the run reports `7 failed | 29 passed` test files and `15 failed | 204 passed` tests, including the two approved baseline failures in `src/lib/config.test.ts` and `src/daemon/runtime/agent/TerminalAgentTransport.test.ts` plus the task-scoped `src/daemon/runtime/agent/providers/AgentProviderAdapter.test.ts` import failure.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** `src/lib/config.test.ts` (`scaffolds a default config in XDG config home`) and `src/daemon/runtime/agent/TerminalAgentTransport.test.ts` (`resolves the Copilot CLI from the VS Code global storage fallback when PATH is missing it`) per task instructions.

#### Reverification at `2026-05-04T11:58:59Z`

- **Result:** **Focused adapter checks passed; package validation gate blocked by failures outside this task change**
- **Checks:**
  - Confirmed `packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.ts` defines the Mission-owned runner-id boundary as exactly `claude-code`, `pi`, `codex`, and `opencode`, and the default factory map binds only those ids to Sandcastle's public `claudeCode`, `pi`, `codex`, and `opencode` exports.
  - Confirmed `initialize(...)` resolves Mission-owned settings before provider construction, validates non-empty model, launch mode, provider env, provider-specific option legality, and provider availability, then reports capabilities from upstream provider facts instead of inventing support.
  - Confirmed launch-plan validation stays inside the adapter boundary: interactive launch rejects resume, missing `buildInteractiveArgs`, empty argv, and invalid commands; print launch rejects empty commands and preserves provider-returned `stdin`; launch env precedence remains `runtimeEnv -> provider.env -> launchEnv`.
  - Confirmed runtime observations remain Mission-owned: structured provider output is normalized into Mission message/signal/usage observations, and unstructured output yields `{ kind: 'none' }`.
  - Confirmed Sandcastle remains confined to the adapter boundary in source: the only `@ai-hero/sandcastle` import under `packages/core/src` is `packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.ts`, and no direct Sandcastle sandbox/worktree/orchestration import exists under `packages/core/src`.
  - Ran `pnpm --filter @flying-pillow/mission-core check`, `pnpm exec vitest run packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.test.ts`, and `pnpm --filter @flying-pillow/mission-core test`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - `pnpm exec vitest run packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.test.ts` passes with 10/10 tests, covering exact runner mapping, Mission-resolved model/options/env initialization, env precedence, stdin preservation, structured observation handling, and explicit provider-initialization / unsupported-capability failures.
  - `pnpm --filter @flying-pillow/mission-core test` still fails with `6 failed | 30 passed` test files and `15 failed | 214 passed` tests, but the remaining red suites are outside this task change rather than regressions in the `AgentProviderAdapter` verification slice.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** `src/lib/config.test.ts` (`scaffolds a default config in XDG config home`) and `src/daemon/runtime/agent/TerminalAgentTransport.test.ts` (`resolves the Copilot CLI from the VS Code global storage fallback when PATH is missing it`) per task instructions.
- **Outside this task change:** `src/system/SystemStatus.test.ts`, `src/entities/Repository/Repository.test.ts`, `src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.test.ts`, and `src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts` still fail in the workspace-wide core test run, but they are outside the provider-initialization boundary verified by this task.

## Boundary Evidence

- TODO: Record ownership, public interface, data contract, integration, or dependency-direction checks.

### `verification/03-agent-session-signal-boundary-and-policy-verify`

- **Paired task:** `implementation/03-agent-session-signal-boundary-and-policy`
- **Result:** **Failed**
- **Checks:**
  - Confirmed the Mission-owned signal boundary distinguishes the required sources explicitly in `packages/core/src/daemon/runtime/agent/signals/AgentSessionSignal.ts`: `mcp-validated`, `provider-structured`, `agent-declared`, and `terminal-heuristic`, each with explicit confidence levels and decision outcomes.
  - Confirmed `MissionProtocolMarkerParser` accepts only strict `MISSION_SIGNAL::` markers, schema-validates the claimed Mission scope plus supported signal shapes, and downgrades malformed or oversized markers to `diagnostic` observations instead of promotable workflow truth.
  - Confirmed `ProviderOutputSignalParser` preserves provider-structured messages and usage as high-confidence observations, but converts provider session and tool-call output into diagnostics only, so provider parsing does not directly claim progress, verification, completion, or failure authority.
  - Confirmed `AgentSessionObservationRouter` keeps origins distinguishable at routing time, trusts strict markers only from stdout, routes MCP signals through the MCP boundary, and reduces terminal heuristics to diagnostic observations instead of promotable state.
  - Confirmed `AgentSessionSignalPolicy` is the only component in this slice that can return `update-session`, `emit-message`, `record-observation-only`, or `reject`, and its validation rejects scope mismatches, duplicate observations, source/origin mismatches, unsupported type/origin combinations, confidence spoofing, oversized payloads, and promotable claims after session end.
  - Confirmed valid progress and needs-input observations can be promoted when confidence stays within the allowed boundary, while `ready_for_verification` remains observational only and `completed_claim` / `failed_claim` promote only for `daemon-authoritative` plus `authoritative` claims.
  - Ran `pnpm --filter @flying-pillow/mission-core check`, `pnpm exec vitest run packages/core/src/daemon/runtime/agent/signals/*.test.ts --reporter=verbose`, and `pnpm --filter @flying-pillow/mission-core test`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - The focused signal suite passes with 4/4 files and 28/28 tests passing, covering strict marker parsing, source/origin separation, MCP/provider/terminal routing, promotable progress and needs-input signals, malformed and oversized marker rejection, duplicate/scope rejection, confidence-boundary rejection, and the rule that agent-declared completion stays observational only.
  - `pnpm --filter @flying-pillow/mission-core test` does **not** satisfy this task's validation gate in the current workspace. The run fails with 16 failing tests across 7 files: `src/system/SystemStatus.test.ts`, `src/entities/AgentSession/AgentSession.test.ts`, `src/entities/Mission/MissionDossierFilesystem.test.ts`, `src/entities/Repository/Repository.test.ts`, `src/daemon/runtime/agent/TerminalAgentTransport.test.ts`, `src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.test.ts`, and `src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts`.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** None.

### `verification/04-local-mcp-signal-server-verify`

- **Paired task:** `implementation/04-local-mcp-signal-server`
- **Result:** **Focused MCP checks passed; package validation gate blocked by failures outside this slice**
- **Checks:**
  - Confirmed `MissionMcpSignalServer` owns local MCP lifecycle directly: `start()` creates the server handle once, `registerSession()` and `unregisterSession()` go through the daemon-owned registry, `healthCheck()` reports live registration count, and `stop()` clears registrations and drops the handle rather than delegating lifecycle to a runner or remote service.
  - Confirmed the server contract is local-only in implementation, not just documentation: the handle, registration, and health response all hard-code `localOnly: true` and `transport: 'in-memory-local'`, and the endpoint is emitted as `mission-local://mcp-signal/<serverId>`, so this slice does not open a remote or hosted MCP path.
  - Confirmed session registration scopes allowed tools through `MissionMcpSessionRegistry`: registration input is strict-schema validated, `allowedTools` is normalized, authorization rejects unknown sessions, mission/task mismatches, disallowed tools, and duplicate `eventId`s, and event ids are only remembered after an accepted acknowledgement so rejected policy calls do not poison idempotent retries.
  - Confirmed tool payloads are strict-schema validated and bounded in `MissionMcpSignalTools`: every MCP tool requires `missionId`, `taskId`, `agentSessionId`, and `eventId`; tool-specific fields are `.strict()` schemas; text, message, suggested-response, and usage payload sizes are bounded; and successful parsing produces `mcp-validated` high-confidence `AgentSessionSignal`s rather than direct state mutation.
  - Confirmed acknowledgements are policy-derived, not tool-authoritative: `MissionMcpSignalServer` forwards valid calls to `AgentSessionSignalPort.reportSignal(...)`, and `PolicyBoundAgentSessionSignalPort` is the boundary that returns `promoted`, `recorded`, or `rejected` outcomes after routing a single observation through `AgentSessionSignalPolicy`.
  - Confirmed agent claims are not treated as workflow authority: `AgentSessionSignalPolicy` keeps `ready_for_verification` observational only, keeps `completed_claim` / `failed_claim` observational unless the source is `daemon-authoritative` with `authoritative` confidence, rejects ended-session MCP updates, and forbids provider or terminal output from claiming promotable workflow state directly.
  - Confirmed focused MCP coverage passes in `MissionMcpSignalServer.test.ts` and `AgentSessionSignalPort.test.ts`, including startup/shutdown, local-only configuration, registration, allowed-tool scoping, invalid payload rejection, mismatched scope rejection, duplicate-event rejection, ended-session rejection, and promoted vs recorded acknowledgements.
  - Ran `pnpm --filter @flying-pillow/mission-core check`, `pnpm exec vitest run --reporter=verbose packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.test.ts packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPort.test.ts`, and `pnpm --filter @flying-pillow/mission-core test`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - The focused MCP verification passes with 2/2 files and 7/7 tests passing across `MissionMcpSignalServer.test.ts` and `AgentSessionSignalPort.test.ts`.
  - `pnpm --filter @flying-pillow/mission-core test` does **not** satisfy this task's validation gate in the current workspace. The run fails outside this slice in `src/system/SystemStatus.test.ts`, `src/entities/AgentSession/AgentSession.test.ts`, `src/entities/Repository/Repository.test.ts`, `src/daemon/runtime/agent/TerminalAgentTransport.test.ts`, `src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.test.ts`, and `src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts`.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** None.

#### Reverification at `2026-05-04T18:27:31Z`

- **Result:** **Focused MCP checks passed; package validation gate still blocked by failures outside this slice**
- **Checks:**
  - Reconfirmed the daemon-owned MCP lifecycle stays inside `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.ts`: `start()` memoizes the local handle, `registerSession()`/`unregisterSession()` delegate through the session registry, `healthCheck()` reports active registrations, and `stop()` clears registrations before dropping the handle.
  - Reconfirmed the server surface remains local-only and non-remote: handle, registration, and health contracts all pin `localOnly: true` and `transport: 'in-memory-local'`, with endpoints shaped as `mission-local://mcp-signal/<serverId>`.
  - Reconfirmed session registration is mandatory and scoped: `MissionMcpSessionRegistry` strict-validates registration input, deduplicates `allowedTools`, rejects unknown sessions, mission/task mismatches, disallowed tools, and duplicate `eventId`s, and only remembers an `eventId` after an accepted acknowledgement.
  - Reconfirmed MCP payload parsing is strict and bounded in `MissionMcpSignalTools.ts`: each tool requires the full Mission envelope, uses `.strict()` schemas, bounds text/message/suggested-response/usage sizes, and converts successful parses into `mcp-validated` high-confidence signals rather than direct workflow or runtime mutation.
  - Reconfirmed acknowledgements and claim handling still flow through policy rather than tool authority: `MissionMcpSignalServer` forwards validated calls into `PolicyBoundAgentSessionSignalPort`, and `AgentSessionSignalPolicy` keeps `ready_for_verification` observational only, keeps completion/failure claims observational unless daemon-authoritative, and rejects ended-session updates.
  - Re-ran focused MCP tests and the package validation gate commands for the current workspace state.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - `pnpm exec vitest run --reporter=verbose packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.test.ts packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPort.test.ts` passes with 2/2 files and 7/7 tests passing.
  - `pnpm --filter @flying-pillow/mission-core test` still fails outside this slice with 15 failing tests across `src/system/SystemStatus.test.ts`, `src/entities/Repository/Repository.test.ts`, `src/entities/AgentSession/AgentSession.test.ts`, `src/daemon/runtime/agent/TerminalAgentTransport.test.ts`, `src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.test.ts`, and `src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts`.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** None.

#### Reverification at `2026-05-04T18:53:19Z`

- **Result:** **Focused MCP checks passed; package validation gate still blocked by failures outside this slice**
- **Checks:**
  - Reconfirmed `MissionMcpSignalServer` remains the daemon-owned lifecycle boundary: `start()` memoizes a single local handle, `registerSession()` and `unregisterSession()` stay registry-backed, `healthCheck()` reports current registration count, and `stop()` clears registrations and drops the handle without delegating ownership to a runner or remote endpoint.
  - Reconfirmed the MCP surface is local-only by implementation contract, not convention: the handle, registration response, and health payload all pin `localOnly: true` and `transport: 'in-memory-local'`, and the emitted endpoint still uses `mission-local://mcp-signal/<serverId>`.
  - Reconfirmed `MissionMcpSessionRegistry` enforces mandatory session registration and scoping: registration input is strict-schema validated, `allowedTools` is normalized, authorization rejects unknown sessions, mission/task mismatches, disallowed tools, and duplicate `eventId`s, and rejected policy outcomes are still retryable because `rememberEvent(...)` runs only after an accepted acknowledgement.
  - Reconfirmed `MissionMcpSignalTools` keeps payload handling schema-bound and non-authoritative: each tool requires the full Mission envelope, uses `.strict()` schemas with bounded text/message/suggested-response/usage sizes, and converts valid calls into `mcp-validated` high-confidence `AgentSessionSignal` values rather than mutating workflow or runtime state directly.
  - Reconfirmed acknowledgements remain policy-derived through `PolicyBoundAgentSessionSignalPort`: valid MCP calls yield `promoted` or `recorded` only after routing one observation through `AgentSessionSignalPolicy`, while malformed input, scope mismatches, inactive sessions, duplicates, and ended-session updates yield `rejected`.
  - Reconfirmed `AgentSessionSignalPolicy` still prevents agent claims from becoming workflow truth by default: `ready_for_verification` stays observational only, completion/failure claims promote only for `daemon-authoritative` plus `authoritative`, and MCP/provider/terminal origins cannot directly claim promotable workflow state.
  - Re-ran `pnpm --filter @flying-pillow/mission-core check`, `pnpm exec vitest run --reporter=verbose packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.test.ts packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPort.test.ts`, and `pnpm --filter @flying-pillow/mission-core test` against the current workspace state.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - `pnpm exec vitest run --reporter=verbose packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.test.ts packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPort.test.ts` passes with 2/2 files and 7/7 tests passing.
  - `pnpm --filter @flying-pillow/mission-core test` still fails outside this slice with 15 failing tests across `src/system/SystemStatus.test.ts`, `src/entities/AgentSession/AgentSession.test.ts`, `src/entities/Repository/Repository.test.ts`, `src/daemon/runtime/agent/TerminalAgentTransport.test.ts`, `src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.test.ts`, and `src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts`.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** None.

#### Reverification at `2026-05-04T20:31:43Z`

- **Result:** **Focused MCP checks passed; required package test gate still fails outside this slice**
- **Checks:**
  - Reconfirmed `MissionMcpSignalServer` remains the daemon-owned lifecycle owner for this side channel: `start()` memoizes the handle, `registerSession()` and `unregisterSession()` stay registry-backed, `healthCheck()` reports live registration count, and `stop()` clears registrations and drops the handle.
  - Reconfirmed the configuration is local-only by implementation contract: the handle, registration payload, and health payload all pin `localOnly: true` plus `transport: 'in-memory-local'`, the endpoint remains `mission-local://mcp-signal/<serverId>`, and this slice introduces no tracked `.agents/mcp.json` or other remote MCP configuration file.
  - Reconfirmed `MissionMcpSessionRegistry` makes session registration mandatory and scoped: registration input is strict-schema validated, `allowedTools` is normalized, authorization rejects unknown sessions, mission/task mismatches, disallowed tools, and duplicate `eventId`s, and duplicate protection is only recorded after an accepted acknowledgement so rejected policy outcomes remain retryable.
  - Reconfirmed `MissionMcpSignalTools` keeps payloads schema-validated and non-authoritative: every tool requires the full Mission envelope, uses `.strict()` schemas, bounds text/message/suggested-response/usage payload sizes, and converts accepted payloads into `mcp-validated` high-confidence signals instead of mutating workflow state directly.
  - Reconfirmed acknowledgements are policy-derived rather than tool-derived: `MissionMcpSignalServer` forwards validated calls into `PolicyBoundAgentSessionSignalPort`, which returns `promoted`, `recorded`, or `rejected` only after routing a single observation through `AgentSessionSignalPolicy`.
  - Reconfirmed the claim boundary still holds: `ready_for_verification` stays observational only, `completed_claim` and `failed_claim` stay observational unless the source is `daemon-authoritative` with `authoritative` confidence, ended-session MCP updates are rejected, and provider/terminal origins cannot directly claim promotable workflow state.
  - Ran `pnpm --filter @flying-pillow/mission-core check`, `pnpm exec vitest run --config vitest.config.ts src/daemon/runtime/agent/mcp/MissionMcpSignalServer.test.ts src/daemon/runtime/agent/signals/AgentSessionSignalPort.test.ts src/daemon/runtime/agent/signals/AgentSessionSignalPolicy.test.ts src/daemon/runtime/agent/signals/AgentSessionObservationRouter.test.ts`, and `pnpm --filter @flying-pillow/mission-core test`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - The focused MCP/signal slice passes with 4/4 files and 28/28 tests passing across `MissionMcpSignalServer.test.ts`, `AgentSessionSignalPort.test.ts`, `AgentSessionSignalPolicy.test.ts`, and `AgentSessionObservationRouter.test.ts`.
  - `pnpm --filter @flying-pillow/mission-core test` still fails in the current workspace. The structured report records 15 failing tests, with assertion failures surfacing in `src/system/SystemStatus.test.ts`, `src/entities/AgentSession/AgentSession.test.ts`, `src/entities/Repository/Repository.test.ts`, `src/daemon/runtime/agent/TerminalAgentTransport.test.ts`, `src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.test.ts`, and `src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts`.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** None.

### `verification/05-agent-session-mcp-access-provisioning-verify`

- **Paired task:** `implementation/05-agent-session-mcp-access-provisioning`
- **Result:** **Focused MCP provisioning checks passed; required package test gate still fails outside this slice**
- **Checks:**
  - Confirmed `AgentSessionMcpAccessProvisioner` remains the daemon-owned access boundary: it starts the local signal server, registers the session before materialization, injects Mission/session identity through `MissionMcpAgentBridge.createLaunchEnv(...)`, merges that identity into the returned `launchEnv`, and unregisters the session on degraded provisioning, cleanup, and materialization failure.
  - Confirmed the supported runner materializers stay runner-specific rather than assuming a universal MCP client config: Claude writes `.mcp.json` with `mcpServers.mission_signal` plus env placeholders only, Codex appends a managed `[mcp_servers.mission_signal]` block to `.codex/config.toml`, and OpenCode targets `opencode.json`, `opencode.jsonc`, or legacy `.opencode.json` with the current or legacy shape as appropriate.
  - Confirmed Pi remains explicitly unavailable until proven: `PiMcpConfigMaterializer.detectSupport()` returns `supported: false` with an availability reason, and optional provisioning returns `mcp-unavailable` without launch env, generated files, or server registration.
  - Confirmed required versus optional provisioning stays honest: unsupported runners and materialization failures raise `AgentSessionMcpProvisioningError` when policy is `required`, while optional sessions degrade to `mcp-unavailable` or `mcp-degraded` with an explicit reason instead of looking like validated launch success.
  - Confirmed unsupported capability is surfaced instead of leaked through partial launch state: if a materializer returns anything other than `mcp-validated`, the provisioner runs materializer cleanup, unregisters the session, clears generated files and launch env, and reports the degraded state explicitly.
  - Confirmed generated config cleanup is safe and single-use: Claude/OpenCode restore prior file content or remove newly created files, Codex restores the original TOML or removes the managed file and directory when they were created for the session, and provisioner cleanup still unregisters the session even if generated-file cleanup throws.
  - Confirmed per-session identity and tool scope are injected into launch env, not persisted into tracked config: the focused tests assert `MISSION_MCP_ENDPOINT`, `MISSION_MCP_MISSION_ID`, `MISSION_MCP_TASK_ID`, `MISSION_MCP_AGENT_SESSION_ID`, and `MISSION_MCP_ALLOWED_TOOLS` are present in `launchEnv`, while generated Claude/Codex/OpenCode config does not contain concrete mission, task, or session values.
  - Confirmed the runtime launch path preserves injected session env: `AgentProviderAdapter.buildInteractiveLaunch(...)` and `buildPrintLaunch(...)` both merge env as `runtimeEnv -> provider.env -> launchEnv`, so the provisioner's session-scoped MCP identity wins at process launch.
  - Confirmed the slice does not introduce a tracked universal `.agents/mcp.json` assumption; the only runner-specific config paths present in source and tests are `.mcp.json`, `.codex/config.toml`, `opencode.json`, `opencode.jsonc`, and `.opencode.json`.
  - Ran `pnpm --filter @flying-pillow/mission-core check`, `cd packages/core && pnpm exec vitest run --config vitest.config.ts src/daemon/runtime/agent/mcp/AgentSessionMcpAccessProvisioner.test.ts`, and `pnpm --filter @flying-pillow/mission-core test`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - The focused provisioning slice passes in `src/daemon/runtime/agent/mcp/AgentSessionMcpAccessProvisioner.test.ts` with 1/1 file and 11/11 tests passing, covering Claude/Codex/OpenCode config materialization, Pi unavailability, launch-env injection, required versus optional failure behavior, degraded cleanup, malformed env rejection, and unregister-on-cleanup-failure behavior.
  - `pnpm --filter @flying-pillow/mission-core test` does **not** satisfy this task's validation gate in the current workspace: the run ends with 15 failing tests across `src/daemon/runtime/agent/TerminalAgentTransport.test.ts`, `src/entities/AgentSession/AgentSession.test.ts`, `src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts`, `src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.test.ts`, `src/system/SystemStatus.test.ts`, and `src/entities/Repository/Repository.test.ts`. The MCP provisioning file itself passes in that run.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** None.

### `verification/06-agent-skill-protocol-and-launch-instructions-verify`

- **Paired task:** `implementation/06-agent-skill-protocol-and-launch-instructions`
- **Result:** **Focused protocol checks passed; required package test gate still fails outside this slice**
- **Checks:**
  - Confirmed `.agents/skills/mission-agent-runtime-protocol/SKILL.md` defines the required MCP-first behavior, names the local `mission_signal` server, enumerates the Mission MCP tools, requires the `missionId` / `taskId` / `agentSessionId` / `eventId` envelope on every MCP call, and states that MCP acknowledgements, fallback markers, `ready_for_verification`, and `completed_claim` are advisory rather than deterministic verification proof.
  - Confirmed the Skill requires the exact fallback marker prefix `MISSION_SIGNAL::`, followed immediately by strict same-line JSON containing `version`, `missionId`, `taskId`, `agentSessionId`, `eventId`, and `signal`, with the supported signal payloads limited to `progress`, `needs_input`, `blocked`, `ready_for_verification`, `completed_claim`, `failed_claim`, and `message`.
  - Confirmed `packages/core/src/daemon/runtime/agent/signals/MissionProtocolMarkerParser.ts` enforces that exact marker boundary in code: markers must start with `MISSION_SIGNAL::`, parse as strict JSON, satisfy the bounded schema, and malformed or oversized markers are downgraded to diagnostics instead of being accepted as authoritative state.
  - Confirmed `packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPolicy.ts` keeps agent claims observational: `ready_for_verification` returns `record-observation-only` with the reason `Ready-for-verification claims are not deterministic verification authority.`, and non-authoritative `completed_claim` returns `record-observation-only` with the reason `Completion claims stay observational unless the daemon is authoritative.`
  - Confirmed `packages/core/src/daemon/runtime/agent/mcp/MissionAgentRuntimeProtocolLaunchContext.ts` consumes provisioner output honestly: `mcp-validated` sessions pass through the provisioned `launchEnv` and emit MCP-first instructions, while `mcp-degraded` / `mcp-unavailable` sessions drop `launchEnv`, surface the degraded reason in session instructions, and switch guidance to lower-confidence fallback markers scoped to the provided mission/task/session ids.
  - Confirmed `packages/core/src/daemon/runtime/agent/mcp/AgentSessionMcpAccessProvisioner.ts` and its focused tests preserve the same honesty boundary upstream: only `mcp-validated` materialization returns launch env, while optional degraded or unavailable provisioning clears launch env/generated files and reports explicit `mcp-degraded` / `mcp-unavailable` reasons instead of implying unsupported MCP capability.
  - Ran `pnpm --filter @flying-pillow/mission-core check`, `pnpm exec vitest run packages/core/src/daemon/runtime/agent/mcp/MissionAgentRuntimeProtocolLaunchContext.test.ts packages/core/src/daemon/runtime/agent/signals/MissionProtocolMarkerParser.test.ts packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPolicy.test.ts`, and `pnpm --filter @flying-pillow/mission-core test`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - The focused protocol slice passes with 3/3 files and 21/21 tests passing across `MissionAgentRuntimeProtocolLaunchContext.test.ts`, `MissionProtocolMarkerParser.test.ts`, and `AgentSessionSignalPolicy.test.ts`.
  - `pnpm --filter @flying-pillow/mission-core test` does **not** satisfy this task's validation gate in the current workspace: the run ends with 15 failing tests across `src/system/SystemStatus.test.ts`, `src/entities/AgentSession/AgentSession.test.ts`, `src/entities/Repository/Repository.test.ts`, `src/daemon/runtime/agent/TerminalAgentTransport.test.ts`, `src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.test.ts`, and `src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts`.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** None.

### `verification/07-pty-launch-integration-and-pi-migration-verify`

- **Paired task:** `implementation/07-pty-launch-integration-and-pi-migration`
- **Result:** **Focused PTY migration checks passed; required package test gate still fails outside this slice**
- **Checks:**
  - Confirmed `SandcastleAgentRunner` is wired onto the existing Mission PTY transport rather than a provider-owned launch path: its constructor calls `configureTerminalTransportRuntime(...)`, `onStartSession(...)` feeds the validated adapter plan into `startTerminalCommandSession(...)` with `replaceBaseArgs: true`, and the shared `AgentRunner` PTY flow opens the terminal session through `runtime.openSession(...)`.
  - Confirmed interactive-capable providers launch through the adapter-owned interactive plan only: `prepareLaunch(...)` initializes the provider adapter and returns `adapter.buildInteractiveLaunch(config)`, so the PTY-backed runner consumes validated `command` / `args` / `env` rather than assembling Sandcastle-specific commands locally.
  - Confirmed print-only behavior stays off the interactive runtime path: `buildPrintLaunch(...)` exists only on `AgentProviderAdapter` and its tests in this slice, while the runtime-side Sandcastle/PTY runner code calls `buildInteractiveLaunch(...)` exclusively.
  - Confirmed missing interactive capability fails explicitly instead of falling back: `AgentProviderAdapter.initialize(...)` and `buildInteractiveLaunch(...)` both raise `UnsupportedCapabilityError` when `buildInteractiveArgs` is unavailable, and `PiAgentRunner.test.ts` asserts that a non-interactive Pi adapter now rejects session start with that exact error.
  - Confirmed runtime observations flow through the signal router and policy before any session mutation: `routeRuntimeOutput(...)` and `routeUsageObservation(...)` send provider and terminal observations into `AgentSessionObservationRouter.route(...)`, `applyObservations(...)` evaluates each observation through `AgentSessionSignalPolicy.evaluate(...)`, and `applySignalDecision(...)` is the only place this runner emits routed messages or updates session snapshots.
  - Confirmed the stale Pi-only path is removed from the active runtime slice: `PiAgentRunner` now only subclasses `SandcastleAgentRunner` with `runnerId: 'pi'`, and `AgentRuntimeFactory` registers the four Sandcastle-backed runtimes explicitly as `claude-code`, `pi`, `codex`, and `opencode` alongside `copilot-cli`.
  - Confirmed direct Sandcastle orchestration remains confined to the provider adapter boundary: the only `@ai-hero/sandcastle` source import under `packages/core/src` is `packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.ts`, and no sandbox/worktree/orchestration import reappears in runtime ownership code.
  - Ran `pnpm --filter @flying-pillow/mission-core check`, `pnpm exec vitest run packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.test.ts packages/core/src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts packages/core/src/daemon/runtime/agent/runtimes/SandcastleAgentRunner.test.ts`, `pnpm --filter @flying-pillow/mission-core test`, and `pnpm --filter @flying-pillow/mission-core build`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - The focused PTY/provider slice passes with 3/3 files and 13/13 tests passing across `AgentProviderAdapter.test.ts`, `PiAgentRunner.test.ts`, and `SandcastleAgentRunner.test.ts`.
  - `pnpm --filter @flying-pillow/mission-core build` passes.
  - `pnpm --filter @flying-pillow/mission-core test` does **not** satisfy this task's validation gate in the current workspace: the run ends with 14 failing tests across `src/system/SystemStatus.test.ts`, `src/entities/AgentSession/AgentSession.test.ts`, `src/entities/Repository/Repository.test.ts`, `src/daemon/runtime/agent/TerminalAgentTransport.test.ts`, and `src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.test.ts`. With **no ignored baseline failures** for this task, the required package test gate remains failed.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** None.

### `verification/08-agent-session-execution-ux-verify`

- **Paired task:** `implementation/08-agent-session-execution-ux`
- **Result:** **Focused Agent session UX checks pass on inspection; required validation gate fails in the current workspace**
- **Checks:**
  - Confirmed live `pty-terminal` sessions still use the Airport terminal surface as the primary interaction path: `AgentSession.svelte` attaches through `subscribeMissionSessionTerminalTransport(...)`, forwards sanitized keyboard input via `terminal.onData(...)`, forwards resize events via `terminal.onResize(...)` only while the document is visible and focused, and renders persisted transcript output when the live PTY is no longer attached.
  - Confirmed reconnect behavior remains in the shared terminal transport: `TerminalTransportBroker.ts` enables `retryOnDisconnected` for mission session terminals, schedules reconnects, and flushes queued input/resize messages after the socket re-initializes.
  - Confirmed the structured composer is provider-neutral and secondary: `AgentSession.svelte` only renders it when `session.interactionMode === "agent-message"` with structured capabilities enabled, never for live `pty-terminal` sessions; `read-only` sessions show the interaction reason instead of an active input path.
  - Confirmed Mission-owned structured reply routing end to end: Airport `Mission.svelte.ts` routes Agent session commands through `executeAgentSessionCommand(...)`; the web client uses `cmd` in `routes/api/entities/remote/command.remote.ts`; `EntityProxy` forwards that generic entity command through `DaemonApi`; and core `AgentSession.ts` delegates `sendPrompt` / `sendRuntimeMessage` to `mission.sendAgentSessionPrompt(...)` / `mission.sendAgentSessionCommand(...)`.
  - Confirmed interaction capabilities are derived from transport and runtime support, not provider identity: `deriveAgentSessionInteractionCapabilities(...)` maps live terminal transport to `pty-terminal`, structured follow-up support to `agent-message`, and unsupported input to `read-only` with an explicit reason.
  - Confirmed structured operator replies already have focused coverage: `MissionControlViewEvents.test.ts` passes and asserts `session.sendPrompt(...)` and `session.sendCommand(...)` emit Mission-owned `AgentSession` command payloads with `AgentSessionCommandIds.sendPrompt` and `AgentSessionCommandIds.sendRuntimeMessage`.
  - Confirmed no provider-specific Airport branching in the inspected Agent session UX slice: the reviewed UI and gateway paths branch on interaction mode/capabilities and generic entity contracts rather than Sandcastle runner names.
  - Ran `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`, and `pnpm run test:web`. For additional diagnosis after the required root command failed, also ran `pnpm --filter @flying-pillow/mission-airport-web test`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - `pnpm --filter @flying-pillow/mission-core test` does **not** satisfy this task's validation gate in the current workspace: the run ends with 13 failing tests across `src/system/SystemStatus.test.ts`, `src/entities/Repository/Repository.test.ts`, `src/daemon/runtime/agent/TerminalAgentTransport.test.ts`, and `src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.test.ts`.
  - `pnpm run test:web` does **not** satisfy this task's validation gate because the root workspace `package.json` does not define a `test:web` script.
  - Additional diagnostic coverage shows `pnpm --filter @flying-pillow/mission-airport-web test` also fails in the current workspace with 2 failing tests in `src/routes/api/runtime/events/runtime-events.test.ts`, while `src/lib/components/entities/Mission/MissionControlViewEvents.test.ts` passes.
  - Command output was captured to `session-logs/task08-core-test.log` and `session-logs/task08-web-test.log`.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** None.

### `verification/08.1-replace-sandcastle-dependency-with-mission-owned-agent-runners-verify`

- **Paired task:** `implementation/08.1-replace-sandcastle-dependency-with-mission-owned-agent-runners`
- **Result:** **Focused runner cleanup checks passed; required package test gate still fails outside this slice**
- **Checks:**
  - Confirmed `@ai-hero/sandcastle` is no longer a Mission dependency: `packages/core/package.json` no longer lists it, `pnpm-lock.yaml` no longer records it for `packages/core`, and a source sweep for `@ai-hero/sandcastle` returns no tracked source matches under `packages/core/src`.
  - Confirmed `packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.ts` and `packages/core/src/daemon/runtime/agent/runtimes/SandcastleAgentRunner.ts` are removed rather than preserved under another name.
  - Confirmed Mission now owns the coder launch and stream-parsing logic directly through `MissionAgentPtyRunner` plus explicit `ClaudeCodeAgentRunner`, `CodexAgentRunner`, `OpenCodeAgentRunner`, and `PiAgentRunner` implementations under `packages/core/src/daemon/runtime/agent/runtimes/**`.
  - Confirmed `AgentRuntimeFactory` registers the Mission-owned runners explicitly as `copilot-cli`, `claude-code`, `pi`, `codex`, and `opencode`, with no remaining provider-adapter registration layer.
  - Confirmed `CopilotCliAgentRunner` now uses the same Mission-owned PTY runner conventions as the other coders: trusted-folder preparation stays local to the runner lifecycle, launch plans are PTY-backed, and no bespoke shared-session fallback layer remains active in the runner structure.
  - Confirmed `PiAgentRunner` reflects the lean PTY-launch contract directly and keeps unsupported capability handling honest instead of falling back through a generic adapter boundary.
  - Ran `pnpm --filter @flying-pillow/mission-core run check`, `pnpm exec vitest run packages/core/src/daemon/runtime/agent/runtimes/CopilotCliAgentRunner.test.ts packages/core/src/daemon/runtime/agent/TerminalAgentTransport.test.ts packages/core/src/daemon/runtime/agent/runtimes/MissionOwnedAgentRunners.test.ts`, `pnpm --filter @flying-pillow/mission-core build`, and `pnpm --filter @flying-pillow/mission-core test`.
- **Validation note:**
  - `pnpm --filter @flying-pillow/mission-core run check` passes.
  - The focused 08.1 runner slice passes with 3/3 files and 22/22 tests passing across `CopilotCliAgentRunner.test.ts`, `TerminalAgentTransport.test.ts`, and `MissionOwnedAgentRunners.test.ts`.
  - `pnpm --filter @flying-pillow/mission-core build` passes.
  - `pnpm --filter @flying-pillow/mission-core test` does **not** satisfy this task's validation gate in the current workspace: the run ends with 6 failing tests across `src/system/SystemStatus.test.ts` and `src/entities/Repository/Repository.test.ts`. Those suites are outside the Mission-owned runner cleanup slice verified here.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** None.

### `verification/08.2-simplify-agent-mcp-integration-verify`

- **Paired task:** `implementation/08.2-simplify-agent-mcp-integration`
- **Result:** **Focused MCP simplification checks passed; required package test gate still fails outside this slice**
- **Checks:**
  - Confirmed `AgentSessionMcpAccessProvisioner` no longer keeps a runner-specific MCP provisioning allowlist or per-agent config materialization path. Provisioning is now runner-neutral and only depends on the Mission-owned MCP policy plus local bridge registration.
  - Confirmed Mission still owns the MCP signaling boundary: the local server, session registry, signal port, signal policy, and fallback marker path remain intact, and this slice does not weaken authority boundaries or let agent claims bypass policy.
  - Confirmed launch wiring is now instruction-guided instead of config-file mutation driven: session-scoped MCP endpoint and identity still flow through launch env, but Mission now instructs agents to use the local bridge command rather than patching `.mcp.json`, `.codex/config.toml`, `opencode.json`, or similar coder-specific config files.
  - Confirmed `MissionAgentRuntimeProtocolLaunchContext` explicitly tells agents to use the local Mission bridge command `mission mcp agent-bridge` when validated MCP context is available, and degraded or unavailable states still fall back honestly to lower-confidence protocol markers.
  - Confirmed `.agents/skills/mission-agent-runtime-protocol/SKILL.md` now names the local bridge command and keeps the MCP-first, marker-fallback contract explicit for agent coders.
  - Ran `pnpm exec vitest run packages/core/src/daemon/runtime/agent/mcp/AgentSessionMcpAccessProvisioner.test.ts packages/core/src/daemon/runtime/agent/mcp/MissionAgentRuntimeProtocolLaunchContext.test.ts packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.test.ts packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPort.test.ts packages/core/src/daemon/runtime/agent/signals/MissionProtocolMarkerParser.test.ts packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPolicy.test.ts`, `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core build`, and `pnpm --filter @flying-pillow/mission-core test`.
- **Validation note:**
  - The focused MCP/signal slice passes with 6/6 files and 33/33 tests passing.
  - `pnpm --filter @flying-pillow/mission-core check` passes.
  - `pnpm --filter @flying-pillow/mission-core build` passes.
  - `pnpm --filter @flying-pillow/mission-core test` does **not** satisfy this task's validation gate in the current workspace: the run ends with 6 failing tests across `src/system/SystemStatus.test.ts` and `src/entities/Repository/Repository.test.ts`. Those failures are outside the MCP simplification slice verified here.
- **Fixes applied:** None. Verification only.
- **Ignored unrelated failures:** None.

## Gaps

- TODO: Record verification gaps that must be resolved before audit.
- TODO: Separate task gaps from baseline failures.
