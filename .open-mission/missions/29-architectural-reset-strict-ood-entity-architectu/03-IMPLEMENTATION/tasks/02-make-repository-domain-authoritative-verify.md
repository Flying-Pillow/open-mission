---
taskKind: "verification"
pairedTaskId: "implementation/02-make-repository-domain-authoritative"
dependsOn: ["implementation/02-make-repository-domain-authoritative"]
agent: "copilot-cli"
---

# Verify Repository Domain Authority

Paired task: `implementation/02-make-repository-domain-authoritative`.

Focused checks: Repository imports, wrapper ownership, strict payload rejection, JSON-safe results, focused Repository tests, and `pnpm --filter @flying-pillow/mission-core check`.

Failure signals: Repository contracts still owned by wrapper files, duplicate validation hiding the boundary, invalid payloads accepted, or Repository/Repositories owning daemon or transport behavior.

Ignore: unrelated Airport web baseline failures.

Evidence: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
