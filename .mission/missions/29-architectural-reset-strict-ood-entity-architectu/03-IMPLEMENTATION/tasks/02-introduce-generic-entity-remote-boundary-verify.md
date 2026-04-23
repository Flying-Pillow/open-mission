---
taskKind: "verification"
pairedTaskId: "implementation/02-introduce-generic-entity-remote-boundary"
dependsOn: ["implementation/02-introduce-generic-entity-remote-boundary"]
agent: "copilot-cli"
---

# Verify Generic Entity Remote Boundary

Verify that Airport queries, commands, and forms now route through the generic entity remote boundary for this slice. Confirm focused remote, gateway, and integration tests cover entity-method dispatch, request validation, thin gateway translation, and any transitional remotes staying transport-only instead of reintroducing route-local orchestration. Record any remaining gaps in `VERIFY.md`.

Use the product artifacts in this mission folder as the canonical context boundary.
