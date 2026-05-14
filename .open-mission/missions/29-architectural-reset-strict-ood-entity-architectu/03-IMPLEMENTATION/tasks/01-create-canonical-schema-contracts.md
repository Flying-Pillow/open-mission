---
taskKind: "implementation"
pairedTaskId: "implementation/01-create-canonical-schema-contracts-verify"
agent: "copilot-cli"
---

# Create Canonical Schema Contracts

Implement the canonical shared schema surface required by SPEC.md. Move Repository-owned data, snapshot, method payload, method result, generic entity remote, command acknowledgement, and runtime event contract ownership under packages/core/src/schemas. Decompose packages/core/src/airport/runtime.ts so it is no longer the canonical schema surface. Keep the work strict: no passthrough payloads, no compatibility aliases, and no fallback parser layers.

Use the product artifacts in this mission folder as the canonical context boundary.
