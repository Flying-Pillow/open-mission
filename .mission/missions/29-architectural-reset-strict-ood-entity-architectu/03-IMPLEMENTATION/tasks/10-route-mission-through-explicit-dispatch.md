---
taskKind: "implementation"
pairedTaskId: "implementation/10-route-mission-through-explicit-dispatch-verify"
dependsOn: ["implementation/09-make-mission-daemon-authoritative-verify"]
agent: "copilot-cli"
---

# Route Mission Through Explicit Dispatch

Objective: add explicit Mission query and command handlers to the daemon generic entity dispatch path.

Context: read `02-SPEC/SPEC.md`, `packages/core/src/daemon/entityRemote.ts`, existing Repository and GitHubRepository dispatch handlers, canonical Mission schemas, daemon protocol versioning notes, and focused entity dispatch tests.

Allowed files: daemon entity dispatch, Mission dispatcher helpers if needed, daemon protocol version, focused dispatch tests, and narrow imports required by the dispatcher.

Forbidden files: Airport component rewrites, route-local Mission API removal, terminal streaming changes, and unrelated daemon protocol redesign.

Expected change: `Mission.read`, `Mission.readControl`, `Mission.listActions`, `Mission.readDocument`, `Mission.readWorktree`, `Mission.command`, `Mission.taskCommand`, `Mission.sessionCommand`, `Mission.executeAction`, and `Mission.writeDocument` route through explicit handlers. Each handler parses payloads before execution and results after execution.

Compatibility policy: no dynamic method lookup, no class/prototype probing, no generic result normalization, and no command response projection shortcut.

Validation gate: focused daemon dispatch tests for every Mission method, unknown Mission method failures, invalid payload failures, invalid result failures, missing context failures, and protocol version bump evidence.
