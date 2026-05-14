---
taskKind: "implementation"
pairedTaskId: "implementation/02-mission-owned-sandcastle-provider-initialization-boundary-verify"
dependsOn: ["implementation/01-dependency-and-runner-id-boundary-verify"]
agent: "copilot-cli"
---

# Mission-Owned Sandcastle Provider Initialization Boundary

Objective: introduce the Mission-owned `AgentProviderAdapter` contract that wraps Sandcastle's public provider shape and normalizes initialization, capabilities, launch plans, env, stdin, and observations.

Context: use `02-SPEC/SPEC.md` for the adapter contract, failure behavior, and Mission-owned signatures, and keep the design aligned with `CONTEXT.md` plus `.agents/constitution.md` so provider-specific logic stays behind a `packages/core` adapter boundary.

Allowed files: `packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.ts`, `packages/core/src/daemon/runtime/agent/providers/AgentProviderAdapter.test.ts`.

Forbidden files: `apps/airport/**` outside the Agent session interaction-mode projection; `packages/core/src/daemon/runtime/agent/TerminalAgentTransport.ts`; `packages/core/src/entities/**` outside runner-id schema updates and provider-neutral Agent session interaction-mode projection; `docs/adr/**`; any Sandcastle sandbox/worktree/orchestration integration files; workflow gate or verification code; any parser that directly mutates workflow state; remote MCP services or hosted endpoints; `.agents/mcp.json` as a presumed universal agent config; tracked files containing per-session MCP credentials.

Expected change: add the `AgentProviderAdapter` contract in the allowed provider adapter files and focused tests that prove exact mapping for `claude-code`, `pi`, `codex`, and `opencode`, Mission-resolved model/options/env initialization, launch-plan validation, env precedence, stdin preservation, structured observation handling, and explicit provider-initialization or unsupported-capability errors without importing Sandcastle orchestration APIs.

Compatibility policy: keep Sandcastle confined to the provider adapter folder, preserve Mission-owned lifecycle authority, and allow only a minimal adapter-local compatibility type if a required Sandcastle public export is missing and the limitation is explicitly documented.

Validation gate: `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`.
