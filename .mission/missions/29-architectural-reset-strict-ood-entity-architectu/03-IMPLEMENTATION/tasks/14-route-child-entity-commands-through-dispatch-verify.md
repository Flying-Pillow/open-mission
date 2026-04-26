---
taskKind: "verification"
pairedTaskId: "implementation/14-route-child-entity-commands-through-dispatch"
dependsOn: ["implementation/14-route-child-entity-commands-through-dispatch"]
agent: "copilot-cli"
---

# Verify Child Entity Dispatch

Paired task: `implementation/14-route-child-entity-commands-through-dispatch`.

Focused checks: daemon dispatch has explicit handlers for Stage, Task, Artifact, and AgentSession query/command methods; handlers parse method-specific payloads and results; missing mission/child entities fail loudly; command lists are already scoped to the requested entity; and Mission remains the internal aggregate authority for workflow invariants.

Failure signals: dispatcher uses dynamic class/prototype probing, child command lists are computed by UI filtering, command results return broad Mission projections, or child handlers duplicate workflow reducer policy instead of using Mission/policy collaborators.

Evidence: append dispatch test output, static handler coverage, and boundary notes to `03-IMPLEMENTATION/VERIFY.md`.
