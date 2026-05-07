---
taskKind: "implementation"
pairedTaskId: "implementation/03-agent-session-signal-boundary-and-policy-verify"
dependsOn: ["implementation/02-mission-owned-sandcastle-provider-initialization-boundary-verify"]
agent: "copilot-cli"
---

# Agent Session Signal Boundary And Policy

Objective: add Mission-owned signal types, source/confidence tracking, observation routing, marker parsing, provider-output conversion, and promotion policy.

Context: use `02-SPEC/SPEC.md` as the authority for signal semantics, failure behavior, and boundary ownership so MCP, provider parsing, protocol markers, and heuristics remain signal sources only and never workflow owners.

Allowed files: `packages/core/src/daemon/runtime/agent/signals/AgentSessionSignal.ts`, `packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPolicy.ts`, `packages/core/src/daemon/runtime/agent/signals/AgentSessionObservationRouter.ts`, `packages/core/src/daemon/runtime/agent/signals/MissionProtocolMarkerParser.ts`, `packages/core/src/daemon/runtime/agent/signals/ProviderOutputSignalParser.ts`, `packages/core/src/daemon/runtime/agent/signals/*.test.ts`.

Forbidden files: `apps/airport/**` outside the Agent session interaction-mode projection; `packages/core/src/daemon/runtime/agent/TerminalAgentTransport.ts`; `packages/core/src/entities/**` outside runner-id schema updates and provider-neutral Agent session interaction-mode projection; `docs/adr/**`; any Sandcastle sandbox/worktree/orchestration integration files; workflow gate or verification code; any parser that directly mutates workflow state; remote MCP services or hosted endpoints; `.agents/mcp.json` as a presumed universal agent config; tracked files containing per-session MCP credentials.

Expected change: create typed signal boundaries that distinguish MCP-validated, provider-structured, agent-declared, and terminal-heuristic claims; parse strict Mission protocol markers; route observations through a policy that can promote valid progress or needs-input messages while rejecting malformed, spoofed, oversized, duplicate, or low-confidence output from becoming workflow truth.

Compatibility policy: keep all promotion centralized in `AgentSessionSignalPolicy`, do not broaden workflow law, and do not treat agent claims, provider output, or heuristics as deterministic verification, delivery, or completion authority.

Validation gate: `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`.

Extra instruction: Only verify, the code is already in place.
