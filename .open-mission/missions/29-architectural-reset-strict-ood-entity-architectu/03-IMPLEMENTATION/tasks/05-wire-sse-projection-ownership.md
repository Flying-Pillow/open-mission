---
taskKind: "implementation"
pairedTaskId: "implementation/05-wire-sse-projection-ownership-verify"
dependsOn: ["implementation/04-clean-airport-repository-mirror-verify"]
agent: "copilot-cli"
---

# Wire SSE Projection Ownership

Objective: separate source command results from cross-entity projection updates.

Context: read SPEC command semantics, SSE projection contract, RuntimeEvents schemas, Repository mission-start flow, runtime events route, and client reconciliation code.

Allowed files: command result handling, RuntimeEvents usage, daemon event publication/subscription glue, Repository/Mission client reconciliation, and focused event tests.

Forbidden files: schema ownership rewrite, explicit dispatcher rewrite, route-local remote cleanup beyond projection needs, package export cleanup, and workflow-engine structured runtime records.

Expected change: mission-start commands return acknowledgement or source-local result only. Mission, workflow, task, artifact, and session changes reconcile from validated SSE projection events.

Compatibility policy: no command response as broad projection snapshot.

Validation gate: focused event envelope, command acknowledgement, and Repository/Mission flow checks.
