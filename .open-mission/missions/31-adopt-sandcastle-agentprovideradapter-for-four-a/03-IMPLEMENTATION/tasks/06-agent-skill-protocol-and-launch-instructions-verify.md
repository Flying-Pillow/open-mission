---
taskKind: "verification"
pairedTaskId: "implementation/06-agent-skill-protocol-and-launch-instructions"
dependsOn: ["implementation/06-agent-skill-protocol-and-launch-instructions"]
agent: "copilot-cli"
---

# Verify Agent Skill Protocol And Launch Instructions

Paired task: `implementation/06-agent-skill-protocol-and-launch-instructions`.

Focused checks: confirm the Skill defines MCP-first behavior, exact fallback marker format, and the rule that agent claims do not prove verification; confirm MCP-capable launch context consumes provisioner output honestly, non-MCP launches are marked degraded, and the slice satisfies `pnpm --filter @flying-pillow/mission-core check` plus `pnpm --filter @flying-pillow/mission-core test`.

Failure signals: agent claim treated as deterministic verification, unsupported capability not surfaced, malformed marker format accepted as authoritative, or launch instructions bypassing Mission-owned provisioning and signal boundaries.

Ignored baseline failures: none.

Evidence location: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
