---
taskKind: "verification"
pairedTaskId: "implementation/02-mission-owned-sandcastle-provider-initialization-boundary"
dependsOn: ["implementation/02-mission-owned-sandcastle-provider-initialization-boundary"]
agent: "copilot-cli"
---

# Verify Mission-Owned Sandcastle Provider Initialization Boundary

Paired task: `implementation/02-mission-owned-sandcastle-provider-initialization-boundary`.

Focused checks: confirm the `AgentProviderAdapter` contract maps exactly to `claude-code`, `pi`, `codex`, and `opencode`; initializes providers with Mission-resolved model, options, env, and stdin; reports upstream capability facts honestly; validates interactive argv and print launch plans; preserves env precedence; and satisfies `pnpm --filter @flying-pillow/mission-core check` plus `pnpm --filter @flying-pillow/mission-core test`.

Failure signals: provider initialization not validated, unsupported capability not surfaced, direct Sandcastle orchestration import, malformed launch plan accepted, or adapter behavior escaping the Mission-owned provider boundary.

Ignored baseline failures: `packages/core/src/lib/config.test.ts` (`scaffolds a default config in XDG config home`) and `packages/core/src/daemon/runtime/agent/TerminalAgentTransport.test.ts` (`resolves the Copilot CLI from the VS Code global storage fallback when PATH is missing it`) currently fail outside this task's allowed scope.

Evidence location: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
