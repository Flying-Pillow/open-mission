---
taskKind: "implementation"
pairedTaskId: "implementation/12-wire-mission-projections-and-remove-runtime-routes-verify"
dependsOn: ["implementation/11-clean-airport-mission-mirror-verify"]
agent: "copilot-cli"
---

# Wire Mission Projections And Remove Runtime Routes

Objective: complete the Mission migration by separating Mission projection updates from command responses and removing request-response runtime routes that duplicate entity remotes.

Context: read `02-SPEC/SPEC.md`, `packages/core/src/schemas/RuntimeEvents.ts`, daemon runtime event forwarding, `apps/airport/web/src/routes/api/runtime/events/+server.ts`, Mission runtime routes, Mission mirror reconciliation code, and existing SSE projection tests.

Allowed files: RuntimeEvents schemas, daemon projection publication/forwarding, Mission client reconciliation, request-response Mission route cleanup, focused event/route tests, and static cleanup of obsolete parsers.

Forbidden files: terminal/socket stream removal when the route is still streaming transport, Stage/Task/Artifact/AgentSession independent source-entity promotion, and unrelated workflow-engine reducer redesign.

Expected change: Mission, Stage, Task, Artifact, and AgentSession projection events are validated with shared schemas and reconcile client mirrors. Route-local Mission request-response APIs are removed or reduced after generic entity methods own their behavior. Terminal/session streaming remains only where streaming transport is required.

Compatibility policy: no command response carries `status`, `sessions`, `workflow`, or other broad projection fields as a reconciliation shortcut. No route-local Mission page bundle remains the authoritative state assembly path.

Validation gate: focused SSE/event tests, route-removal scans, Mission command acknowledgement tests, manual Mission flow check if feasible, and documentation of any streaming route intentionally retained.
