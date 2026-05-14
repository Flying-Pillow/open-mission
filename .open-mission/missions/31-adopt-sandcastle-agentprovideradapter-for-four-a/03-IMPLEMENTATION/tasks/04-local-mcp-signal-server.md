---
taskKind: "implementation"
pairedTaskId: "implementation/04-local-mcp-signal-server-verify"
dependsOn: ["implementation/03-agent-session-signal-boundary-and-policy-verify"]
agent: "copilot-cli"
---

# Local MCP Signal Server

Objective: provide the preferred structured agent-to-Mission side channel without making MCP a workflow owner.

Context: use `02-SPEC/SPEC.md` for the local-only MCP lifecycle, session scoping, schema validation, idempotency, acknowledgement, and signal-policy integration rules; preserve daemon ownership of Mission state and workflow law.

Allowed files: `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.ts`, `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalTools.ts`, `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSessionRegistry.ts`, `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.test.ts`, `packages/core/src/daemon/runtime/agent/signals/AgentSessionSignalPort.ts`, focused signal or MCP tests under `packages/core/src/daemon/runtime/agent/signals/`, and repo-local MCP configuration only if required for local server wiring.

Forbidden files: `apps/airport/**` outside the Agent session interaction-mode projection; `packages/core/src/daemon/runtime/agent/TerminalAgentTransport.ts`; `packages/core/src/entities/**` outside runner-id schema updates and provider-neutral Agent session interaction-mode projection; `docs/adr/**`; any Sandcastle sandbox/worktree/orchestration integration files; workflow gate or verification code; any parser that directly mutates workflow state; remote MCP services or hosted endpoints; `.agents/mcp.json` as a presumed universal agent config; tracked files containing per-session MCP credentials.

Expected change: add a daemon-owned local MCP signal server, tool definitions, registry, and signal port that support startup and shutdown, session registration, local-only configuration, scoped tool access, schema validation, idempotency, and acknowledgement routing through signal policy without allowing MCP handlers to mutate workflow state directly.

Compatibility policy: MCP may provide high-confidence structured claims only after local transport, session registration, scoping, validation, idempotency, and policy evaluation; it must stay optional, local, daemon-owned, and non-authoritative for workflow gates or state mutation.

Validation gate: `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`.
