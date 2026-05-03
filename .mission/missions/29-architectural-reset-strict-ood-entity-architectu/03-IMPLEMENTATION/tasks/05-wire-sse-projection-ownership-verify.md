---
taskKind: "verification"
pairedTaskId: "implementation/05-wire-sse-projection-ownership"
dependsOn: ["implementation/05-wire-sse-projection-ownership"]
agent: "copilot-cli"
---

# Verify SSE Projection Ownership

Paired task: `implementation/05-wire-sse-projection-ownership`.

Focused checks: mission-start command results, command acknowledgement parsing, SSE envelope validation, daemon event publication, and client mirror reconciliation.

Failure signals: command responses still carry broad cross-entity projections, events bypass shared schemas, or client reconciliation depends on route-local view models.

Ignore: unrelated full-suite failures outside projection ownership.

Evidence: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
