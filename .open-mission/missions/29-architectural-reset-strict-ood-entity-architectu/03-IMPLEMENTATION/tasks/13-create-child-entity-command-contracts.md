---
taskKind: "implementation"
pairedTaskId: "implementation/13-create-child-entity-command-contracts-verify"
dependsOn: ["implementation/12-wire-mission-projections-and-remove-runtime-routes-verify"]
agent: "copilot-cli"
---

# Create Child Entity Command Contracts

Objective: make Stage, Task, Artifact, and AgentSession first-class commandable entity contracts at the shared schema and daemon dispatch boundary, with each child entity owning its own canonical schema module.

Context: read `02-SPEC/SPEC.md`, especially `Child Entity Command Architecture` and `Schema Ownership`; inspect `packages/core/src/schemas/Mission.ts`, `packages/core/src/schemas/EntityRemote.ts`, `packages/core/src/daemon/entityRemote.ts`, `packages/core/src/entities/Mission/MissionCommands.ts`, `packages/core/src/lib/operatorActionTargeting.ts`, and the current Airport actionbar callers.

Allowed files: shared schema files, dedicated child entity schema modules, entity remote schemas, focused command descriptor schemas, daemon dispatch contracts, focused tests, and narrow compatibility removal needed by this slice.

Forbidden files: broad UI rewrites, unrelated workflow reducer changes, terminal stream transport removal, and generic dynamic entity registries.

Expected change: introduce dedicated canonical schema modules for `Stage`, `Task`, `Artifact`, and `AgentSession` under `packages/core/src/schemas/`. Each module must own that entity's identity payload, typed entity reference, snapshot or projection contract, command list snapshot, `executeCommand` payload/result schemas, acknowledgement schema, and remote payload/result schema maps. Introduce shared `EntityCommandDescriptor` and `EntityCommandListSnapshot` primitives in `EntityRemote`. Update `Mission.ts` to compose child schemas from the child modules instead of owning the child command contracts itself. Preserve Mission as internal aggregate authority while exposing child entity contracts externally.

Ownership rule: `Mission.ts` may reference child schemas to build `MissionSnapshot`, but it must not become the schema owner for Stage, Task, Artifact, or AgentSession command surfaces. First-class entity means first-class schema module, first-class remote contract, and first-class client mirror boundary.

Compatibility policy: no `Mission.listActions(context)` as the target contract, no untyped `artifactPath` action contexts, no action descriptor shape that drops targeting or command input metadata accidentally, and no client filtering requirement.

Validation gate: focused schema tests proving strict child identity payloads, command descriptors, command list snapshots, and daemon-safe/browser-safe exports.
