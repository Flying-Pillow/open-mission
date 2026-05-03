---
taskKind: "implementation"
pairedTaskId: "implementation/08-create-canonical-mission-schema-contracts-verify"
dependsOn: ["implementation/07-implement-github-repository-source-entity-verify"]
agent: "copilot-cli"
---

# Create Canonical Mission Schema Contracts

Objective: make `packages/core/src/schemas/Mission.ts` the canonical shared contract owner for the Mission entity.

Context: read `02-SPEC/SPEC.md`, especially `Mission Entity Contract`, `Mission Query Methods`, `Mission Command Methods`, and `Phase 8: Mission Entity Contract`. Inspect `packages/core/src/schemas/MissionRuntime.ts`, `packages/core/src/schemas/index.ts`, `packages/core/src/airport/runtime.ts`, and Airport imports of Mission runtime types.

Allowed files: Mission schema files, schema barrel exports, transitional MissionRuntime re-exports, focused schema tests, and minimal import updates needed to keep existing callers compiling.

Forbidden files: Mission behavior refactors, daemon dispatch rewrites, Airport UI behavior changes, route removal, terminal streaming changes, and broad workflow-engine reducer changes.

Expected change: Mission identity, snapshot, child projection, action, document, worktree, command payload, query payload, result, and acknowledgement schemas live under the canonical schema surface. Deep `MissionRemoteContract` stops being the target contract owner.

Compatibility policy: no new fallback parser layer, no passthrough Mission payloads, no public deep entity remote contract export, and no command result schema that blesses broad `MissionRuntimeSnapshot` reconciliation.

Validation gate: focused schema/type checks proving Mission schemas are strict, exported from `@flying-pillow/mission-core/schemas`, and usable from browser-safe Airport code without daemon/node imports.
