---
taskKind: "verification"
pairedTaskId: "implementation/12-wire-mission-projections-and-remove-runtime-routes"
dependsOn: ["implementation/12-wire-mission-projections-and-remove-runtime-routes"]
agent: "copilot-cli"
---

# Verify Mission Projections And Runtime Route Cleanup

Paired task: `implementation/12-wire-mission-projections-and-remove-runtime-routes`.

Focused checks: Mission command responses are acknowledgements or source-local results, Mission projection events validate typed payloads, client mirrors reconcile Mission/Stage/Task/Artifact/AgentSession updates from SSE or query refreshes, duplicate request-response runtime routes are gone or reduced, and terminal/socket routes are retained only for stream transport.

Failure signals: command responses still carry broad workflow projections, route-local `mission-page.remote.ts` remains the active page state authority, request-response runtime routes duplicate Mission entity methods, or event payloads remain untyped for entity projections.

Ignore: future promotion of Stage, Task, Artifact, and AgentSession into independent daemon-callable source entities.

Evidence: append final Mission-migration validation output and remaining risks to `03-IMPLEMENTATION/VERIFY.md`.
