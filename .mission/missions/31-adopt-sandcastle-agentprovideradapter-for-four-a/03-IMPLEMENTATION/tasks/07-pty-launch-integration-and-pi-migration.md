---
taskKind: "implementation"
pairedTaskId: "implementation/07-pty-launch-integration-and-pi-migration-verify"
dependsOn: ["implementation/06-agent-skill-protocol-and-launch-instructions-verify"]
agent: "copilot-cli"
---

# PTY Launch Integration And Pi Migration

Objective: route Sandcastle-backed providers through Mission's existing PTY transport and replace the old direct Pi runner path.

Context: use `02-SPEC/SPEC.md` for the PTY launch boundary, runtime factory ownership, print-only capability rules, explicit unsupported-capability failures, and the required cleanup that removes the old Pi-only path in the same slice.

Allowed files: `packages/core/src/daemon/runtime/agent/AgentRunner.ts`, `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeFactory.ts`, `packages/core/src/daemon/runtime/agent/runtimes/SandcastleAgentRunner.ts`, `packages/core/src/daemon/runtime/agent/runtimes/SandcastleAgentRunner.test.ts`, `packages/core/src/daemon/runtime/agent/runtimes/PiAgentRunner.ts`, `packages/core/src/daemon/runtime/agent/runtimes/PiAgentRunner.test.ts`, and signal router integration files from Slice 3 only as needed.

Forbidden files: `apps/airport/**` outside the Agent session interaction-mode projection; `packages/core/src/daemon/runtime/agent/TerminalAgentTransport.ts`; `packages/core/src/entities/**` outside runner-id schema updates and provider-neutral Agent session interaction-mode projection; `docs/adr/**`; any Sandcastle sandbox/worktree/orchestration integration files; workflow gate or verification code; any parser that directly mutates workflow state; remote MCP services or hosted endpoints; `.agents/mcp.json` as a presumed universal agent config; tracked files containing per-session MCP credentials.

Expected change: add `SandcastleAgentRunner`, register the four Sandcastle-backed runtimes explicitly in `AgentRuntimeFactory`, feed validated launch plans through the existing PTY-backed runner flow, keep print-only behavior off the interactive path, fail clearly when interactive capability is unsupported, route runtime observations through the signal router and policy, and delete or rewrite the stale direct Pi runner path so no dual active implementation remains.

Compatibility policy: preserve the existing PTY terminal transport and Mission-owned session lifecycle, but do not preserve legacy direct Pi command-building once the Sandcastle-backed path lands; no sandbox fallback, hidden command builders, or alternate runtime registry may survive.

Validation gate: `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`, `pnpm --filter @flying-pillow/mission-core build`.
