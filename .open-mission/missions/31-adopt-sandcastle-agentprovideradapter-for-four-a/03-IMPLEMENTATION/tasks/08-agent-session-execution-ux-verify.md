---
taskKind: "verification"
pairedTaskId: "implementation/08-agent-session-execution-ux"
dependsOn: ["implementation/08-agent-session-execution-ux"]
agent: "copilot-cli"
---

# Verify Agent Session Execution UX

Paired task: `implementation/08-agent-session-execution-ux`.

Focused checks: confirm `pty-terminal` sessions preserve terminal input, output, focus, resize, reconnect, and log behavior; `agent-message` sessions expose a prompt or command composer through Mission-owned gateway paths; `read-only` sessions hide or disable input with a reason; needs-input responses use the correct interaction mode; and the slice satisfies `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`, plus `pnpm run test:web`.

Failure signals: terminal UX regression, non-interactive composer shown as primary input for a live PTY session, structured prompt bypassing Mission runtime APIs, provider-specific UI branching, or unsupported interaction capability presented as available.

Ignored baseline failures: none.

Evidence location: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
