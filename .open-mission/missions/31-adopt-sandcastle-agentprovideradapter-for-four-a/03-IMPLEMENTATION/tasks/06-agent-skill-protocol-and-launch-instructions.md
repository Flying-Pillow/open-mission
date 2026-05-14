---
taskKind: "implementation"
pairedTaskId: "implementation/06-agent-skill-protocol-and-launch-instructions-verify"
dependsOn: ["implementation/05-agent-session-mcp-access-provisioning-verify"]
agent: "copilot-cli"
---

# Agent Skill Protocol And Launch Instructions

Objective: teach agents to use the local MCP server when available and strict lower-confidence marker fallback when unavailable.

Context: use `02-SPEC/SPEC.md` for the Skill policy, fallback marker syntax, and MCP-capable launch-context rules so agent guidance remains advisory and provider-neutral rather than a source of Mission state truth.

Allowed files: `.agents/skills/mission-agent-runtime-protocol/SKILL.md`, `packages/core/src/daemon/runtime/agent/runtimes/SandcastleAgentRunner.ts` or launch-context files only as needed to pass MCP endpoint and session instructions to MCP-capable runtimes, and focused tests for launch context only if runtime code changes.

Forbidden files: `apps/airport/**` outside the Agent session interaction-mode projection; `packages/core/src/daemon/runtime/agent/TerminalAgentTransport.ts`; `packages/core/src/entities/**` outside runner-id schema updates and provider-neutral Agent session interaction-mode projection; `docs/adr/**`; any Sandcastle sandbox/worktree/orchestration integration files; workflow gate or verification code; any parser that directly mutates workflow state; remote MCP services or hosted endpoints; `.agents/mcp.json` as a presumed universal agent config; tracked files containing per-session MCP credentials.

Expected change: add the mission runtime protocol Skill with MCP-first guidance, exact fallback marker format, and an explicit rule that agent claims do not prove verification or completion; pass MCP endpoint and session instructions only where runtime launch context needs them, and mark non-MCP launches as degraded instead of falsely high-confidence.

Compatibility policy: Skills may shape agent behavior but cannot become correctness proof, workflow authority, or a provider-specific launch path; fallback markers remain lower-confidence inputs that still require signal-policy evaluation.

Validation gate: `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`.
