---
taskKind: "verification"
pairedTaskId: "implementation/05-align-ui-components-with-entity-and-app-context-apis"
dependsOn: ["implementation/05-align-ui-components-with-entity-and-app-context-apis"]
agent: "copilot-cli"
---

# Verify UI Components Use Entity And App Context APIs

Verify that presentation components now consume only entity and app-context APIs for this slice. Confirm focused component, route, and runtime integration tests cover mission-control flows, issue-to-mission creation, scoped actions, terminal and session attachment behavior, and artifact viewing or editing without direct remote imports, manual command payload assembly, or component-level document fetch orchestration. Record any remaining gaps in `VERIFY.md`.

Use the product artifacts in this mission folder as the canonical context boundary.
