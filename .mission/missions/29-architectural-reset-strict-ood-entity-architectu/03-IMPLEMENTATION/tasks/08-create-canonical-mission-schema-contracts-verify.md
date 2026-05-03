---
taskKind: "verification"
pairedTaskId: "implementation/08-create-canonical-mission-schema-contracts"
dependsOn: ["implementation/08-create-canonical-mission-schema-contracts"]
agent: "copilot-cli"
---

# Verify Canonical Mission Schema Contracts

Paired task: `implementation/08-create-canonical-mission-schema-contracts`.

Focused checks: `packages/core/src/schemas/Mission.ts` owns Mission identity, snapshot, child projection, method payload, method result, and acknowledgement schemas; schemas are strict; schema barrel exports are browser-safe; Airport code imports Mission contracts from `@flying-pillow/mission-core/schemas`; deep `MissionRemoteContract` is no longer the target schema owner.

Failure signals: Mission payload schemas still live only under `entities/Mission`, command result schemas accept broad runtime snapshots, browser code imports daemon/node surfaces for Mission contracts, or `airport/runtime.ts` remains the canonical Mission schema owner.

Ignore: behavior still implemented through `MissionRemote`, daemon dispatch still missing Mission handlers, and route-local Mission fetches. Those are later tasks.

Evidence: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md` with the exact checks run and remaining gaps.
