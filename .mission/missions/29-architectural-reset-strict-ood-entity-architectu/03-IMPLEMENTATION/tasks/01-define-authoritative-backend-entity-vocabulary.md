---
taskKind: "implementation"
pairedTaskId: "implementation/01-define-authoritative-backend-entity-vocabulary-verify"
agent: "copilot-cli"
---

# Define Authoritative Backend Entity Vocabulary

Define the authoritative backend entity vocabulary so `packages/core` and the daemon boundary speak in first-class `Repository`, `Mission`, `Stage`, `Task`, `Artifact`, and `AgentSession` contracts. This slice should cover `packages/core/src/repository/*`, `packages/core/src/mission/*`, `packages/core/src/airport/runtime.ts`, `packages/core/src/client/DaemonMissionApi.ts`, `packages/core/src/daemon/protocol/contracts.ts`, and `packages/core/src/index.ts`, replacing storage-shaped or workflow-document-shaped DTO leakage with explicit entity-shaped runtime contracts.

Use the product artifacts in this mission folder as the canonical context boundary.
