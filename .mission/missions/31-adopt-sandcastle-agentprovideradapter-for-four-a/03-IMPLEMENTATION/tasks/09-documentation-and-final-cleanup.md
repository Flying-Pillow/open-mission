---
taskKind: "implementation"
pairedTaskId: "implementation/09-documentation-and-final-cleanup-verify"
dependsOn: ["implementation/08.2-simplify-agent-mcp-integration-verify"]
agent: "codex"
---

# Mission MCP Server Wiring, Entity Commands, And Cleanup

Objective: wire the Mission MCP server into the daemon as a singleton lifecycle dependency, expose both structured signal tools and allowlisted Entity commands to agent sessions, and remove any obsolete Sandcastle- or materializer-era runtime truth left behind by the simplification.

Context: use `02-SPEC/SPEC.md` plus the follow-up simplification tasks as the authority for the final ownership model so the repository ends with one active Mission-owned runtime path, one Mission-owned local MCP path, no external Sandcastle dependency, and no per-agent MCP config materializers. Task 4 established the local MCP signal server primitives, and this task closes the remaining daemon boundary so the MCP server is created once per daemon instance, starts when the daemon starts, stops when the daemon stops, and delegates agent-originated Entity commands through the canonical Entity command boundary.

Allowed files: `packages/core/src/daemon/DaemonIpcServer.ts`, `packages/core/src/daemon/startDaemon.ts`, `packages/core/src/daemon/runtime/agent/mcp/**`, `packages/core/src/daemon/runtime/agent/runtimes/**`, `packages/mission/src/**`, focused daemon/MCP tests under `packages/core/src/daemon/runtime/agent/mcp/` or `packages/core/src/daemon/`, plus any cleanup files from Slice 3 that remain obsolete.

Forbidden files: `apps/airport/**` outside the Agent session interaction-mode projection; `packages/core/src/daemon/runtime/agent/TerminalAgentTransport.ts`; `packages/core/src/entities/**` outside runner-id schema updates and provider-neutral Agent session interaction-mode projection; `docs/adr/**`; any Sandcastle sandbox/worktree/orchestration integration files; workflow gate or verification code; any parser that directly mutates workflow state; remote MCP services or hosted endpoints; `.agents/mcp.json` as a presumed universal agent config; tracked files containing per-session MCP credentials.

Expected change: attach one `MissionMcpSignalServer` singleton to the daemon process so daemon start/stop and MCP server start/stop always happen together; update MCP provisioning to consume the daemon-owned singleton instead of lazily creating server lifecycle per session while preserving per-session registration and cleanup; configure agent runtimes to use `mission-command` as the local MCP bridge command instead of the Airport-facing `mission` binary; expose `mission_entity_command` as an allowlisted MCP tool that delegates to Entity commands without bypassing Entity contracts; and remove any obsolete runner, adapter, dependency, or materializer artifacts left from earlier slices so no stale Sandcastle dependency or per-agent MCP file mutation path remains active.

Compatibility policy: preserve Mission runtime ownership and current Airport terminal behavior, preserve per-session MCP registration semantics, but do not preserve obsolete Sandcastle-backed adapter layers, lazy per-session MCP server startup, `mission mcp agent-bridge` as an agent bridge command, or per-agent MCP materialization paths once the leaner Mission-owned runtime is active.

Validation gate: `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`, `pnpm --filter @flying-pillow/mission-core build`.
