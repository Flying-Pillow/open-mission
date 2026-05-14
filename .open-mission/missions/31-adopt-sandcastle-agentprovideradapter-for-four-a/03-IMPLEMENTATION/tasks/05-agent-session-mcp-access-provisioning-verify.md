---
taskKind: "verification"
pairedTaskId: "implementation/05-agent-session-mcp-access-provisioning"
dependsOn: ["implementation/05-agent-session-mcp-access-provisioning"]
agent: "copilot-cli"
---

# Verify AgentSession MCP Access Provisioning

Paired task: `implementation/05-agent-session-mcp-access-provisioning`.

Focused checks: confirm Claude, Codex, and OpenCode materializers produce supported config shapes, Pi remains unavailable until proven, launch env includes session identity, required provisioning fails honestly, optional provisioning degrades capability cleanly, generated config is cleaned up safely, and the slice satisfies `pnpm --filter @flying-pillow/mission-core check` plus `pnpm --filter @flying-pillow/mission-core test`.

Failure signals: provider initialization not validated, unsupported capability not surfaced, per-session secrets written to tracked files, universal config assumptions introduced, or provisioning failure hidden as launch success.

Ignored baseline failures: none.

Evidence location: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
