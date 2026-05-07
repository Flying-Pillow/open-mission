---
taskKind: "verification"
pairedTaskId: "implementation/07-pty-launch-integration-and-pi-migration"
dependsOn: ["implementation/07-pty-launch-integration-and-pi-migration"]
agent: "copilot-cli"
---

# Verify PTY Launch Integration And Pi Migration

Paired task: `implementation/07-pty-launch-integration-and-pi-migration`.

Focused checks: confirm interactive-capable providers launch through Mission PTY transport, print-only behavior stays off the interactive path, missing interactive capability fails explicitly, runtime observations flow through the signal router and policy, the stale Pi-only path is removed, and the slice satisfies `pnpm --filter @flying-pillow/mission-core check`, `pnpm --filter @flying-pillow/mission-core test`, plus `pnpm --filter @flying-pillow/mission-core build`.

Failure signals: PTY launch bypassed, unsupported capability not surfaced, stale Pi path still active, raw output directly mutating workflow state, or direct Sandcastle orchestration import reappearing in runtime ownership code.

Ignored baseline failures: none.

Evidence location: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
