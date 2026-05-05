---
taskKind: "implementation"
pairedTaskId: "implementation/09-documentation-and-final-cleanup-verify"
dependsOn: ["implementation/08.2-simplify-agent-mcp-integration-verify"]
agent: "codex"
---

# Mission MCP Server Wiring And Cleanup

Objective: wire the Mission MCP signal server into the daemon as a singleton lifecycle dependency and remove any obsolete Sandcastle- or materializer-era runtime truth left behind by the simplification.

Context: use `02-SPEC/SPEC.md` plus the follow-up simplification tasks as the authority for the final ownership model so the repository ends with one active Mission-owned runtime path, one Mission-owned MCP signaling path, no external Sandcastle dependency, and no per-agent MCP config materializers. Task 4 established the local MCP signal server primitives, and this task closes the remaining daemon boundary so the MCP server is created once per daemon instance, starts when the daemon starts, and stops when the daemon stops.

Allowed files: `packages/core/src/daemon/DaemonIpcServer.ts`, `packages/core/src/daemon/startDaemon.ts`, `packages/core/src/daemon/runtime/agent/mcp/MissionMcpSignalServer.ts`, `packages/core/src/daemon/runtime/agent/mcp/AgentSessionMcpAccessProvisioner.ts`, focused daemon/MCP tests under `packages/core/src/daemon/runtime/agent/mcp/` or `packages/core/src/daemon/`, plus any cleanup files from Slice 3 that remain obsolete.

Forbidden files: `apps/airport/**` outside the Agent session interaction-mode projection; `packages/core/src/daemon/runtime/agent/TerminalAgentTransport.ts`; `packages/core/src/entities/**` outside runner-id schema updates and provider-neutral Agent session interaction-mode projection; `docs/adr/**`; any Sandcastle sandbox/worktree/orchestration integration files; workflow gate or verification code; any parser that directly mutates workflow state; remote MCP services or hosted endpoints; `.agents/mcp.json` as a presumed universal agent config; tracked files containing per-session MCP credentials.

Expected change: attach one `MissionMcpSignalServer` singleton to the daemon process so daemon start/stop and MCP server start/stop always happen together; update MCP provisioning to consume the daemon-owned singleton instead of lazily creating server lifecycle per session while preserving per-session registration and cleanup; and remove any obsolete runner, adapter, dependency, or materializer artifacts left from earlier slices so no stale Sandcastle dependency or per-agent MCP file mutation path remains active.

Compatibility policy: preserve Mission runtime ownership and current Airport terminal behavior, preserve per-session MCP registration semantics, but do not preserve obsolete Sandcastle-backed adapter layers, lazy per-session MCP server startup, or per-agent MCP materialization paths once the leaner Mission-owned runtime is active.

Validation gate: `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`, `pnpm --filter @flying-pillow/mission-core build`.
