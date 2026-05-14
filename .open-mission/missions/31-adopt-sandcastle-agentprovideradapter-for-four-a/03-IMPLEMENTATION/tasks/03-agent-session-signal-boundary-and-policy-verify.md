---
taskKind: "verification"
pairedTaskId: "implementation/03-agent-session-signal-boundary-and-policy"
dependsOn: ["implementation/03-agent-session-signal-boundary-and-policy"]
agent: "copilot-cli"
---

# Verify Agent Session Signal Boundary And Policy

Paired task: `implementation/03-agent-session-signal-boundary-and-policy`.

Focused checks: confirm MCP-validated, provider-structured, agent-declared, and terminal-heuristic signals are distinguishable; valid progress and needs-input signals can be promoted; malformed or low-confidence claims are rejected or downgraded; and the slice satisfies `pnpm --filter @flying-pillow/mission-core check` plus `pnpm --filter @flying-pillow/mission-core test`.

Failure signals: malformed signal accepted, raw output directly mutating workflow state, agent claim treated as deterministic verification, unsupported capability not surfaced through policy, or provider initialization assumptions leaking into workflow truth.

Ignored baseline failures: none.

Evidence location: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
