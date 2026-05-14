---
taskKind: "verification"
pairedTaskId: "implementation/16-wire-child-entity-projections"
dependsOn: ["implementation/16-wire-child-entity-projections"]
agent: "copilot-cli"
---

# Verify Child Entity Projections

Paired task: `implementation/16-wire-child-entity-projections`.

Focused checks: Runtime event schemas include typed child entity projection payloads, daemon forwarding validates those payloads, client mirrors reconcile Stage/Task/Artifact/AgentSession updates by reference, command availability refreshes through entity mirrors, and terminal stream transport remains separate.

Failure signals: event payloads remain untyped for child projections, command responses carry broad projections, Mission panel requires full Mission refresh for every child update, or terminal stream routes are removed instead of retained as transport.

Evidence: append focused event/reconciliation tests, browser Mission-panel results, and final child-entity architecture notes to `03-IMPLEMENTATION/VERIFY.md`.
