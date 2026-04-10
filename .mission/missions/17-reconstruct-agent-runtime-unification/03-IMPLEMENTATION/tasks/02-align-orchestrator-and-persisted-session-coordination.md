---
dependsOn: ["implementation/01-establish-unified-runtime-contract-and-normalized-types"]
agent: "copilot-cli"
---

# Align Orchestrator And Persisted Session Coordination

Align the session orchestrator, runner registry, and persisted session coordination around the unified runtime boundary. This slice should preserve runner registration, attach or reattach behavior, session registry ownership, normalized event forwarding, snapshot persistence, and restored mission or task ownership across `packages/core/src/runtime/AgentSessionOrchestrator.ts`, `AgentRunnerRegistry.ts`, `PersistedAgentSessionStore.ts`, and related focused tests.

Use the product artifacts in this mission folder as the canonical context boundary.