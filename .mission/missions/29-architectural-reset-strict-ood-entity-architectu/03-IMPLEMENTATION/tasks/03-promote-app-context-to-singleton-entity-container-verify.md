---
taskKind: "verification"
pairedTaskId: "implementation/03-promote-app-context-to-singleton-entity-container"
dependsOn: ["implementation/03-promote-app-context-to-singleton-entity-container"]
agent: "copilot-cli"
---

# Verify App Context Singleton Entity Container

Verify that Airport now reuses one application and app-context container across route transitions for this slice. Confirm focused client-runtime and route-level tests cover entity instance ownership, selection synchronization, hydration or reconciliation behavior, and protection against components reconstructing transport collaborators or bypassing the singleton container. Record any remaining gaps in `VERIFY.md`.

Use the product artifacts in this mission folder as the canonical context boundary.
