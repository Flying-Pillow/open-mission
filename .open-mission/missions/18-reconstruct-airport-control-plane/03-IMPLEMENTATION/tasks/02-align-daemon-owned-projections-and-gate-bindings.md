---
dependsOn: ["implementation/01-establish-repository-scoped-airport-state-and-remove-fallbacks"]
agent: "copilot-cli"
---

# Align Daemon-Owned Projections And Gate Bindings

Align dashboard, editor, and agent-session projections with one daemon-owned system state and one gate-binding policy. This slice should preserve the `MissionControl` versus `AirportControl` boundary while tightening `packages/core/src/daemon/system/ProjectionService.ts`, `MissionSystemController.ts`, related airport types, and focused daemon or airport tests that still permit placeholder or split-source projection behavior.

Use the product artifacts in this mission folder as the canonical context boundary.