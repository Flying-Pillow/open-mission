---
dependsOn: ["implementation/01-establish-workflow-runtime-document-and-reducer-boundary"]
agent: "copilot-cli"
---

# Align Deterministic Task Generation And Scheduling

Align the workflow engine's task-generation and scheduling behavior with the preserved contract. This slice should keep `tasks.request-generation`, `tasks.generated`, idempotent generated payloads, queue normalization, stage eligibility, and delivery-stage completion behavior deterministic across `packages/core/src/workflow/engine/generator.ts`, `requestExecutor.ts`, `controller.ts`, `reducer.ts`, and related validation surfaces.

Use the product artifacts in this mission folder as the canonical context boundary.
