---
dependsOn: ["implementation/01-establish-repository-scoped-airport-state-and-remove-fallbacks", "implementation/02-align-daemon-owned-projections-and-gate-bindings"]
agent: "copilot-cli"
---

# Align Substrate Reconciliation And Bootstrap Handoff

Align the airport control loop, substrate observations, and entry-path bootstrap boundary with the airport specification. This slice should keep intended focus, observed focus, pane existence, client registration, and terminal session identity explicit across `packages/core/src/daemon/MissionSystemController.ts`, `packages/airport/src/effects.ts`, `packages/airport/src/terminal-manager.ts`, `apps/tower/terminal/src/commands/airport-layout.ts`, and focused tests that assert the bootstrap handoff and substrate reconciliation behavior.

Use the product artifacts in this mission folder as the canonical context boundary.