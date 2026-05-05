---
taskKind: "verification"
pairedTaskId: "implementation/09-documentation-and-final-cleanup"
dependsOn: ["implementation/09-documentation-and-final-cleanup"]
agent: "codex"
---

# Verify Documentation And Final Cleanup

Paired task: `implementation/09-documentation-and-final-cleanup`.

Focused checks: confirm the runtime documentation states Mission now owns the four agent-coder runners directly, Mission still owns lifecycle, logs, PTY transport, interaction-mode semantics, local MCP signaling, and instruction-guided MCP usage, and that no Sandcastle dependency, no legacy Pi-only path, and no per-agent MCP materialization path remain active; verify the slice satisfies `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`, plus `pnpm --filter @flying-pillow/mission-core build`.

Failure signals: stale Pi path still active, PTY launch bypassed in the documented ownership model, agent claim treated as deterministic verification, Sandcastle dependency or per-agent MCP config mutation reintroduced as active truth, or cleanup leaving dual runtime paths behind.

Ignored baseline failures: none.

Evidence location: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
