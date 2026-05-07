---
taskKind: "verification"
pairedTaskId: "implementation/01-dependency-and-runner-id-boundary"
dependsOn: ["implementation/01-dependency-and-runner-id-boundary"]
agent: "copilot-cli"
---

# Verify Dependency And Runner-Id Boundary

Paired task: `implementation/01-dependency-and-runner-id-boundary`.

Focused checks: confirm `@ai-hero/sandcastle` is added only to `packages/core`, all four runner ids are legal in Mission and workflow schemas, the supported-runner guard recognizes them, and the slice satisfies `pnpm --filter @flying-pillow/mission-core check` plus `pnpm --filter @flying-pillow/mission-core test`.

Failure signals: schema ids missing, supported-runner guard missing coverage, direct Sandcastle orchestration import, or provider initialization behavior introduced before the adapter boundary exists.

Ignored baseline failures: none.

Evidence location: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
