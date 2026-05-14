---
agent: "copilot-cli"
---

# Establish Repository-Scoped Airport State And Remove Fallbacks

Align the airport package and daemon registry around one valid repository-scoped control-plane identity. This slice should remove unscoped airport fallbacks, keep airport identity and terminal session naming repository-bound, and preserve one clean construction path across `packages/airport/src/AirportControl.ts`, `packages/airport/src/types.ts`, `packages/core/src/daemon/system/RepositoryAirportRegistry.ts`, and adjacent focused tests.

Use the product artifacts in this mission folder as the canonical context boundary.