---
taskKind: "implementation"
pairedTaskId: "implementation/16-wire-child-entity-projections-verify"
dependsOn: ["implementation/15-refactor-airport-actionbar-to-entity-commands-verify"]
agent: "copilot-cli"
---

# Wire Child Entity Projections

Objective: complete the clean child-entity architecture by routing projection updates to Stage, Task, Artifact, and AgentSession mirrors by entity reference.

Context: read `02-SPEC/SPEC.md`, `packages/core/src/schemas/RuntimeEvents.ts`, daemon SSE forwarding, Mission mirror reconciliation, and child mirror registries.

Allowed files: RuntimeEvents schemas, daemon event mapping, client runtime event handling, child mirror reconciliation, focused tests, and static scans.

Forbidden files: terminal socket byte-stream removal, broad workflow reducer redesign, and route-local request-response Mission API reintroduction.

Expected change: typed projection events identify Mission, Stage, Task, Artifact, and AgentSession entity references and validated snapshots. Client mirrors reconcile targeted child updates without command response projections or Mission-wide action filtering.

Compatibility policy: terminal/session streaming remains transport; entity projection events carry state, command availability invalidation, or snapshots, not terminal bytes.

Validation gate: focused runtime event tests, client reconciliation tests, Mission panel browser check, and route/scan evidence proving child entity projections are typed and command/action state is refreshed through entity mirrors.
