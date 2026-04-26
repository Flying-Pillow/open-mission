---
taskKind: "verification"
pairedTaskId: "implementation/01-create-canonical-schema-contracts"
dependsOn: ["implementation/01-create-canonical-schema-contracts"]
agent: "copilot-cli"
---

# Verify Canonical Schema Contracts

Verify that shared schemas are canonical under packages/core/src/schemas and that Repository, EntityRemote, RuntimeEvents, and schema barrel exports are strict and browser-safe. Confirm airport/runtime no longer owns entity, method, or event schemas. Run focused schema, type, and package checks, and record any remaining gaps in 03-IMPLEMENTATION/VERIFY.md.

Use the product artifacts in this mission folder as the canonical context boundary.
