---
taskKind: "implementation"
pairedTaskId: "implementation/08-agent-session-execution-ux-verify"
dependsOn: ["implementation/07-pty-launch-integration-and-pi-migration-verify"]
agent: "copilot-cli"
---

# Agent Session Execution UX

Objective: preserve the existing PTY terminal experience and add a generic non-interactive prompt or command input path only where Mission session capabilities allow it.

Context: use `02-SPEC/SPEC.md` for provider-neutral interaction modes, session capability publication, structured AgentPrompt and AgentCommand submission, and Airport projection rules that keep the terminal as the protected primary UX for live PTY sessions.

Allowed files: provider-neutral Agent session snapshot, event, or capability files under `packages/core/src/entities/AgentSession/**` or their existing equivalents, `packages/core/src/daemon/runtime/agent/AgentRunner.ts` only as needed to publish interaction capabilities and accept structured AgentPrompt or AgentCommand submissions, `apps/airport/**/AgentSessionPanel*` or equivalent Agent session panel files, and existing Airport route, remote, or gateway files only as needed to submit structured prompts through Mission runtime APIs.

Forbidden files: `apps/airport/**` outside the Agent session interaction-mode projection; `packages/core/src/daemon/runtime/agent/TerminalAgentTransport.ts`; `packages/core/src/entities/**` outside runner-id schema updates and provider-neutral Agent session interaction-mode projection; `docs/adr/**`; any Sandcastle sandbox/worktree/orchestration integration files; workflow gate or verification code; any parser that directly mutates workflow state; remote MCP services or hosted endpoints; `.agents/mcp.json` as a presumed universal agent config; tracked files containing per-session MCP credentials.

Expected change: publish provider-neutral interaction capabilities for `pty-terminal`, `agent-message`, and `read-only` sessions; preserve PTY input, output, focus, resize, reconnect, screen, and log behavior; add a secondary prompt or command composer only for capability-allowed non-interactive flows; and route operator replies through Mission-owned runtime APIs without branching on Sandcastle provider names.

Compatibility policy: keep the existing PTY terminal as the primary live interaction surface, never show a chat-style composer as primary input for a `pty-terminal` session, and keep Airport as a provider-neutral projection over Mission runtime state rather than a provider-specific UI.

Validation gate: `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`, `pnpm run test:web`.
