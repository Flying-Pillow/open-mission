---
taskKind: "verification"
pairedTaskId: "implementation/04-local-mcp-signal-server"
dependsOn: ["implementation/04-local-mcp-signal-server"]
agent: "copilot-cli"
---

# Verify Local MCP Signal Server

Paired task: `implementation/04-local-mcp-signal-server`.

Focused checks: confirm MCP server lifecycle is daemon-owned, configuration is local-only, session registration scopes allowed tools, payloads are schema-validated and idempotent, acknowledgements report promoted or rejected outcomes through signal policy, and the slice satisfies `pnpm --filter @flying-pillow/mission-core check` plus `pnpm --filter @flying-pillow/mission-core test`.

Failure signals: malformed signal accepted, raw output directly mutating workflow state, remote or unscoped MCP access allowed, session registration bypassed, or agent claim treated as authoritative without signal-policy evaluation.

Ignored baseline failures: none.

Evidence location: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
