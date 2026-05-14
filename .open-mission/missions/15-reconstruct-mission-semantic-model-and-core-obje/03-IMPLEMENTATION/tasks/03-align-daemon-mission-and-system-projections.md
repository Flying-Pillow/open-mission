---
dependsOn: ["implementation/01-establish-semantic-contexts-and-record-types","implementation/02-align-workflow-runtime-semantic-boundaries"]
agent: "copilot-cli"
---

# Align Daemon Mission And System Projections

Align daemon-facing mission and repository projections with the semantic model without collapsing top-level control-plane authority into packages/core. This slice should keep `packages/core/src/daemon/mission/Mission.ts`, `packages/core/src/daemon/system/MissionControl.ts`, and `packages/core/src/daemon/system/ProjectionService.ts` consistent about what is semantic mission state, what is derived operator projection, and what remains daemon-wide system state.

Use the product artifacts in this mission folder as the canonical context boundary.
