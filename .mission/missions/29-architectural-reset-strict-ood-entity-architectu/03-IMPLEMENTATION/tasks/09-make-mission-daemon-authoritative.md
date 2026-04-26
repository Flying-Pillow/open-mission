---
taskKind: "implementation"
pairedTaskId: "implementation/09-make-mission-daemon-authoritative-verify"
dependsOn: ["implementation/08-create-canonical-mission-schema-contracts-verify"]
agent: "copilot-cli"
---

# Make Mission Daemon Authoritative

Objective: move daemon-callable Mission behavior behind the Mission entity boundary or focused Mission collaborators instead of keeping `MissionRemote` as a parallel contract owner.

Context: read `02-SPEC/SPEC.md`, `packages/core/src/entities/Mission/Mission.ts`, `packages/core/src/entities/Mission/MissionRemote.ts`, `packages/core/src/mission/Factory.ts`, workflow-engine docs, and the current Mission entity tests.

Allowed files: Mission entity files, focused Mission runtime-loading collaborators, Mission schema/result parsing, Mission entity tests, and narrow call-site updates needed for the new boundary.

Forbidden files: Airport client mirror migration, route deletion, terminal socket transport changes, broad workflow reducer rewrites, and Stage/Task/Artifact/AgentSession promotion to independent source entities.

Expected change: Mission resolves repository-scoped mission instances explicitly, loads/disposes runtime resources through a focused collaborator, executes Mission source methods, returns strict JSON-safe values, and parses source results before returning. `MissionRemote` is reduced or prepared for removal rather than acting as the authoritative daemon-callable model.

Compatibility policy: no broad `MissionRuntimeSnapshot` command response as a target contract, no route handler snapshot construction by hand, and no silent fallback when a mission cannot be resolved.

Validation gate: focused Mission entity/runtime-loading tests for read and command source methods, missing mission failure, invalid payload failure, and result parsing.
