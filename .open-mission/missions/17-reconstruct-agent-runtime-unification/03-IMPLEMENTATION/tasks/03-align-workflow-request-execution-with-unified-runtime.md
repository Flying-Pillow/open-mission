---
dependsOn: ["implementation/01-establish-unified-runtime-contract-and-normalized-types","implementation/02-align-orchestrator-and-persisted-session-coordination"]
agent: "copilot-cli"
---

# Align Workflow Request Execution With Unified Runtime

Align workflow request execution and session reconciliation with the unified runtime path. This slice should keep workflow launch, attach, prompt, command, cancel, terminate, and normalized session-fact handling routed through the orchestrator across `packages/core/src/workflow/engine/requestExecutor.ts`, related workflow runtime surfaces, and any session-reconciliation helpers that still imply a split workflow-only runtime path.

Use the product artifacts in this mission folder as the canonical context boundary.