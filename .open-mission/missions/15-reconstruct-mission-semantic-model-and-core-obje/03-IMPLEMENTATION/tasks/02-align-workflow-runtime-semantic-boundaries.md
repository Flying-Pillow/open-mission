---
dependsOn: ["implementation/01-establish-semantic-contexts-and-record-types"]
agent: "copilot-cli"
---

# Align Workflow Runtime Semantic Boundaries

Align the mission-local workflow document boundary with the preserved semantic model. This slice should keep `mission.json`, `WorkflowSnapshot`, `WorkflowRuntimeState`, stage projections, task runtime, and gate projections clearly mission-local and reducer-owned across `packages/core/src/workflow/engine/types.ts`, related workflow document helpers, and the mission-facing runtime surfaces that consume them.

Use the product artifacts in this mission folder as the canonical context boundary.
