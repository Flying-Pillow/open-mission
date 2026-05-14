---
taskKind: "implementation"
pairedTaskId: "implementation/15-refactor-airport-actionbar-to-entity-commands-verify"
dependsOn: ["implementation/14-route-child-entity-commands-through-dispatch-verify"]
agent: "copilot-cli"
---

# Refactor Airport Actionbar To Entity Commands

Objective: replace scoped actionbar/context filtering with an entity-agnostic actionbar that consumes commandable entity mirrors.

Context: read `02-SPEC/SPEC.md`, `apps/airport/web/src/lib/components/entities/Actionbar/ScopedActionbar.svelte`, Mission/Stage/Task/Artifact/AgentSession client mirror classes, and focused Mission panel components.

Allowed files: Airport client entity mirrors, actionbar components, Mission panel wiring, focused web tests, and narrow transport changes required for child entity remotes.

Forbidden files: daemon behavior changes except endpoint alignment already covered by earlier tasks, broad visual redesign, and unrelated repository/GitHub UI changes.

Expected change: introduce `ActionableEntity`/commandable mirror behavior; Stage, Task, Artifact, and AgentSession browser mirrors expose `listCommands` and `executeCommand`; Actionbar receives an entity instance and renders returned commands. Remove `scope`, `stageId`, `taskId`, `artifactPath`, and `sessionId` actionbar props and remove local target filtering.

Compatibility policy: components must not manually compose action contexts; child mirrors may call generic child entity remotes or owning Mission-backed helpers, but the component boundary is child-entity-shaped.

Validation gate: focused web tests and static scans proving actionbars render through entity commands only and no active component calls `Mission.listActions(context)` or passes actionbar target ids.
