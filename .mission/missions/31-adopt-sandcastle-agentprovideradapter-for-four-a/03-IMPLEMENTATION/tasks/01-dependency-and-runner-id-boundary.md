---
taskKind: "implementation"
pairedTaskId: "implementation/01-dependency-and-runner-id-boundary-verify"
dependsOn: ["spec/02-plan"]
agent: "copilot-cli"
---

# Dependency And Runner-Id Boundary

Objective: add the Sandcastle dependency and extend the legal Mission runner ids without introducing provider behavior yet.

Context: use `02-SPEC/SPEC.md` as the normative slice definition, with `CONTEXT.md` and `.agents/constitution.md` as the governing domain boundary for provider-neutral runtime ownership in `packages/core`.

Allowed files: `packages/core/package.json`, `pnpm-lock.yaml`, `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeIds.ts`, `packages/core/src/daemon/runtime/agent/runtimes/AgentRuntimeIds.test.ts`, `packages/core/src/entities/Mission/MissionSchema.ts`, `packages/core/src/workflow/WorkflowSchema.ts`.

Forbidden files: `apps/airport/**` outside the Agent session interaction-mode projection; `packages/core/src/daemon/runtime/agent/TerminalAgentTransport.ts`; `packages/core/src/entities/**` outside runner-id schema updates and provider-neutral Agent session interaction-mode projection; `docs/adr/**`; any Sandcastle sandbox/worktree/orchestration integration files; workflow gate or verification code; any parser that directly mutates workflow state; remote MCP services or hosted endpoints; `.agents/mcp.json` as a presumed universal agent config; tracked files containing per-session MCP credentials.

Expected change: add `@ai-hero/sandcastle` only in `packages/core`, extend the canonical runner-id set to `claude-code`, `pi`, `codex`, and `opencode`, and prove those ids are legal in Mission and workflow schemas plus the supported-runner guard.

Compatibility policy: preserve Mission-owned runtime authority and existing Airport terminal behavior; no sandbox fallback, hidden provider discovery, manual provider command builders, or provider-specific metadata expansion beyond the legal runner ids in this slice.

Validation gate: `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`.
