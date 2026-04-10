---
agent: "copilot-cli"
---

# Establish Unified Runtime Contract And Normalized Types

Align the core runtime surface around one authoritative provider-neutral contract. This slice should preserve `AgentRunner`, `AgentSession`, normalized prompt, command, snapshot, capability, and event types, while removing split-boundary ambiguity from runtime naming and ownership across `packages/core/src/runtime/*`, `packages/core/src/index.ts`, and any adjacent type or export surfaces that still imply parallel runtime contracts.

Use the product artifacts in this mission folder as the canonical context boundary.