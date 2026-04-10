---
agent: "copilot-cli"
---

# Establish Workflow Runtime Document And Reducer Boundary

Align the workflow engine around one canonical mission-local runtime document and reducer-owned state transitions. This slice should preserve mission lifecycle, stage projections, task runtime, gate projections, panic, pause target metadata, and reducer-owned `activeStageId` semantics across `packages/core/src/workflow/engine/types.ts`, `document.ts`, `reducer.ts`, `validation.ts`, and the mission-facing runtime surfaces that consume them.

Use the product artifacts in this mission folder as the canonical context boundary.
