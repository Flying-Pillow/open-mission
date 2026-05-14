---
taskKind: "verification"
pairedTaskId: "implementation/13-create-child-entity-command-contracts"
dependsOn: ["implementation/13-create-child-entity-command-contracts"]
agent: "copilot-cli"
---

# Verify Child Entity Command Contracts

Paired task: `implementation/13-create-child-entity-command-contracts`.

Focused checks: Stage, Task, Artifact, and AgentSession have dedicated canonical schema modules under `packages/core/src/schemas/` and each module owns strict schemas for identity, typed reference, snapshot or projection where needed, `listCommands`, `executeCommand`, acknowledgements, remote payload/result maps, and command descriptors. Confirm schemas are exported through `@flying-pillow/mission-core/schemas`, browser-safe, and do not require Airport actionbar filtering context. Confirm `Mission.ts` composes child schemas from child modules instead of owning child command contracts itself.

Failure signals: command contracts still require `{ stageId, taskId, artifactPath, sessionId }` action context composition in the UI, command descriptor schemas drop confirmation/input metadata, child entity contracts live only under deep Mission runtime files, or Stage/Task/Artifact/AgentSession command schemas are added directly to `Mission.ts` instead of first-class child schema modules.

Evidence: append schema/test/import-boundary output and remaining gaps to `03-IMPLEMENTATION/VERIFY.md`.
