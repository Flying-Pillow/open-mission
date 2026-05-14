---
taskKind: "implementation"
pairedTaskId: "implementation/05-agent-session-mcp-access-provisioning-verify"
dependsOn: ["implementation/04-local-mcp-signal-server-verify"]
agent: "copilot-cli"
---

# AgentSession MCP Access Provisioning

Objective: automatically make the local Mission MCP signal server available to MCP-capable Agent sessions through runner-specific configuration and secret-safe launch environment.

Context: use `02-SPEC/SPEC.md` for the runner-specific materializer model, access-state reporting, launch-env injection, required versus optional provisioning policy, and cleanup rules; keep per-session MCP access daemon-owned and provider-neutral.

Allowed files: `packages/core/src/daemon/runtime/agent/mcp/AgentSessionMcpAccessProvisioner.ts`, `packages/core/src/daemon/runtime/agent/mcp/MissionMcpAgentBridge.ts`, `packages/core/src/daemon/runtime/agent/mcp/materializers/ClaudeCodeMcpConfigMaterializer.ts`, `packages/core/src/daemon/runtime/agent/mcp/materializers/CodexMcpConfigMaterializer.ts`, `packages/core/src/daemon/runtime/agent/mcp/materializers/OpenCodeMcpConfigMaterializer.ts`, `packages/core/src/daemon/runtime/agent/mcp/materializers/PiMcpConfigMaterializer.ts`, `packages/core/src/daemon/runtime/agent/mcp/AgentSessionMcpAccessProvisioner.test.ts`, and runner launch integration files only as needed.

Forbidden files: `apps/airport/**` outside the Agent session interaction-mode projection; `packages/core/src/daemon/runtime/agent/TerminalAgentTransport.ts`; `packages/core/src/entities/**` outside runner-id schema updates and provider-neutral Agent session interaction-mode projection; `docs/adr/**`; any Sandcastle sandbox/worktree/orchestration integration files; workflow gate or verification code; any parser that directly mutates workflow state; remote MCP services or hosted endpoints; `.agents/mcp.json` as a presumed universal agent config; tracked files containing per-session MCP credentials.

Expected change: add MCP access provisioning that registers each session with the local server, materializes supported Claude/Codex/OpenCode config shapes, reports Pi MCP as unavailable until proven, injects session identity into launch env, enforces required versus optional provisioning outcomes, avoids tracked per-session secrets, and cleans up generated runner-specific config.

Compatibility policy: keep access provisioning runner-specific, secret-safe, and capability-gated; do not invent a universal config file, do not write per-session credentials into tracked files, and distinguish provisioning failure from provider launch failure.

Validation gate: `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`.
