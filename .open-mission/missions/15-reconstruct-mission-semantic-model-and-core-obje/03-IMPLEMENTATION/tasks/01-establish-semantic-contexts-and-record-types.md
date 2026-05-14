---
agent: "copilot-cli"
---

# Establish Semantic Contexts And Record Types

Align the semantic model around the canonical first-class contexts owned by packages/core: repository, mission, task, artifact, and agent session. This slice should preserve the mission-model record types and context exports in `packages/core/src/types.ts`, keep repository and mission contexts coherent in `packages/core/src/daemon/system/MissionControl.ts`, and ensure the persisted dossier and descriptor surfaces in `packages/core/src/lib/FilesystemAdapter.ts` continue to reflect those semantic records cleanly.

Use the product artifacts in this mission folder as the canonical context boundary.
